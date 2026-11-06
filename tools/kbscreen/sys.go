package main

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// sysReader samples CPU, GPU, memory and battery from /proc and /sys under
// root ("/" outside tests). CPU load needs two samples, so the first read
// reports zero load.
type sysReader struct {
	root string
	prev cpuTimes // the last /proc/stat total
	seen bool
}

type cpuTimes struct{ busy, total uint64 }

func newSysReader(root string) *sysReader {
	return &sysReader{root: root}
}

func (r *sysReader) path(p string) string { return filepath.Join(r.root, p) }

func (r *sysReader) read() Sys {
	s := Sys{CPU: uint8(r.cpuLoad()*100 + 0.5), GPU: r.gpuBusy()}
	s.RAMUsed, s.RAMTotal = r.memory()
	s.VRAMUsed, s.VRAMTotal = r.vram()
	s.Battery, s.BatteryState = r.battery()
	return s
}

// cpuLoad returns the busy share (0..1) of all CPUs since the last call.
func (r *sysReader) cpuLoad() float64 {
	f, err := os.Open(r.path("proc/stat"))
	if err != nil {
		return 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 5 || fields[0] != "cpu" {
			continue
		}
		var t cpuTimes
		for i, v := range fields[1:] {
			if i >= 8 { // guest time is already counted in user
				break
			}
			n, _ := strconv.ParseUint(v, 10, 64)
			t.total += n
			if i != 3 && i != 4 { // idle, iowait
				t.busy += n
			}
		}
		p, ok := r.prev, r.seen
		r.prev, r.seen = t, true
		if !ok || t.total <= p.total {
			return 0
		}
		return float64(t.busy-p.busy) / float64(t.total-p.total)
	}
	return 0
}

const gib = 1 << 30

// memory returns used and total system RAM in GiB.
func (r *sysReader) memory() (used, total float64) {
	data, err := os.ReadFile(r.path("proc/meminfo"))
	if err != nil {
		return 0, 0
	}
	var avail float64
	for line := range strings.Lines(string(data)) {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		v, _ := strconv.ParseFloat(f[1], 64) // kB
		switch f[0] {
		case "MemTotal:":
			total = v * 1024 / gib
		case "MemAvailable:":
			avail = v * 1024 / gib
		}
	}
	return total - avail, total
}

// vram returns the GPU's memory use in GiB: its own VRAM plus what spilled
// into system memory (GTT), against the size of the VRAM.
func (r *sysReader) vram() (used, total float64) {
	dirs, _ := filepath.Glob(r.path("sys/class/drm/card*/device"))
	for _, d := range dirs {
		t := readUint(filepath.Join(d, "mem_info_vram_total"))
		if t == 0 {
			continue
		}
		u := readUint(filepath.Join(d, "mem_info_vram_used")) + readUint(filepath.Join(d, "mem_info_gtt_used"))
		return float64(u) / gib, float64(t) / gib
	}
	return 0, 0
}

// battery returns the first battery's charge and whether to show it: only
// while charging or discharging, not when full or held on AC.
func (r *sysReader) battery() (pct, state uint8) {
	dirs, _ := filepath.Glob(r.path("sys/class/power_supply/BAT*"))
	for _, d := range dirs {
		status, err := os.ReadFile(filepath.Join(d, "status"))
		if err != nil {
			continue
		}
		pct = uint8(min(readUint(filepath.Join(d, "capacity")), 100))
		switch strings.TrimSpace(string(status)) {
		case "Charging":
			return pct, batteryCharging
		case "Discharging":
			return pct, batteryDischarging
		}
		return pct, batteryHidden
	}
	return 0, batteryHidden
}

func (r *sysReader) gpuBusy() uint8 {
	files, _ := filepath.Glob(r.path("sys/class/drm/card*/device/gpu_busy_percent"))
	for _, f := range files {
		return uint8(min(readUint(f), 100))
	}
	return 0
}

func readUint(path string) uint64 {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	v, _ := strconv.ParseUint(strings.TrimSpace(string(data)), 10, 64)
	return v
}
