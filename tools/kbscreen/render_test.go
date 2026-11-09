package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// Only changed chunks go out, a present always follows, an unchanged frame is
// re-presented once a second so the keyboard keeps it, and every chunk is
// resent every 5 s for a keyboard that missed them.
func TestFrameSender(t *testing.T) {
	var s frameSender
	now := time.Unix(1000, 0)
	frame := make([]byte, frameSize)
	frame[0] = 1

	rs := s.reports(frame, now)
	if len(rs) != chunkCount+1 || rs[0][0] != msgFrame || rs[0][2] != 1 || rs[len(rs)-1][0] != msgPresent {
		t.Fatalf("first frame: %d reports", len(rs))
	}
	if rs := s.reports(frame, now.Add(frameRate)); rs != nil {
		t.Fatalf("unchanged frame sent %d reports", len(rs))
	}
	if rs := s.reports(frame, now.Add(keepAlive)); len(rs) != 1 || rs[0][0] != msgPresent {
		t.Fatalf("keepalive: % x", rs)
	}
	frame[511] = 0x80 // last chunk holds bytes 504..511
	rs = s.reports(frame, now.Add(keepAlive+frameRate))
	if len(rs) != 2 || rs[0][1] != chunkCount-1 || rs[0][2+511-504] != 0x80 {
		t.Fatalf("one changed byte: % x", rs)
	}
	if rs := s.reports(frame, now.Add(fullEvery)); len(rs) != chunkCount+1 {
		t.Fatalf("full resend: %d reports", len(rs))
	}
}

func testData(playing bool, agents *Agents) jsData {
	now := time.Date(2026, 11, 6, 14, 53, 0, 0, time.Local)
	m := Media{Playing: playing, Title: "Björk – Jóga", Artist: "Björk", Position: 102, Length: 238, Volume: 40,
		VolumeChanged: now.Add(-time.Second), BandsAt: now}
	m.Art[0] = 0xFF
	m.Bands[2] = 200
	s := Sys{CPU: 47, GPU: 12, RAMUsed: 18.4, RAMTotal: 31, VRAMUsed: 22.6, VRAMTotal: 32, Battery: 76, BatteryState: batteryCharging}
	return toJS(s, []uint8{10, 50, 90}, []uint8{5, 5, 80}, m, agents, now)
}

// The built-in scripts draw every screen: the farm by itself, fishing after a
// knob press, music while playing, perf two presses on, and the farm without
// Agentique.
func TestBuiltInScreensRender(t *testing.T) {
	r, err := newRenderer("")
	if err != nil {
		t.Fatal(err)
	}
	if d := testData(true, nil); d.Media.Title != "Bjork - Joga" || d.Sys.Clock != "14:53" {
		t.Fatalf("data: %q %q", d.Media.Title, d.Sys.Clock)
	}
	agents := &Agents{Rows: []AgentRow{{Name: "QMK", State: agentWorking, ID: "a"}, {Name: "SEISI", State: agentWaiting, ID: "b"}}, Running: 1, Waiting: 2,
		LaterWaiting: 1, OldestWait: 72 * time.Hour, NewQuestion: true}
	seen := map[string][]byte{}
	for _, c := range []struct {
		name    string
		d       jsData
		presses int
	}{
		{"farm", testData(false, agents), 0},
		{"fishing", testData(false, agents), 1}, // farm -> fishing
		{"music", testData(true, agents), 0},
		{"perf", testData(false, agents), 2}, // farm -> fishing -> perf, round the end
		{"no agentique", testData(false, nil), 0},
	} {
		r.frame(c.d, 0) // lets the script see the context before the presses
		for range c.presses {
			if err := r.pressKnob(eventKnob); err != nil {
				t.Fatalf("%s: knob: %v", c.name, err)
			}
		}
		f, err := r.frame(c.d, 1000)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if bytes.Count(f, []byte{0}) == frameSize {
			t.Fatalf("%s: blank frame", c.name)
		}
		for other, g := range seen {
			if bytes.Equal(f, g) {
				t.Fatalf("%s drew the same frame as %s", c.name, other)
			}
		}
		seen[c.name] = f
	}
}

func copyScripts(t *testing.T) string {
	dir := t.TempDir()
	err := fs.WalkDir(embeddedScripts, "js", func(path string, e fs.DirEntry, err error) error {
		if err != nil || e.IsDir() {
			return err
		}
		b, err := fs.ReadFile(embeddedScripts, path)
		if err == nil {
			write(t, filepath.Join(dir, strings.TrimPrefix(path, "js/")), b)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

func touch(t *testing.T, path string, src string, at time.Time) {
	write(t, path, []byte(src))
	if err := os.Chtimes(path, at, at); err != nil {
		t.Fatal(err)
	}
}

// Saving a script that does not load keeps the last good one drawing; the
// next good save takes over.
func TestReloadKeepsLastGoodScript(t *testing.T) {
	dir := copyScripts(t)
	r, err := newRenderer(dir)
	if err != nil {
		t.Fatal(err)
	}
	d := testData(false, nil)
	before, _ := r.frame(d, 0)

	path := filepath.Join(dir, "main.js")
	touch(t, path, "function render(d, t) { return f.buf", time.Now().Add(time.Minute))
	if !r.changed() {
		t.Fatal("a saved script was not noticed")
	}
	if err := r.load(); err == nil {
		t.Fatal("a broken script loaded")
	}
	if f, err := r.frame(d, 0); err != nil || !bytes.Equal(f, before) {
		t.Fatalf("the last good script stopped drawing: %v", err)
	}

	touch(t, path, "function render(d, t) { f.fill(0, 0, W, H); return f.buf; }", time.Now().Add(2*time.Minute))
	if err := r.load(); err != nil {
		t.Fatal(err)
	}
	if f, _ := r.frame(d, 0); bytes.Count(f, []byte{0xFF}) != frameSize {
		t.Fatal("the new script is not drawing")
	}
}

func TestRunawayScriptIsStopped(t *testing.T) {
	dir := copyScripts(t)
	write(t, filepath.Join(dir, "main.js"), []byte("function render(d, t) { for (;;) {} }"))
	r, err := newRenderer(dir)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	_, err = r.frame(testData(false, nil), 0)
	if err == nil || !strings.Contains(err.Error(), "longer than") || time.Since(start) > time.Second {
		t.Fatalf("runaway render: %v after %s", err, time.Since(start))
	}
	// the runtime is usable again afterwards
	if _, err := r.frame(testData(false, nil), 0); err == nil || !strings.Contains(err.Error(), "longer than") {
		t.Fatalf("second render: %v", err)
	}
}

// What the built-in screens do with the knob gestures and the display object:
// a double press goes back a screen, a long press back to automatic, music
// keeps the screens on, the night dims them; the keyboard's state reaches d.
func TestBuiltInKnobAndDisplay(t *testing.T) {
	r, err := newRenderer("")
	if err != nil {
		t.Fatal(err)
	}
	d := testData(false, nil)
	auto, _ := r.frame(d, 0)
	r.pressKnob(eventKnob)
	next, _ := r.frame(d, 0)
	r.pressKnob(eventKnobDouble)
	if f, _ := r.frame(d, 0); !bytes.Equal(f, auto) || bytes.Equal(f, next) {
		t.Fatal("double press did not go back a screen")
	}
	r.pressKnob(eventKnob)
	r.pressKnob(eventKnobLong)
	if f, _ := r.frame(d, 0); !bytes.Equal(f, auto) {
		t.Fatal("long press did not go back to the automatic screen")
	}
	if disp := r.display(); disp.keepAwake || disp.brightness != 255 {
		t.Fatalf("idle afternoon: %+v", disp)
	}
	d = testData(true, nil)
	d.Sys.Clock = "23:10"
	r.frame(d, 0)
	if disp := r.display(); !disp.keepAwake || disp.brightness >= 255 {
		t.Fatalf("music at night: %+v", disp)
	}
	if kb := toKeyboard(2, 0x20|0x01); kb.Layer != "lower" || !kb.Ctrl || !kb.Shift || kb.Alt || kb.Gui {
		t.Fatalf("keyboard state: %+v", kb)
	}
}

// A new file in pages/ is noticed and becomes a page, after the built-in ones
// in the knob order.
func TestNewPageFileIsLoaded(t *testing.T) {
	dir := copyScripts(t)
	r, err := newRenderer(dir)
	if err != nil {
		t.Fatal(err)
	}
	touch(t, filepath.Join(dir, "pages", "40-zoo.js"),
		"'use strict';\npage('zoo', (function () { return function zoo(d, t) { f.fill(0, 0, W, H); }; })());\n",
		time.Now().Add(time.Minute))
	if !r.changed() {
		t.Fatal("a new page file was not noticed")
	}
	if err := r.load(); err != nil {
		t.Fatal(err)
	}
	d := testData(false, nil)
	d.Media.VolumeChangedAgo = -1 // no volume readout over the page
	r.frame(d, 0)
	r.pressKnob(eventKnob) // farm -> fishing
	r.pressKnob(eventKnob) // fishing -> zoo
	if f, err := r.frame(d, 0); err != nil || bytes.Count(f, []byte{0xFF}) != frameSize {
		t.Fatalf("the zoo page did not show: %v", err)
	}
}

// The scripts' save object survives a reload and a restart; a save file that
// is not JSON is moved aside and the game starts over.
func TestSaveSurvivesReloadAndRestart(t *testing.T) {
	dir := copyScripts(t)
	count := "function render(d, t) { save.n = (save.n || 0) + 1; return f.buf; }\n"
	touch(t, filepath.Join(dir, "main.js"), count, time.Now().Add(-time.Hour))
	path := filepath.Join(t.TempDir(), "state", "save.json")
	saved := func(r *renderer, want string) {
		t.Helper()
		if err := r.saveState(time.Now(), true); err != nil {
			t.Fatal(err)
		}
		if b, _ := os.ReadFile(path); string(b) != want {
			t.Fatalf("save file = %q, want %q", b, want)
		}
	}
	d := testData(false, nil)

	r, err := newRenderer(dir)
	if err != nil || r.persist(path) != nil {
		t.Fatal(err)
	}
	for range 3 {
		r.frame(d, 0)
	}
	saved(r, `{"n":3}`)
	touch(t, filepath.Join(dir, "main.js"), count+"// edited\n", time.Now())
	if err := r.load(); err != nil {
		t.Fatal(err)
	}
	r.frame(d, 0)
	saved(r, `{"n":4}`)

	r, _ = newRenderer(dir)
	if err := r.persist(path); err != nil {
		t.Fatal(err)
	}
	r.frame(d, 0)
	saved(r, `{"n":5}`)

	write(t, path, []byte("{not json"))
	r, _ = newRenderer(dir)
	if err := r.persist(path); err == nil {
		t.Fatal("a broken save file must be reported")
	}
	if _, err := os.Stat(path + ".bad"); err != nil {
		t.Fatal("the broken save file was not kept aside")
	}
	r.frame(d, 0)
	saved(r, `{"n":1}`)
}

// The pages read every field of d by its json name, nested ones included.
func TestPagesSeeAgentTotals(t *testing.T) {
	dir := copyScripts(t)
	touch(t, filepath.Join(dir, "main.js"), "function render(d, t) { save.turns = d.agents.totals.turns; return f.buf; }\n", time.Now())
	r, err := newRenderer(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.frame(testData(false, &Agents{Totals: Totals{Turns: 3945}}), 0); err != nil {
		t.Fatal(err)
	}
	r.checkpoint()
	if r.saveJSON != `{"turns":3945}` {
		t.Fatalf("save = %s", r.saveJSON)
	}
}

// The farm keeps going behind another page: with music on screen, a session
// that works gets its bed, and once it is done and seen its crop is harvested.
func TestFarmRunsWhileHidden(t *testing.T) {
	r, err := newRenderer("")
	if err != nil {
		t.Fatal(err)
	}
	var saved struct {
		Harvest int                        `json:"harvest"`
		Crops   map[string]json.RawMessage `json:"crops"`
	}
	step := func(state uint8) {
		t.Helper()
		a := &Agents{Rows: []AgentRow{{Name: "QMK", State: state, ID: "s1"}}, Sessions: []Session{{ID: "s1", Name: "QMK", State: state}}}
		for i := range 3 {
			if _, err := r.frame(testData(true, a), int64(i)*50); err != nil { // music playing: the farm is not drawn
				t.Fatal(err)
			}
		}
		r.checkpoint()
		saved.Crops = nil
		if err := json.Unmarshal([]byte(r.saveJSON), &saved); err != nil {
			t.Fatal(err)
		}
	}
	step(agentWorking)
	if _, ok := saved.Crops["s1"]; !ok {
		t.Fatalf("no bed for a session working behind the music page: %s", r.saveJSON)
	}
	step(agentDone)
	step(agentIdle)
	if saved.Harvest != 1 || saved.Crops["s1"] != nil {
		t.Fatalf("the crop was not harvested behind the music page: %s", r.saveJSON)
	}
}

// The preview's buttons: the farm offers its events as actions, and one set
// off by hand plays through as a show, leaving the game in the save alone.
func TestFarmActionIsAShowOnly(t *testing.T) {
	r, err := newRenderer("")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(r.actions(), "farm: meteor") {
		t.Fatalf("actions = %v", r.actions())
	}
	a := &Agents{Rows: []AgentRow{{Name: "QMK", State: agentWorking, ID: "s1"}}, Sessions: []Session{{ID: "s1", Name: "QMK", State: agentWorking}}}
	d := testData(false, a)
	d.Media.VolumeChangedAgo = -1
	r.frame(d, 0)
	r.checkpoint()
	before := r.saveJSON
	if err := r.runAction("farm: meteor"); err != nil {
		t.Fatal(err)
	}
	for ms := int64(50); ms < 16000; ms += 50 {
		if _, err := r.frame(d, ms); err != nil {
			t.Fatalf("at %d ms: %v", ms, err)
		}
	}
	r.checkpoint()
	var b, after map[string]any
	json.Unmarshal([]byte(before), &b)
	json.Unmarshal([]byte(r.saveJSON), &after)
	for _, k := range []string{"meteorWeek", "harvest", "crater", "crops", "homedWeek", "sold"} {
		if fmt.Sprint(b[k]) != fmt.Sprint(after[k]) {
			t.Fatalf("the show changed %s: %v -> %v", k, b[k], after[k])
		}
	}
	if err := r.runAction("nope"); err == nil {
		t.Fatal("an unknown action must fail")
	}
}
