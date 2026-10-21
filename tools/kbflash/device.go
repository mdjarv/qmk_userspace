package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	bootselVID = "2e8a"
	bootselPID = "0003"

	hintAfter      = 15 * time.Second
	bootselTimeout = 5 * time.Minute
	appTimeout     = 30 * time.Second
	accessTimeout  = 10 * time.Second

	// QMK on this board assumes 2 MB of flash: firmware at the start, the
	// wear-leveled settings at the end of those 2 MB. Erasing this range
	// clears everything firmware writes, in ~30 s instead of minutes for 16 MB.
	firmwareStart = 0x10000000
	firmwareEnd   = 0x10200000
)

var (
	sysfs    = envOr("KBFLASH_SYSFS", "/sys")
	picotool = envOr("KBFLASH_PICOTOOL", "picotool")
)

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

type usbDevice struct{ vid, pid string }

func usbDevices() []usbDevice {
	dirs, _ := filepath.Glob(filepath.Join(sysfs, "bus/usb/devices/*"))
	var devs []usbDevice
	for _, d := range dirs {
		vid, err1 := os.ReadFile(filepath.Join(d, "idVendor"))
		pid, err2 := os.ReadFile(filepath.Join(d, "idProduct"))
		if err1 != nil || err2 != nil {
			continue
		}
		devs = append(devs, usbDevice{strings.TrimSpace(string(vid)), strings.TrimSpace(string(pid))})
	}
	return devs
}

func bootselCount() int {
	n := 0
	for _, d := range usbDevices() {
		if d.vid == bootselVID && d.pid == bootselPID {
			n++
		}
	}
	return n
}

func appPresent(vendor string) bool {
	for _, d := range usbDevices() {
		if d.vid == vendor {
			return true
		}
	}
	return false
}

// waitFor polls cond every 500 ms until it holds, the timeout passes or ctx ends.
func waitFor(ctx context.Context, timeout time.Duration, cond func() bool) bool {
	deadline := time.Now().Add(timeout)
	for {
		if cond() {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(500 * time.Millisecond):
		}
	}
}

// progressLine matches picotool's bar, e.g. "Loading into Flash:   [====   ]  62%".
var progressLine = regexp.MustCompile(`^\s*([A-Za-z][A-Za-z ]*?):\s*\[[= ]*\]\s+(\d+)%`)

// stageName maps picotool's bar prefix to what the row says.
func stageName(prefix string) string {
	switch {
	case strings.HasPrefix(prefix, "Loading"):
		return "writing"
	case strings.HasPrefix(prefix, "Verifying"):
		return "verifying"
	case strings.HasPrefix(prefix, "Saving"):
		return "reading"
	case strings.HasPrefix(prefix, "Erasing"):
		return "erasing"
	}
	return strings.ToLower(prefix)
}

// runPicotool runs picotool against the half with flash ID fid, reporting its
// progress bars through onProgress, and returns the rest of its stdout.
func runPicotool(ctx context.Context, fid string, onProgress func(stage string, pct int), args ...string) (string, error) {
	if fid != "" {
		args = append(args, "--ser", fid)
	}
	cmd := exec.CommandContext(ctx, picotool, args...)
	// separate buffers: exec owns stderr's writer until Wait returns
	var out, stderr bytes.Buffer
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return "", err
	}
	scan := bufio.NewScanner(pipe)
	scan.Split(splitCRLF)
	for scan.Scan() {
		line := scan.Text()
		if m := progressLine.FindStringSubmatch(line); m != nil {
			if onProgress != nil {
				pct, _ := strconv.Atoi(m[2])
				onProgress(stageName(m[1]), pct)
			}
			continue
		}
		out.WriteString(line + "\n")
	}
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return out.String(), ctx.Err()
		}
		return out.String(), fmt.Errorf("picotool %s failed (%v): %s", args[0], err, lastLine(stderr.String()+out.String()))
	}
	return out.String(), nil
}

// splitCRLF splits on \n or \r, since picotool redraws its bars with \r.
func splitCRLF(data []byte, atEOF bool) (int, []byte, error) {
	if i := bytes.IndexAny(data, "\r\n"); i >= 0 {
		return i + 1, data[:i], nil
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}

// flashID reads the flash ID of the one half in BOOTSEL; picotool --ser
// matches this on RP2040, not the USB serial. Retries because udev grants
// access a moment after the device appears.
func flashID(ctx context.Context) (string, error) {
	_ = exec.Command("udevadm", "settle", "-t", "5").Run()
	deadline := time.Now().Add(accessTimeout)
	for {
		out, err := exec.CommandContext(ctx, picotool, "info", "-d").Output()
		if err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				key, value, ok := strings.Cut(strings.TrimSpace(line), ":")
				if ok && key == "flash id" {
					return strings.ToUpper(strings.TrimPrefix(strings.TrimSpace(value), "0x")), nil
				}
			}
			return "", errors.New("picotool info -d did not report a flash id")
		}
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		if time.Now().After(deadline) {
			return "", errors.New("picotool cannot access the half in bootloader (permissions? see 60-picotool.rules)")
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// reboot sends the half back to its firmware and waits for the keyboard.
func reboot(ctx context.Context, fid, appVendor string) (warning string, err error) {
	if _, err := runPicotool(ctx, fid, nil, "reboot", "-a"); err != nil {
		return "", err
	}
	if !waitFor(ctx, appTimeout, func() bool { return bootselCount() == 0 }) {
		return "", errors.New("device stayed in bootloader mode after reboot")
	}
	if !waitFor(ctx, appTimeout, func() bool { return appPresent(appVendor) }) {
		return "keyboard not seen on USB after reboot", nil
	}
	return "", nil
}

func eraseFirmwareRegion(ctx context.Context, fid string, onProgress func(string, int)) error {
	onProgress("erasing", -1)
	_, err := runPicotool(ctx, fid, onProgress, "erase", "-r",
		fmt.Sprintf("%#x", firmwareStart), fmt.Sprintf("%#x", firmwareEnd))
	return err
}
