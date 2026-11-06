package main

import (
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dop251/goja"
)

// The screens are JavaScript (js/lib.js, then js/screens.js), run in goja.
// With a script directory they reload when a file changes; a version that
// fails to load leaves the last good one running.

//go:embed js/*.js
var embeddedScripts embed.FS

var scriptFiles = []string{"lib.js", "screens.js"}

const renderTimeout = 200 * time.Millisecond // a runaway script is stopped after this

type renderer struct {
	dir    string // "" runs the scripts built into the binary
	vm     *goja.Runtime
	render goja.Callable
	knob   goja.Callable
	mtimes map[string]time.Time
}

func newRenderer(dir string) (*renderer, error) {
	r := &renderer{dir: dir}
	if err := r.load(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *renderer) source(name string) (string, error) {
	var b []byte
	var err error
	if r.dir == "" {
		b, err = fs.ReadFile(embeddedScripts, "js/"+name)
	} else {
		b, err = os.ReadFile(filepath.Join(r.dir, name))
	}
	return string(b), err
}

func (r *renderer) stat() map[string]time.Time {
	m := map[string]time.Time{}
	if r.dir == "" {
		return m
	}
	for _, name := range scriptFiles {
		if fi, err := os.Stat(filepath.Join(r.dir, name)); err == nil {
			m[name] = fi.ModTime()
		}
	}
	return m
}

// load runs the scripts in a fresh runtime and swaps it in only if they load.
func (r *renderer) load() error {
	mtimes := r.stat()
	vm := goja.New()
	vm.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
	vm.Set("FONT_BUFFER", vm.NewArrayBuffer(glcdFont))
	for _, name := range scriptFiles {
		src, err := r.source(name)
		if err != nil {
			return err
		}
		if _, err := runBounded(vm, func() (goja.Value, error) { return vm.RunScript(name, src) }); err != nil {
			return err
		}
	}
	render, ok := goja.AssertFunction(vm.Get("render"))
	if !ok {
		return errors.New("screens.js defines no render(d, t)")
	}
	knob, _ := goja.AssertFunction(vm.Get("knob"))
	r.vm, r.render, r.knob, r.mtimes = vm, render, knob, mtimes
	return nil
}

// changed reports whether a script file changed since it was last loaded.
func (r *renderer) changed() bool {
	now := r.stat()
	for name, t := range now {
		if !r.mtimes[name].Equal(t) {
			return true
		}
	}
	return len(now) != len(r.mtimes)
}

func runBounded(vm *goja.Runtime, f func() (goja.Value, error)) (goja.Value, error) {
	timer := time.AfterFunc(renderTimeout, func() { vm.Interrupt("script took longer than " + renderTimeout.String()) })
	defer func() {
		timer.Stop()
		vm.ClearInterrupt()
	}()
	return f()
}

// frame renders one frame from d at t milliseconds.
func (r *renderer) frame(d jsData, t int64) ([]byte, error) {
	v, err := runBounded(r.vm, func() (goja.Value, error) {
		return r.render(goja.Undefined(), r.vm.ToValue(d), r.vm.ToValue(t))
	})
	if err != nil {
		return nil, err
	}
	b, ok := v.Export().([]byte)
	if !ok || len(b) != frameSize {
		return nil, fmt.Errorf("render returned %T of %d bytes, want a %d-byte Uint8Array", v.Export(), len(b), frameSize)
	}
	return append([]byte(nil), b...), nil
}

func (r *renderer) pressKnob() error {
	if r.knob == nil {
		return nil
	}
	_, err := runBounded(r.vm, func() (goja.Value, error) { return r.knob(goja.Undefined()) })
	return err
}

// What render(d, t) gets. Field names are the json tags.
type jsData struct {
	Sys    jsSys     `json:"sys"`
	Media  jsMedia   `json:"media"`
	Agents *jsAgents `json:"agents"` // null without Agentique
}

type jsSys struct {
	CPU          int     `json:"cpu"`
	GPU          int     `json:"gpu"`
	CPUHistory   []int   `json:"cpuHistory"` // percent, oldest first, one a second
	GPUHistory   []int   `json:"gpuHistory"`
	RAMUsed      float64 `json:"ramUsed"` // GiB
	RAMTotal     float64 `json:"ramTotal"`
	VRAMUsed     float64 `json:"vramUsed"`
	VRAMTotal    float64 `json:"vramTotal"`
	Battery      int     `json:"battery"`      // percent
	BatteryState string  `json:"batteryState"` // charging, discharging, hidden
	Clock        string  `json:"clock"`        // 14:53
}

type jsMedia struct {
	Playing          bool   `json:"playing"`
	Title            string `json:"title"`
	Artist           string `json:"artist"`
	Position         int    `json:"position"` // seconds
	Length           int    `json:"length"`
	Volume           int    `json:"volume"` // percent, -1 unknown
	Muted            bool   `json:"muted"`
	VolumeChangedAgo int    `json:"volumeChangedAgo"` // ms, -1 never
	Art              []int  `json:"art"`              // 128 bytes, 32x32 in OLED layout
	Bands            []int  `json:"bands"`            // 10 spectrum bands 0..255, zero when silent
}

type jsAgents struct {
	Rows         []jsAgentRow `json:"rows"`
	Running      int          `json:"running"`
	Waiting      int          `json:"waiting"`
	LaterWaiting int          `json:"laterWaiting"`
	LaterIdle    int          `json:"laterIdle"`
	OldestWait   string       `json:"oldestWait"` // 3D
	NewQuestion  bool         `json:"newQuestion"`
}

type jsAgentRow struct {
	Name  string `json:"name"`
	State string `json:"state"` // working, waiting, done, idle
}

var batteryNames = []string{"hidden", "discharging", "charging"}
var agentNames = []string{"idle", "working", "waiting", "done"}

func toJS(sys Sys, cpuHist, gpuHist []uint8, m Media, a *Agents, now time.Time) jsData {
	ints := func(b []uint8) []int {
		out := make([]int, len(b))
		for i, v := range b {
			out[i] = int(v)
		}
		return out
	}
	d := jsData{
		Sys: jsSys{
			CPU: int(sys.CPU), GPU: int(sys.GPU), CPUHistory: ints(cpuHist), GPUHistory: ints(gpuHist),
			RAMUsed: sys.RAMUsed, RAMTotal: sys.RAMTotal, VRAMUsed: sys.VRAMUsed, VRAMTotal: sys.VRAMTotal,
			Battery: int(sys.Battery), BatteryState: batteryNames[min(int(sys.BatteryState), len(batteryNames)-1)],
			Clock: now.Format("15:04"),
		},
		Media: jsMedia{
			Playing: m.Playing, Title: asciiOnly(m.Title), Artist: asciiOnly(m.Artist),
			Position: int(m.Position), Length: int(m.Length), Volume: -1, Muted: m.Muted, VolumeChangedAgo: -1,
			Art: ints(m.Art[:]), Bands: make([]int, bandCount),
		},
	}
	if m.Volume != 255 {
		d.Media.Volume = int(m.Volume)
	}
	if !m.VolumeChanged.IsZero() {
		d.Media.VolumeChangedAgo = int(now.Sub(m.VolumeChanged).Milliseconds())
	}
	if now.Sub(m.BandsAt) < 300*time.Millisecond {
		d.Media.Bands = ints(m.Bands[:])
	}
	if a != nil {
		j := &jsAgents{Rows: []jsAgentRow{}, Running: a.Running, Waiting: a.Waiting, LaterWaiting: a.LaterWaiting,
			LaterIdle: a.LaterIdle, OldestWait: ageText(a.OldestWait), NewQuestion: a.NewQuestion}
		for _, r := range a.Rows {
			j.Rows = append(j.Rows, jsAgentRow{Name: strings.ToUpper(asciiOnly(r.Name)), State: agentNames[min(int(r.State), len(agentNames)-1)]})
		}
		d.Agents = j
	}
	return d
}
