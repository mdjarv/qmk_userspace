package main

import (
	"cmp"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dop251/goja"
)

// The screens are JavaScript run in goja: js/lib.js, then js/pages/*.js in
// name order (one page each), then js/main.js. With a script directory they
// reload when a file changes, appears or goes; a version that fails to load
// leaves the last good one running.

//go:embed js/*.js js/pages/*.js
var embeddedScripts embed.FS

const renderTimeout = 200 * time.Millisecond // a runaway script is stopped after this

type renderer struct {
	dir    string // "" runs the scripts built into the binary
	vm     *goja.Runtime
	render goja.Callable
	knob   goja.Callable
	mtimes map[string]time.Time

	// The scripts' global save object outlives a runtime: each fresh one
	// (a reload) starts from the last JSON.stringify(save), and saveState
	// writes it to savePath.
	savePath             string
	saveJSON, savedJSON  string // the latest, and what is on disk
	checkedAt, writtenAt time.Time
}

func newRenderer(dir string) (*renderer, error) {
	r := &renderer{dir: dir}
	if err := r.load(); err != nil {
		return nil, err
	}
	return r, nil
}

// scripts lists the files to load, relative to the script directory.
func (r *renderer) scripts() ([]string, error) {
	var pages []string
	var err error
	if r.dir == "" {
		pages, err = fs.Glob(embeddedScripts, "js/pages/*.js")
		for i := range pages {
			pages[i] = strings.TrimPrefix(pages[i], "js/")
		}
	} else {
		pages, err = filepath.Glob(filepath.Join(r.dir, "pages", "*.js"))
		for i := range pages {
			pages[i] = filepath.Join("pages", filepath.Base(pages[i]))
		}
	}
	if err != nil {
		return nil, err
	}
	sort.Strings(pages)
	return append(append([]string{"lib.js"}, pages...), "main.js"), nil
}

func (r *renderer) source(name string) (string, error) {
	var b []byte
	var err error
	if r.dir == "" {
		b, err = fs.ReadFile(embeddedScripts, "js/"+filepath.ToSlash(name))
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
	names, _ := r.scripts()
	for _, name := range names {
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
	r.checkpoint()
	vm.Set("SAVE_JSON", cmp.Or(r.saveJSON, "{}"))
	if _, err := vm.RunString("globalThis.save = JSON.parse(SAVE_JSON)"); err != nil {
		return err
	}
	names, err := r.scripts()
	if err != nil {
		return err
	}
	for _, name := range names {
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
		return errors.New("main.js defines no render(d, t)")
	}
	knob, _ := goja.AssertFunction(vm.Get("knob"))
	r.vm, r.render, r.knob, r.mtimes = vm, render, knob, mtimes
	return nil
}

// persist keeps the save object in path (a missing file starts empty) and
// reloads the scripts with it. A file that is not JSON is moved aside.
func (r *renderer) persist(path string) error {
	r.savePath = path
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !json.Valid(b) {
		os.Rename(path, path+".bad")
		return fmt.Errorf("%s is not JSON; moved it to %s.bad and started over", path, path)
	}
	r.saveJSON, r.savedJSON = string(b), string(b)
	if r.vm != nil { // load checkpoints the running scripts first: hand them the file
		r.vm.Set("SAVE_JSON", r.saveJSON)
		r.vm.RunString("globalThis.save = JSON.parse(SAVE_JSON)")
	}
	return r.load()
}

// checkpoint takes the running scripts' save object.
func (r *renderer) checkpoint() {
	if r.vm == nil {
		return
	}
	v, err := runBounded(r.vm, func() (goja.Value, error) {
		return r.vm.RunString("JSON.stringify(typeof save === 'object' && save !== null ? save : {})")
	})
	if err == nil {
		r.saveJSON = v.String()
	}
}

// saveState checkpoints once a second and writes a changed save every 10 s;
// force does both now (on the way out).
func (r *renderer) saveState(now time.Time, force bool) error {
	if !force && now.Sub(r.checkedAt) < time.Second {
		return nil
	}
	r.checkedAt = now
	r.checkpoint()
	if r.savePath == "" || r.saveJSON == r.savedJSON || (!force && now.Sub(r.writtenAt) < 10*time.Second) {
		return nil
	}
	r.writtenAt = now
	if err := os.MkdirAll(filepath.Dir(r.savePath), 0o755); err != nil {
		return err
	}
	tmp := r.savePath + ".tmp"
	if err := os.WriteFile(tmp, []byte(r.saveJSON), 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, r.savePath); err != nil {
		return err
	}
	r.savedJSON = r.saveJSON
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

// display is what the scripts set in their display object: brightness 0..255
// and whether to keep the OLEDs on.
type display struct {
	brightness int
	keepAwake  bool
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

func (r *renderer) display() display {
	out := display{brightness: 255}
	obj := r.vm.Get("display")
	if obj == nil || goja.IsUndefined(obj) || goja.IsNull(obj) {
		return out
	}
	o := obj.ToObject(r.vm)
	if v := o.Get("brightness"); v != nil && !goja.IsUndefined(v) {
		out.brightness = int(min(max(v.ToInteger(), 0), 255))
	}
	if v := o.Get("keepAwake"); v != nil {
		out.keepAwake = v.ToBoolean()
	}
	return out
}

var knobKinds = map[byte]string{eventKnob: "press", eventKnobLong: "long", eventKnobDouble: "double"}

// pressKnob calls knob(kind) with "press", "long" or "double".
func (r *renderer) pressKnob(kind byte) error {
	if r.knob == nil || knobKinds[kind] == "" {
		return nil
	}
	_, err := runBounded(r.vm, func() (goja.Value, error) { return r.knob(goja.Undefined(), r.vm.ToValue(knobKinds[kind])) })
	return err
}

// What render(d, t) gets. Field names are the json tags.
type jsData struct {
	Sys      jsSys       `json:"sys"`
	Media    jsMedia     `json:"media"`
	Agents   *jsAgents   `json:"agents"`   // null without Agentique
	Keyboard *jsKeyboard `json:"keyboard"` // null until the keyboard reports
}

type jsKeyboard struct {
	Layer string `json:"layer"` // base, game, lower, raise
	Ctrl  bool   `json:"ctrl"`
	Shift bool   `json:"shift"`
	Alt   bool   `json:"alt"`
	Gui   bool   `json:"gui"`
}

// The keymap's layers, in layers.h order.
var layerNames = []string{"base", "game", "lower", "raise"}

func toKeyboard(layer, mods byte) *jsKeyboard {
	name := "layer" + strconv.Itoa(int(layer))
	if int(layer) < len(layerNames) {
		name = layerNames[layer]
	}
	// QMK's mod bits: ctrl, shift, alt, gui on the left, then the same on the right
	has := func(bit byte) bool { return mods&(bit|bit<<4) != 0 }
	return &jsKeyboard{Layer: name, Ctrl: has(1), Shift: has(2), Alt: has(4), Gui: has(8)}
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
	Sessions     []jsSession  `json:"sessions"`
	Totals       Totals       `json:"totals"`
	Running      int          `json:"running"`
	Waiting      int          `json:"waiting"`
	LaterWaiting int          `json:"laterWaiting"`
	LaterIdle    int          `json:"laterIdle"`
	OldestWait   string       `json:"oldestWait"` // 3D
	NewQuestion  bool         `json:"newQuestion"`
}

type jsAgentRow struct {
	ID      string `json:"id"`
	Parent  string `json:"parent"`  // "" for a top-level session
	Helpers int    `json:"helpers"` // subagents running inside its turn
	Name    string `json:"name"`
	State   string `json:"state"` // working, waiting, done, idle
}

var batteryNames = []string{"hidden", "discharging", "charging"}

type jsSession struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	State  string `json:"state"` // a row's states, parked, archived
	Turns  int    `json:"turns"`
	Merged bool   `json:"merged"`
	Parent string `json:"parent"`
	// Helpers are subagents running inside its turn.
	Helpers int `json:"helpers"`
}

var agentNames = []string{"idle", "working", "waiting", "done", "parked", "archived"}

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
		j := &jsAgents{Rows: []jsAgentRow{}, Sessions: []jsSession{}, Totals: a.Totals, Running: a.Running, Waiting: a.Waiting, LaterWaiting: a.LaterWaiting,
			LaterIdle: a.LaterIdle, OldestWait: ageText(a.OldestWait), NewQuestion: a.NewQuestion}
		for _, r := range a.Rows {
			j.Rows = append(j.Rows, jsAgentRow{ID: r.ID, Parent: r.Parent, Helpers: r.Helpers, Name: strings.ToUpper(asciiOnly(r.Name)), State: agentNames[min(int(r.State), len(agentNames)-1)]})
		}
		for _, s := range a.Sessions {
			j.Sessions = append(j.Sessions, jsSession{ID: s.ID, Name: strings.ToUpper(asciiOnly(s.Name)),
				State: agentNames[min(int(s.State), len(agentNames)-1)], Turns: s.Turns, Merged: s.Merged,
				Parent: s.Parent, Helpers: s.Helpers})
		}
		d.Agents = j
	}
	return d
}
