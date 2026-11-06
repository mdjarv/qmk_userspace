package main

import (
	"context"
	"image"
	"image/color"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func write(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// The keyboard exposes several hidraw nodes with the same IDs; only the one
// whose descriptor starts with usage page 0xFF60 takes our reports.
func TestFindRawHIDPicksRawInterface(t *testing.T) {
	sys := t.TempDir()
	uevent := []byte("DRIVER=hid-generic\nHID_ID=0003:00008D1D:0000EC32\nHID_NAME=splitkb.com Aurora Sofle v2\n")
	write(t, sys+"/class/hidraw/hidraw3/device/uevent", uevent)
	write(t, sys+"/class/hidraw/hidraw3/device/report_descriptor", []byte{0x05, 0x01, 0x09, 0x06}) // keyboard
	write(t, sys+"/class/hidraw/hidraw4/device/uevent", uevent)
	write(t, sys+"/class/hidraw/hidraw4/device/report_descriptor", []byte{0x06, 0x60, 0xFF, 0x09, 0x61})
	write(t, sys+"/class/hidraw/hidraw5/device/uevent", []byte("HID_ID=0003:0000046D:0000C52B\n"))
	write(t, sys+"/class/hidraw/hidraw5/device/report_descriptor", []byte{0x06, 0x60, 0xFF})

	got, err := findRawHID(sys, vendorID, productID)
	if err != nil || got != "/dev/hidraw4" {
		t.Fatalf("findRawHID = %q, %v; want /dev/hidraw4", got, err)
	}
}

func TestTextReportsChunkAndClear(t *testing.T) {
	long := ""
	for len(long) < 70 {
		long += "abcdefghij"
	}
	rs := textReports(textTitle, long)
	if len(rs) != 3 || rs[2][2] != textMax || rs[2][3] != 56 || rs[1][4] != long[28] {
		t.Fatalf("long title reports: %d, last % x", len(rs), rs[len(rs)-1])
	}
	// an empty title must still reach the keyboard, or the old one stays up
	rs = textReports(textArtist, "")
	if len(rs) != 1 || rs[0][1] != textArtist || rs[0][2] != 0 {
		t.Fatalf("empty artist reports: % x", rs)
	}
	if got := asciiOnly("Björk – Jóga ♪"); got != "Bjork - Joga ?" {
		t.Fatalf("asciiOnly = %q", got)
	}
}

func TestAgentsOrderCountsAndReports(t *testing.T) {
	waiting := &struct {
		UnseenCompletedAt string `json:"unseenCompletedAt"`
		ApprovalTool      string `json:"approvalTool"`
		Question          bool   `json:"question"`
		SurfacesWaiting   int    `json:"surfacesWaiting"`
		WaitingSince      string `json:"waitingSince"`
	}{SurfacesWaiting: 1}
	sessions := []readSession{
		{ProjectID: "p1", State: "idle", UpdatedAt: "2026-11-06T10:00:00Z"},
		{ProjectID: "p2", State: "running"},
		{ProjectID: "p3", State: "stopped"},
		{ProjectID: "p4", State: "idle", NeedsYou: waiting},
		{ProjectID: "p5", State: "idle", UpdatedAt: "2026-11-06T12:00:00Z"},
	}
	names := map[string]string{"p1": "QMK Userspace", "p2": "The Pint", "p4": "seisiun", "p5": "terminal-drift"}
	a := summarize(sessions, names)
	want := []AgentRow{{"SEISI", agentWaiting}, {"PINT", agentWorking}, {"TERMI", agentIdle}, {"QMK", agentIdle}}
	if len(a.Rows) != len(want) || a.Waiting != 1 || a.Running != 1 || a.Idle != 2 {
		t.Fatalf("summarize = %+v", a)
	}
	for i := range want {
		if a.Rows[i] != want[i] {
			t.Fatalf("row %d = %+v, want %+v", i, a.Rows[i], want[i])
		}
	}

	for range 6 {
		a.Rows = append(a.Rows, AgentRow{"X", agentIdle})
	}
	rs := a.reports()
	if len(rs) != 2 || rs[0][1] != agentRows || rs[1][2] != 4 || rs[1][3] != 4 || string(rs[0][7:12]) != "SEISI" || rs[0][12] != agentWaiting {
		t.Fatalf("agent reports: % x", rs)
	}
	if rs := (Agents{}).reports(); len(rs) != 1 || rs[0][1] != 0 {
		t.Fatalf("no sessions must still send one report: % x", rs)
	}
}

// The art goes straight into the OLED buffer: byte x + page*32, bit 0 on top.
func TestDitherArtOLEDLayout(t *testing.T) {
	img := image.NewGray(image.Rect(0, 0, 64, 64))
	for y := range 32 { // top half white
		for x := range 64 {
			img.SetGray(x, y, color.Gray{255})
		}
	}
	art := ditherArt(img)
	if art[0] != 0xFF || art[31+32] != 0xFF || art[64] != 0 || art[127] != 0 {
		t.Fatalf("art pages: %x %x %x %x", art[0], art[63], art[64], art[127])
	}
}

func TestCPULoadFromStatDeltas(t *testing.T) {
	root := t.TempDir()
	write(t, root+"/proc/stat", []byte("cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 100 0 0 0 0 0 0 0 0 0\nintr 1\n"))
	r := newSysReader(root)
	if s := r.read(); s.CPU != 0 {
		t.Fatalf("first read CPU = %d, want 0", s.CPU)
	}
	// +300 busy, +100 idle, +50 guest (already in user, so not counted twice)
	write(t, root+"/proc/stat", []byte("cpu  250 0 250 900 0 0 0 0 50 0\n"))
	if s := r.read(); s.CPU != 75 {
		t.Fatalf("CPU = %d, want 75", s.CPU)
	}
}

func TestParsers(t *testing.T) {
	if v, m, ok := parseVolume("Volume: 0.40 [MUTED]\n"); !ok || v != 40 || !m {
		t.Fatalf("parseVolume = %d %v %v", v, m, ok)
	}
	tr := parseTrack("Playing\t238000000\tNeon Harbor\tThe Lowlights\tfile:///tmp/a.png")
	if !tr.playing || tr.length != 238 || tr.title != "Neon Harbor" || tr.artURL != "file:///tmp/a.png" {
		t.Fatalf("parseTrack = %+v", tr)
	}
	if tr := parseTrack(""); tr.playing || tr.title != "" {
		t.Fatalf("no player = %+v", tr)
	}
}

func TestSpectrumPutsToneInItsBand(t *testing.T) {
	an := newAnalyzer()
	samples := make([]float64, fftSize)
	for i := range samples {
		samples[i] = 0.5 * math.Sin(2*math.Pi*1000*float64(i)/sampleRate)
	}
	bands := an.bands(samples)
	loudest := 0
	for b := range bands {
		if bands[b] > bands[loudest] {
			loudest = b
		}
	}
	bin := 1000 * fftSize / sampleRate
	if bin < an.edges[loudest] || bin >= an.edges[loudest+1] || bands[0] > 64 {
		t.Fatalf("1 kHz lit band %d (edges %v), bands %v", loudest, an.edges, bands)
	}
}

// serve frames each report for hidraw (a leading report number 0) and opens
// with the full media state so a fresh keyboard catches up.
func TestServeFramesReportsForHidraw(t *testing.T) {
	path := filepath.Join(t.TempDir(), "hidraw")
	write(t, path, nil)
	dev, err := openDevice(path)
	if err != nil {
		t.Fatal(err)
	}
	st := &state{media: Media{Title: "Song", Volume: 40}, changed: make(chan struct{}, 1)}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := serve(ctx, dev, st, nil); err != nil {
		t.Fatal(err)
	}
	dev.close()
	data, _ := os.ReadFile(path)
	// title, artist, 5 art chunks, media
	if len(data) != 8*(reportSize+1) || data[0] != 0 || data[1] != msgText || string(data[5:9]) != "Song" {
		t.Fatalf("wrote %d bytes: % x", len(data), data[:min(len(data), 40)])
	}
	last := data[7*(reportSize+1):]
	if last[1] != msgMedia || last[7] != 40 {
		t.Fatalf("last report % x", last)
	}
}

// A server on another host, from the config file: its URL is used as given
// and the token goes in the Authorization header.
func TestRemoteAgentiqueClient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer aqt_test" {
			http.Error(w, "no", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/read/sessions":
			w.Write([]byte(`{"sessions":[{"projectId":"p1","state":"running"}]}`))
		case "/api/read/projects":
			w.Write([]byte(`{"projects":[{"id":"p1","name":"QMK Userspace"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	cfg := filepath.Join(t.TempDir(), "config.toml")
	write(t, cfg, []byte("[agentique]\nurl = \""+srv.URL+"/\"  # the other host\ntoken = \"aqt_test\"\n"))
	c := agentiqueFromConfig(cfg, t.TempDir())
	if c == nil {
		t.Fatal("no client from config")
	}
	a, err := c.agents(context.Background())
	if err != nil || len(a.Rows) != 1 || a.Rows[0] != (AgentRow{"QMK", agentWorking}) {
		t.Fatalf("agents = %+v, %v", a, err)
	}
	if _, err := newRemoteAgentiqueClient("host:19201", "x"); err == nil {
		t.Fatal("a URL without a scheme must be refused")
	}
}
