package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

type rowState int

const (
	statePending rowState = iota
	stateWaiting          // waiting for the person to put a half in the bootloader
	stateActive
	stateDone
	stateFailed
)

// row is one line of the checklist: the build, or one half.
type row struct {
	key, label string
	state      rowState
	text       string // what is happening, or the instruction while waiting
	detail     string // muted extra, e.g. firmware size
	pct        int    // progress bar percentage; -1 for none
	hint       string // second line under the row
	since      time.Time
	took       time.Duration
}

type reporter interface {
	update(r row)
	note(s string)
	finish(lines []string, err error)
}

type half struct {
	Side      string `json:"side"`
	FlashID   string `json:"flash_id"`
	Bootmagic string `json:"bootmagic"`
}

// config is kbflash.json. The first half listed is where the USB cable lives.
type config struct {
	AppVendor string `json:"app_vendor"`
	Halves    []half `json:"halves"`
}

func loadConfig(path string) (config, error) {
	var c config
	data, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(data, &c); err != nil {
		return c, fmt.Errorf("%s: %w", path, err)
	}
	if len(c.Halves) == 0 {
		return c, fmt.Errorf("%s lists no halves", path)
	}
	for i := range c.Halves {
		c.Halves[i].FlashID = strings.ToUpper(c.Halves[i].FlashID)
	}
	return c, nil
}

func (c config) sides() []string {
	var s []string
	for _, h := range c.Halves {
		s = append(s, h.Side)
	}
	return s
}

func (c config) half(side string) (half, bool) {
	for _, h := range c.Halves {
		if h.Side == side {
			return h, true
		}
	}
	return half{}, false
}

type runner struct {
	ctx     context.Context
	cfg     config
	rep     reporter
	rows    map[string]*row
	started time.Time
	current string // label of the half in the bootloader, for error messages
	// rowFailed is set when a row already shows the error, so the footer
	// does not repeat it
	rowFailed bool
	// mustMatch: the run writes firmware, so stopping halfway leaves the
	// halves on different firmware and the split link down
	mustMatch bool
	finished  []string
}

func (r *runner) set(key string, f func(*row)) {
	rw := r.rows[key]
	f(rw)
	r.rep.update(*rw)
}

func (r *runner) addRow(key, label string) {
	r.rows[key] = &row{key: key, label: label, pct: -1, text: "pending"}
	r.rep.update(*r.rows[key])
}

// eachHalf runs action on each half as it shows up in the bootloader.
// Halves are recognised by flash ID (ids: side -> ID), so they can come in any
// order; one not pending is rebooted unchanged.
func (r *runner) eachHalf(prefix string, sides []string, ids map[string]string, doneText string,
	action func(side, fid string, progress func(string, int)) error) (last string, err error) {
	bySide := map[string]string{}
	for side, fid := range ids {
		bySide[strings.ToUpper(fid)] = side
	}
	label := func(side string) string { return strings.TrimSpace(prefix + " " + strings.ToUpper(side)) }
	for _, side := range sides {
		r.addRow(prefix+side, label(side))
	}
	failKey := "" // the row an error belongs to
	defer func() {
		if err == nil || failKey == "" {
			return
		}
		msg := err.Error()
		if errors.Is(err, context.Canceled) {
			msg = "interrupted"
		}
		r.set(failKey, func(rw *row) { rw.state, rw.text, rw.pct, rw.hint = stateFailed, msg, -1, "" })
		r.rowFailed = true
	}()
	pending := slices.Clone(sides)
	for len(pending) > 0 {
		nxt := pending[0]
		failKey = prefix + nxt
		instruction := "USB cable here, double-tap reset"
		if last != "" {
			instruction = "move USB cable here, double-tap reset"
		}
		r.set(prefix+nxt, func(rw *row) {
			rw.state, rw.text, rw.since = stateWaiting, instruction, time.Now()
		})
		h, _ := r.cfg.half(nxt)
		hint := fmt.Sprintf("not detected? unplug USB, hold %s, plug in", h.Bootmagic)
		waitStart := time.Now()
		hinted := false
		found := waitFor(r.ctx, bootselTimeout, func() bool {
			if !hinted && time.Since(waitStart) > hintAfter {
				hinted = true
				r.set(prefix+nxt, func(rw *row) { rw.hint = hint })
			}
			return bootselCount() > 0
		})
		if r.ctx.Err() != nil {
			return last, r.ctx.Err()
		}
		if !found {
			return last, errors.New("bootloader did not appear")
		}
		if bootselCount() > 1 {
			return last, errors.New("more than one device in bootloader mode")
		}
		fid, err := flashID(r.ctx)
		if err != nil {
			return last, err
		}
		side, known := bySide[fid]
		if !known {
			return last, fmt.Errorf("unknown half, flash ID %s; add it to kbflash.json", fid)
		}
		if !slices.Contains(pending, side) {
			if _, err := reboot(r.ctx, fid, r.cfg.AppVendor); err != nil {
				return last, err
			}
			r.set(prefix+nxt, func(rw *row) {
				rw.hint = strings.ToUpper(side) + " was already done, rebooted it unchanged"
			})
			continue
		}
		if side != nxt {
			r.set(prefix+nxt, func(rw *row) { rw.state, rw.text, rw.hint = statePending, "pending", "" })
		}
		key := prefix + side
		failKey = key
		r.current = label(side)
		start := time.Now()
		r.set(key, func(rw *row) {
			rw.state, rw.text, rw.hint, rw.pct, rw.since = stateActive, "in bootloader", "", -1, start
		})
		progress := func(stage string, pct int) {
			r.set(key, func(rw *row) { rw.text, rw.pct = stage, pct })
		}
		if err := action(side, fid, progress); err != nil {
			return last, err
		}
		r.set(key, func(rw *row) { rw.text, rw.pct = "rebooting", -1 })
		warning, err := reboot(r.ctx, fid, r.cfg.AppVendor)
		if err != nil {
			return last, err
		}
		r.current = ""
		failKey = ""
		r.set(key, func(rw *row) {
			rw.state, rw.text, rw.hint, rw.took = stateDone, doneText, warning, time.Since(start)
		})
		pending = slices.DeleteFunc(pending, func(s string) bool { return s == side })
		last = side
		r.finished = append(r.finished, strings.ToUpper(side))
	}
	return last, nil
}

func (r *runner) build(cmdline, firmware string) error {
	label := "Firmware"
	start := time.Now()
	if cmdline != "" {
		label = "Build"
		r.addRow("build", label)
		r.set("build", func(rw *row) { rw.state, rw.text, rw.since = stateActive, "compiling", start })
		cmd := exec.CommandContext(r.ctx, "sh", "-c", cmdline)
		out, err := cmd.CombinedOutput()
		if err != nil {
			r.set("build", func(rw *row) { rw.state, rw.text = stateFailed, "build failed" })
			return fmt.Errorf("build failed:\n%s", tail(string(out), 30))
		}
	} else {
		r.addRow("build", label)
	}
	info, err := os.Stat(firmware)
	if err != nil {
		r.set("build", func(rw *row) { rw.state, rw.text = stateFailed, firmware + " not found" })
		return err
	}
	detail := fmt.Sprintf("%d KB", (info.Size()+1023)/1024)
	if cmdline != "" {
		detail += fmt.Sprintf(" · %.0fs", time.Since(start).Seconds())
	}
	r.set("build", func(rw *row) {
		rw.state, rw.text, rw.detail = stateDone, filepath.Base(firmware), detail
	})
	return nil
}

func tail(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

func (r *runner) configIDs() map[string]string {
	ids := map[string]string{}
	for _, h := range r.cfg.Halves {
		ids[h.Side] = h.FlashID
	}
	return ids
}

func (r *runner) flash(firmware, buildCmd string, sides []string, erase bool) (string, error) {
	if err := r.build(buildCmd, firmware); err != nil {
		return "", err
	}
	r.mustMatch = true
	return r.eachHalf("", sides, r.configIDs(), "written, verified", func(side, fid string, progress func(string, int)) error {
		if erase {
			if err := eraseFirmwareRegion(r.ctx, fid, progress); err != nil {
				return err
			}
		}
		progress("writing", 0)
		_, err := runPicotool(r.ctx, fid, progress, "load", "-v", firmware)
		return err
	})
}

type manifest struct {
	Created string                   `json:"created"`
	Sides   map[string]manifestEntry `json:"sides"`
}

type manifestEntry struct {
	File    string `json:"file"`
	SHA256  string `json:"sha256"`
	FlashID string `json:"flash_id"`
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (r *runner) backup(root, label, prefix string, sides []string) (string, string, error) {
	stamp := time.Now().Format("20060102-150405")
	dir := filepath.Join(root, stamp)
	if label != "" {
		dir += "-" + label
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", err
	}
	r.rep.note("Backup to " + dir)
	m := manifest{Created: stamp, Sides: map[string]manifestEntry{}}
	last, err := r.eachHalf(prefix, sides, r.configIDs(), "saved, verified", func(side, fid string, progress func(string, int)) error {
		info, err := runPicotool(r.ctx, fid, nil, "info", "-a")
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, side+"-info.txt"), []byte(info), 0o644); err != nil {
			return err
		}
		image := filepath.Join(dir, side+".uf2")
		progress("reading", 0)
		if _, err := runPicotool(r.ctx, fid, progress, "save", "-a", "-v", image); err != nil {
			return err
		}
		sum, err := fileSHA256(image)
		if err != nil {
			return err
		}
		m.Sides[side] = manifestEntry{File: side + ".uf2", SHA256: sum, FlashID: fid}
		data, _ := json.MarshalIndent(m, "", "  ")
		return os.WriteFile(filepath.Join(dir, "manifest.json"), append(data, '\n'), 0o644)
	})
	return dir, last, err
}

func (r *runner) restore(dir, prefix string, sides []string) (string, error) {
	var m manifest
	data, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return "", err
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return "", err
	}
	ids := map[string]string{}
	for _, side := range sides {
		e, ok := m.Sides[side]
		if !ok {
			return "", fmt.Errorf("backup has no image for %s", side)
		}
		sum, err := fileSHA256(filepath.Join(dir, e.File))
		if err != nil {
			return "", err
		}
		if sum != e.SHA256 {
			return "", fmt.Errorf("%s does not match its recorded checksum", filepath.Join(dir, e.File))
		}
		ids[side] = e.FlashID
	}
	r.rep.note("Restore from " + dir)
	r.mustMatch = true
	tmp, err := os.MkdirTemp("", "kbflash")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmp)
	return r.eachHalf(prefix, sides, ids, "restored, verified", func(side, fid string, progress func(string, int)) error {
		sparse := filepath.Join(tmp, side+".uf2")
		if _, err := sparseUF2(filepath.Join(dir, m.Sides[side].File), sparse); err != nil {
			return err
		}
		if err := eraseFirmwareRegion(r.ctx, fid, progress); err != nil {
			return err
		}
		progress("writing", 0)
		_, err := runPicotool(r.ctx, fid, progress, "load", "-v", sparse)
		return err
	})
}

// latestBackup is the newest backup directory, offered as the way back on failure.
func latestBackup(root string) string {
	dirs, _ := filepath.Glob(filepath.Join(root, "*", "manifest.json"))
	if len(dirs) == 0 {
		return ""
	}
	slices.Sort(dirs)
	return filepath.Dir(dirs[len(dirs)-1])
}

// footer is the closing message: how long it took and where the cable goes,
// or what failed and how to get back.
func (r *runner) footer(last string, err error, backupRoot string) []string {
	if err == nil {
		msg := fmt.Sprintf("Done in %.0fs.", time.Since(r.started).Seconds())
		if home := r.cfg.Halves[0].Side; last != "" && last != home {
			msg += fmt.Sprintf(" Move USB cable back to %s half.", strings.ToUpper(home))
		}
		return []string{msg}
	}
	var lines []string
	if r.mustMatch && len(r.finished) > 0 && len(r.finished) < len(r.cfg.Halves) {
		lines = append(lines, fmt.Sprintf("Only %s is done, so the halves differ. Run it again to finish.",
			strings.Join(r.finished, ", ")))
	}
	if bootselCount() > 0 {
		who := r.current
		if who == "" {
			who = "The half"
		}
		lines = append(lines, who+" is still in bootloader (safe). Retry, or: picotool reboot")
	}
	if b := latestBackup(backupRoot); b != "" {
		if home, err := os.UserHomeDir(); err == nil {
			if rest, ok := strings.CutPrefix(b, home+"/"); ok {
				b = "~/" + rest
			}
		}
		lines = append(lines, "Roll back: make restore BACKUP="+b)
	}
	return lines
}
