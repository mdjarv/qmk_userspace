package main

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// sysReader samples CPU, memory, temperature, GPU and power from /proc and
// /sys under root ("/" outside tests). CPU load needs two samples, so the
// first read reports zero load.
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
	var s Sys
	s.CPU = uint8(r.cpuLoad()*100 + 0.5)
	s.RAM = r.memPercent()
	s.Temp = uint8(r.hwmon("k10temp", "temp1_input") / 1000)
	watts := r.hwmon("amdgpu", "power1_input")
	if watts == 0 {
		watts = r.hwmon("amdgpu", "power1_average")
	}
	s.Power = uint8(min(watts/1_000_000, 255))
	s.GPU = r.gpuBusy()
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

func (r *sysReader) memPercent() uint8 {
	data, err := os.ReadFile(r.path("proc/meminfo"))
	if err != nil {
		return 0
	}
	var total, avail float64
	for line := range strings.Lines(string(data)) {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		v, _ := strconv.ParseFloat(f[1], 64)
		switch f[0] {
		case "MemTotal:":
			total = v
		case "MemAvailable:":
			avail = v
		}
	}
	if total == 0 {
		return 0
	}
	return uint8((total-avail)/total*100 + 0.5)
}

// hwmon reads a value from the hwmon device with that name, 0 if missing.
func (r *sysReader) hwmon(name, file string) uint64 {
	dirs, _ := filepath.Glob(r.path("sys/class/hwmon/hwmon*"))
	for _, d := range dirs {
		n, err := os.ReadFile(filepath.Join(d, "name"))
		if err != nil || strings.TrimSpace(string(n)) != name {
			continue
		}
		return readUint(filepath.Join(d, file))
	}
	return 0
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
