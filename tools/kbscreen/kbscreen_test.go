package main

import (
	"context"
	"image"
	"image/color"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
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

type needsYou = struct {
	UnseenCompletedAt string `json:"unseenCompletedAt"`
	ApprovalTool      string `json:"approvalTool"`
	Question          bool   `json:"question"`
	SurfacesWaiting   int    `json:"surfacesWaiting"`
	WaitingSince      string `json:"waitingSince"`
}

func TestAgentsNowAndLater(t *testing.T) {
	now := time.Date(2026, 11, 6, 13, 0, 0, 0, time.UTC)
	unseen := &needsYou{UnseenCompletedAt: "2026-11-06T09:00:00Z"}
	two, ctx := 2, 41.6
	sessions := []readSession{
		{ID: "s1", ProjectID: "p1", State: "idle", UpdatedAt: "2026-11-06T12:10:00Z", TurnCount: 4, Model: "opus"},
		{ID: "s2", ProjectID: "p2", State: "running", UpdatedAt: "2026-11-06T12:58:00.5Z", TurnCount: 1, Model: "fable", ParentID: "s1", InFlight: &two, ContextPct: &ctx},
		// stopped (parked) and done stay off the rows, even with an unseen turn
		{ID: "s3", ProjectID: "p3", State: "stopped", NeedsYou: unseen, UpdatedAt: "2026-11-06T12:59:00Z"},
		{ID: "s4", ProjectID: "p3", State: "done", UpdatedAt: "2026-11-06T12:59:00Z"},
		// a question from days ago only counts; a new one gets a row and the flag
		{ID: "s5", ProjectID: "p4", State: "idle", NeedsYou: &needsYou{Question: true, WaitingSince: "2026-11-03T13:00:00Z"}, UpdatedAt: "2026-11-03T13:00:00Z"},
		{ID: "s6", ProjectID: "p6", State: "idle", NeedsYou: &needsYou{SurfacesWaiting: 1, WaitingSince: "2026-11-06T12:55:00Z"}, UpdatedAt: "2026-11-06T12:55:00Z"},
		{ID: "s7", ProjectID: "p5", State: "idle", NeedsYou: unseen, UpdatedAt: "2026-11-06T12:30:00Z"},
		{ID: "s8", ProjectID: "p1", State: "idle", UpdatedAt: "2026-11-05T10:00:00Z"},
		// archived: today's is still a session for the game, older ones only count
		{ID: "a1", ProjectID: "p1", State: "stopped", ArchivedAt: "2026-11-06T11:00:00Z", TurnCount: 7, Merged: true, Model: "opus"},
		{ID: "a2", ProjectID: "p2", State: "done", ArchivedAt: "2026-11-01T11:00:00Z", TurnCount: 3},
	}
	names := map[string]string{"p1": "QMK Userspace", "p2": "The Pint", "p3": "Agentique", "p4": "seisiun", "p5": "terminal-drift", "p6": "hittat"}
	a := summarize(sessions, names, now)
	want := []AgentRow{{"PINT", agentWorking, "s2", "s1", 2, 42}, {"HITTA", agentWaiting, "s6", "", 0, -1}, {"TERMI", agentDone, "s7", "", 0, -1}, {"QMK", agentIdle, "s1", "", 0, -1}}
	if len(a.Rows) != len(want) || a.Running != 1 || a.Waiting != 2 || a.LaterWaiting != 1 || a.LaterIdle != 1 ||
		a.OldestWait != 72*time.Hour || !a.NewQuestion {
		t.Fatalf("summarize = %+v", a)
	}
	for i := range want {
		if a.Rows[i] != want[i] {
			t.Fatalf("row %d = %+v, want %+v", i, a.Rows[i], want[i])
		}
	}
	states := map[string]uint8{}
	for _, s := range a.Sessions {
		states[s.ID] = s.State
	}
	if len(states) != 8 || states["s3"] != agentParked || states["a1"] != agentArchived || states["s5"] != agentWaiting {
		t.Fatalf("sessions = %+v", a.Sessions)
	}
	if a.Totals != (Totals{Sessions: 10, Turns: 15, Archived: 2, Merged: 1, Models: 2}) {
		t.Fatalf("totals = %+v", a.Totals)
	}

	if ageText(5*time.Minute) != "5M" || ageText(3*time.Hour) != "3H" || ageText(72*time.Hour) != "3D" {
		t.Fatal("ageText")
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

// A server on another host, from the config file: its URL is used as given
// and the token goes in the Authorization header. Councils come from every
// machine, newest first; a 404 (an Agentique without them) is none.
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
		// another machine it reaches, and one it does not
		case "/api/read/machines":
			w.Write([]byte(`{"machines":[{"id":"m1","self":true},{"id":"m2","reach":"ok"},{"id":"m3","reach":"pending"}]}`))
		case "/api/read/machines/m2/sessions":
			w.Write([]byte(`{"sessions":[{"id":"w1","projectId":"p2","state":"running","parentId":"lead"}]}`))
		case "/api/read/machines/m2/councils":
			w.Write([]byte(`{"councils":[{"id":"old","status":"ended","updatedAt":"2026-11-09T08:00:00Z"},
				{"id":"new","title":"Kärnfrågan","status":"live","running":true,"round":2,"autoRounds":3,"updatedAt":"2026-11-09T09:30:00.5Z",
				"cast":[{"name":"Sókrates","role":"questioner","state":"tool","turn":2,"tool":"WebSearch"}]}]}`))
		case "/api/read/machines/m2/projects":
			w.Write([]byte(`{"projects":[{"id":"p2","name":"The Pint"}]}`))
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
	if err != nil || len(a.Rows) != 2 || a.Rows[0].Name != "QMK" ||
		a.Rows[1] != (AgentRow{Name: "PINT", State: agentWorking, ID: "w1", Parent: "lead", Context: -1}) {
		t.Fatalf("agents = %+v, %v", a, err)
	}
	d := toJS(Sys{}, nil, nil, Media{}, &a, time.Now())
	if len(d.Councils) != 2 || d.Councils[0].ID != "new" || d.Councils[0].Title != "Karnfragan" || d.Councils[0].Round != 2 ||
		d.Councils[0].Cast[0] != (jsCouncilMember{Name: "Sokrates", Role: "questioner", State: "tool", Turn: 2, Tool: "WebSearch"}) {
		t.Fatalf("councils = %+v", d.Councils)
	}
	if _, err := newRemoteAgentiqueClient("host:19201", "x"); err == nil {
		t.Fatal("a URL without a scheme must be refused")
	}
}

// VRAM counts what spilled into GTT; the battery only shows while it charges
// or discharges.
func TestSysMemoryAndBattery(t *testing.T) {
	root := t.TempDir()
	write(t, root+"/proc/meminfo", []byte("MemTotal:       32505856 kB\nMemAvailable:   13238272 kB\n"))
	dev := root + "/sys/class/drm/card1/device/"
	write(t, dev+"mem_info_vram_total", []byte("34359738368\n"))
	write(t, dev+"mem_info_vram_used", []byte("21474836480\n"))
	write(t, dev+"mem_info_gtt_used", []byte("2147483648\n"))
	write(t, root+"/sys/class/power_supply/BAT0/capacity", []byte("76\n"))
	write(t, root+"/sys/class/power_supply/BAT0/status", []byte("Charging\n"))

	s := newSysReader(root).read()
	if math.Abs(s.RAMUsed-18.4) > 0.05 || math.Round(s.RAMTotal) != 31 || s.VRAMUsed != 22 || s.VRAMTotal != 32 ||
		s.Battery != 76 || s.BatteryState != batteryCharging {
		t.Fatalf("sys = %+v", s)
	}
	for status, want := range map[string]uint8{"Discharging": batteryDischarging, "Full": batteryHidden, "Not charging": batteryHidden} {
		write(t, root+"/sys/class/power_supply/BAT0/status", []byte(status+"\n"))
		if _, st := newSysReader(root).battery(); st != want {
			t.Fatalf("%s: state %d, want %d", status, st, want)
		}
	}
}

// The weather comes from Open-Meteo's answer for the place in the config: the
// WMO code grouped into a sky, sunrise and sunset as clock times.
func TestWeatherFromOpenMeteo(t *testing.T) {
	var query url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.Query()
		w.Write([]byte(`{"current":{"temperature_2m":-1.5,"weather_code":73,"is_day":0,"wind_speed_10m":12.0},
			"daily":{"time":["2026-11-09"],"sunrise":["2026-11-09T07:22"],"sunset":["2026-11-09T16:00"]}}`))
	}))
	defer srv.Close()
	cfg := filepath.Join(t.TempDir(), "config.toml")
	write(t, cfg, []byte("[agentique]\ntoken = \"aqt_x\"\n\n[weather]\nlat = 56.182  # Gräsvik\nlon = 15.590\n"))
	lat, lon, ok := weatherPlace(cfg)
	if !ok || lat != 56.182 || lon != 15.59 {
		t.Fatalf("place = %v %v %v", lat, lon, ok)
	}
	w, err := fetchWeather(context.Background(), srv.Client(), srv.URL, lat, lon)
	want := Weather{Sky: "snow", Code: 73, Temp: -1.5, Wind: 12, Day: false, Sunrise: "07:22", Sunset: "16:00"}
	if err != nil || w != want || query.Get("latitude") != "56.182" || query.Get("longitude") != "15.590" {
		t.Fatalf("weather = %+v, %v (query %v)", w, err, query)
	}
	for code, sky := range map[int]string{0: "clear", 3: "cloud", 45: "fog", 61: "rain", 81: "rain", 86: "snow", 95: "storm"} {
		if skyOf(code) != sky {
			t.Fatalf("skyOf(%d) = %s, want %s", code, skyOf(code), sky)
		}
	}
}
