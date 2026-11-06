package main

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
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

// The built-in scripts draw every screen: perf, music while playing, and the
// agent board after knob presses, with and without Agentique.
func TestBuiltInScreensRender(t *testing.T) {
	r, err := newRenderer("")
	if err != nil {
		t.Fatal(err)
	}
	if d := testData(true, nil); d.Media.Title != "Bjork - Joga" || d.Sys.Clock != "14:53" {
		t.Fatalf("data: %q %q", d.Media.Title, d.Sys.Clock)
	}
	agents := &Agents{Rows: []AgentRow{{"QMK", agentWorking}, {"SEISI", agentWaiting}}, Running: 1, Waiting: 2,
		LaterWaiting: 1, OldestWait: 72 * time.Hour, NewQuestion: true}
	seen := map[string][]byte{}
	for _, c := range []struct {
		name    string
		d       jsData
		presses int
	}{
		{"perf", testData(false, agents), 0},
		{"music", testData(true, agents), 0},
		{"agents", testData(false, agents), 2}, // perf -> music -> agents
		{"no agentique", testData(false, nil), 0},
	} {
		r.frame(c.d, 0) // lets the script see the context before the presses
		for range c.presses {
			if err := r.pressKnob(); err != nil {
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
	for _, name := range scriptFiles {
		b, err := fs.ReadFile(embeddedScripts, "js/"+name)
		if err != nil {
			t.Fatal(err)
		}
		write(t, filepath.Join(dir, name), b)
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

	path := filepath.Join(dir, "screens.js")
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

	touch(t, path, "const f = new Frame(); function render(d, t) { f.fill(0, 0, W, H); return f.buf; }", time.Now().Add(2*time.Minute))
	if err := r.load(); err != nil {
		t.Fatal(err)
	}
	if f, _ := r.frame(d, 0); bytes.Count(f, []byte{0xFF}) != frameSize {
		t.Fatal("the new script is not drawing")
	}
}

func TestRunawayScriptIsStopped(t *testing.T) {
	dir := copyScripts(t)
	write(t, filepath.Join(dir, "screens.js"), []byte("function render(d, t) { for (;;) {} }"))
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
