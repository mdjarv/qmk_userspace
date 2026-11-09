package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// The anomaly log, for the two open threads in CLAUDE.md: keys that register
// twice (bounce: the same key pressed again within 50 ms of its release) and
// the volume jumping (volume steps faster than a hand turns the knob). It
// reads only this keyboard's input devices and writes one line per anomaly,
// never the keystrokes themselves, tagged with the firmware kbflash last put
// on the keyboard.

const (
	bounceWindow = 50 * time.Millisecond
	volumeBurst  = 8                      // volume steps ...
	volumeWindow = 200 * time.Millisecond // ... within this
)

const (
	evKey        = 1
	keyVolumeDn  = 114
	keyVolumeUp  = 115
	inputEvtSize = 24 // struct input_event on 64-bit: timeval, type, code, value
)

type inputEvent struct {
	at    time.Time
	typ   uint16
	code  uint16
	value int32 // 1 down, 0 up, 2 repeat
}

func readInputEvent(r io.Reader) (inputEvent, error) {
	var b [inputEvtSize]byte
	if _, err := io.ReadFull(r, b[:]); err != nil {
		return inputEvent{}, err
	}
	sec := int64(binary.LittleEndian.Uint64(b[0:]))
	usec := int64(binary.LittleEndian.Uint64(b[8:]))
	return inputEvent{
		at:    time.Unix(sec, usec*1000),
		typ:   binary.LittleEndian.Uint16(b[16:]),
		code:  binary.LittleEndian.Uint16(b[18:]),
		value: int32(binary.LittleEndian.Uint32(b[20:])),
	}, nil
}

// anomalies watches key events and reports what looks wrong.
type anomalies struct {
	released map[uint16]time.Time
	volume   map[uint16][]time.Time // recent volume steps, per direction
	burstEnd map[uint16]time.Time   // a burst is reported once
}

func newAnomalies() *anomalies {
	return &anomalies{released: map[uint16]time.Time{}, volume: map[uint16][]time.Time{}, burstEnd: map[uint16]time.Time{}}
}

// see takes one event and returns a description of an anomaly, or "".
func (a *anomalies) see(e inputEvent) string {
	if e.typ != evKey {
		return ""
	}
	switch e.value {
	case 0:
		a.released[e.code] = e.at
	case 1:
		if e.code == keyVolumeUp || e.code == keyVolumeDn {
			return a.volumeStep(e)
		}
		if up, ok := a.released[e.code]; ok && e.at.Sub(up) < bounceWindow {
			return fmt.Sprintf("bounce %s pressed again %d ms after release", keyName(e.code), e.at.Sub(up).Milliseconds())
		}
	}
	return ""
}

func (a *anomalies) volumeStep(e inputEvent) string {
	steps := append(a.volume[e.code], e.at)
	for len(steps) > 0 && e.at.Sub(steps[0]) > volumeWindow {
		steps = steps[1:]
	}
	a.volume[e.code] = steps
	if len(steps) < volumeBurst || e.at.Before(a.burstEnd[e.code]) {
		return ""
	}
	a.burstEnd[e.code] = e.at.Add(time.Second) // one line per burst
	return fmt.Sprintf("burst %s: %d steps in %d ms", keyName(e.code), len(steps), e.at.Sub(steps[0]).Milliseconds())
}

var keyNames = map[uint16]string{1: "ESC", 14: "BACKSPACE", 15: "TAB", 28: "ENTER", 29: "LCTRL", 42: "LSHIFT", 54: "RSHIFT",
	56: "LALT", 57: "SPACE", 100: "RALT", 125: "LMETA", keyVolumeDn: "VOLUMEDOWN", keyVolumeUp: "VOLUMEUP", 113: "MUTE"}

// keyName names a key by its Linux code: letters and digits as themselves.
func keyName(code uint16) string {
	const rows = "QWERTYUIOP....ASDFGHJKL.....ZXCVBNM"
	switch {
	case code >= 2 && code <= 10:
		return string(rune('1' + code - 2))
	case code == 11:
		return "0"
	case code >= 16 && int(code-16) < len(rows) && rows[code-16] != '.':
		return string(rows[code-16])
	}
	if n, ok := keyNames[code]; ok {
		return n
	}
	return fmt.Sprintf("code %d", code)
}

// firmwareTag is what kbflash last flashed: its time and checksum, or
// "unknown" before kbflash has noted a flash.
func firmwareTag(stateDir string) string {
	var f struct {
		At     string `json:"at"`
		SHA256 string `json:"sha256"`
	}
	b, err := os.ReadFile(filepath.Join(stateDir, "kbflash", "flashed.json"))
	if err != nil || json.Unmarshal(b, &f) != nil {
		return "fw=unknown"
	}
	return fmt.Sprintf("fw=%.8s flashed=%s", f.SHA256, f.At)
}

// keyboardEventNodes lists the keyboard's /dev/input/event* nodes, found by
// vendor and product id in sysfs.
func keyboardEventNodes(sysRoot string) []string {
	var out []string
	dirs, _ := filepath.Glob(filepath.Join(sysRoot, "class/input/event*"))
	for _, d := range dirs {
		v, _ := os.ReadFile(filepath.Join(d, "device/id/vendor"))
		p, _ := os.ReadFile(filepath.Join(d, "device/id/product"))
		if strings.TrimSpace(string(v)) == fmt.Sprintf("%04x", vendorID) && strings.TrimSpace(string(p)) == fmt.Sprintf("%04x", productID) {
			out = append(out, "/dev/input/"+filepath.Base(d))
		}
	}
	return out
}

// watchInput logs anomalies from the keyboard's input devices to logPath,
// following the keyboard through unplugs and flashes.
func watchInput(ctx context.Context, logPath, stateDir string) {
	var mu sync.Mutex
	write := func(at time.Time, what string) {
		mu.Lock()
		defer mu.Unlock()
		line := fmt.Sprintf("%s %s %s\n", at.Format(time.RFC3339Nano), firmwareTag(stateDir), what)
		if os.MkdirAll(filepath.Dir(logPath), 0o755) != nil {
			return
		}
		if f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
			f.WriteString(line)
			f.Close()
		}
	}
	watching := map[string]bool{}
	var mwatch sync.Mutex
	warned := false
	for ctx.Err() == nil {
		for _, node := range keyboardEventNodes("/sys") {
			mwatch.Lock()
			busy := watching[node]
			mwatch.Unlock()
			if busy {
				continue
			}
			f, err := os.Open(node)
			if errors.Is(err, fs.ErrPermission) {
				if !warned {
					log.Printf("anomaly log: cannot read %s; install 70-kbscreen.rules (README, Setup)", node)
					warned = true
				}
				continue
			}
			if err != nil {
				continue
			}
			mwatch.Lock()
			watching[node] = true
			mwatch.Unlock()
			go func() {
				defer func() { f.Close(); mwatch.Lock(); delete(watching, node); mwatch.Unlock() }()
				go func() { <-ctx.Done(); f.Close() }()
				a := newAnomalies()
				for {
					e, err := readInputEvent(f)
					if err != nil {
						return // unplugged, flashed, or shutting down
					}
					if what := a.see(e); what != "" {
						write(e.at, what)
					}
				}
			}()
		}
		sleep(ctx, 5*time.Second)
	}
}
