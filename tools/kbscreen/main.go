// kbscreen draws the Sofle's left OLED and sends it over Raw HID: system
// load, what is playing, and Agentique sessions. The screens are JavaScript in
// js/; with -scripts they reload on save.
package main

import (
	"cmp"
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

const (
	vendorID  = 0x8D1D
	productID = 0xEC32
	frameRate = 50 * time.Millisecond // the OLED redraws every 50 ms anyway
)

// state is what the sources have learned; the render loop draws it.
type state struct {
	mu               sync.Mutex
	sys              Sys
	cpuHist, gpuHist []uint8
	media            Media
	agents           Agents
	hasAgents        bool
	artURL           string // the track whose art media.Art is, or is waiting for
	keyboard         *jsKeyboard
	weather          *Weather // nil until the first answer, or without a place
}

func (s *state) update(f func(*state)) {
	s.mu.Lock()
	f(s)
	s.mu.Unlock()
}

func (s *state) data(now time.Time) jsData {
	s.mu.Lock()
	defer s.mu.Unlock()
	var a *Agents
	if s.hasAgents {
		a = &s.agents
	}
	d := toJS(s.sys, s.cpuHist, s.gpuHist, s.media, a, now)
	d.Keyboard = s.keyboard
	if w := s.weather; w != nil {
		d.Weather = &jsWeather{Sky: w.Sky, Code: w.Code, Temp: w.Temp, Wind: w.Wind, Day: w.Day, Sunrise: w.Sunrise, Sunset: w.Sunset}
	}
	return d
}

func main() {
	home, _ := os.UserHomeDir()
	config := flag.String("config", filepath.Join(home, ".config/kbscreen/config.toml"),
		"config file: [agentique] url and token, [weather] lat and lon (see README)")
	scripts := flag.String("scripts", "", "directory with lib.js, pages/*.js and main.js, reloaded on save (default: the built-in ones)")
	preview := flag.String("preview", "", "serve a live preview of the screen on this address, e.g. localhost:8077")
	dry := flag.Bool("dry", false, "do not look for the keyboard; log the data once a second")
	stateDir := cmp.Or(os.Getenv("XDG_STATE_HOME"), filepath.Join(home, ".local/state"))
	save := flag.String("save", filepath.Join(stateDir, "kbscreen/save.json"), "where the scripts' save object is kept (\"\" keeps it in memory)")
	flag.Parse()
	log.SetFlags(0)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	rend, err := newRenderer(*scripts)
	if err != nil {
		log.Fatalf("scripts: %v", err)
	}
	if *save != "" {
		if err := rend.persist(*save); err != nil {
			log.Printf("save: %v", err)
		}
	}
	var pv *previewServer
	if *preview != "" {
		if pv, err = startPreview(ctx, *preview); err != nil {
			log.Fatalf("preview: %v", err)
		}
		log.Printf("preview on http://%s", *preview)
	}

	st := &state{media: Media{Volume: 255}}
	spectrum := make(chan [bandCount]uint8, 1)
	go pollSys(ctx, st)
	go watchMedia(ctx, st, spectrum)
	if c := agentiqueFromConfig(*config, filepath.Join(home, ".config/agentique")); c != nil {
		go pollAgents(ctx, st, c)
	}
	if lat, lon, ok := weatherPlace(*config); ok {
		go pollWeather(ctx, st, lat, lon)
	}
	if *dry {
		go logData(ctx, st)
	}
	run(ctx, st, rend, pv, !*dry, spectrum)
}

// run draws a frame every frameRate and sends what changed to the keyboard,
// reconnecting when it goes away. Knob presses go to the scripts.
func run(ctx context.Context, st *state, rend *renderer, pv *previewServer, useDevice bool, spectrum <-chan [bandCount]uint8) {
	start := time.Now()
	tick := time.NewTicker(frameRate)
	defer tick.Stop()
	var (
		dev       *device
		events    <-chan event
		sender    frameSender
		shown     display // last brightness sent
		brightAt  time.Time
		awakeAt   time.Time
		nextOpen  time.Time
		lastCheck time.Time
		say       = dedupLog()
	)
	defer func() {
		if dev != nil {
			dev.close()
		}
	}()
	for {
		select {
		case <-ctx.Done():
			if err := rend.saveState(time.Now(), true); err != nil {
				log.Printf("save: %v", err)
			}
			return
		case b := <-spectrum:
			st.update(func(st *state) { st.media.Bands, st.media.BandsAt = b, time.Now() })
			continue
		case ev, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			if ev.kind == eventState {
				kb := toKeyboard(ev.a, ev.b)
				st.update(func(st *state) { st.keyboard = kb })
			} else if err := rend.pressKnob(ev.kind); err != nil {
				say("knob: %v", err)
			}
			continue
		case <-tick.C:
		}
		now := time.Now()

		if rend.dir != "" && now.Sub(lastCheck) >= 500*time.Millisecond {
			lastCheck = now
			if rend.changed() {
				if err := rend.load(); err != nil {
					say("scripts: %v (keeping the last good version)", err)
					pv.setError(err)
				} else {
					log.Printf("scripts reloaded")
					pv.setError(nil)
				}
			}
		}

		frame, err := rend.frame(st.data(now), now.Sub(start).Milliseconds())
		if err != nil {
			say("render: %v", err)
			pv.setError(err)
			continue
		}
		pv.setFrame(frame)
		if err := rend.saveState(now, false); err != nil {
			say("save: %v", err)
		}

		if !useDevice {
			continue
		}
		if dev == nil && !now.Before(nextOpen) {
			path, err := findRawHID("/sys", vendorID, productID)
			if err == nil {
				dev, err = openDevice(path)
			}
			if err != nil {
				say("keyboard: %v; retrying", err)
				nextOpen = now.Add(2 * time.Second)
				continue
			}
			log.Printf("sending to %s", path)
			events = dev.events()
			sender.reset()
			brightAt, awakeAt = time.Time{}, time.Time{}
		}
		if dev == nil {
			continue
		}
		reports := sender.reports(frame, now)
		// brightness on change and with every full resend; keep-awake every second while wanted
		disp := rend.display()
		if disp.brightness != shown.brightness || now.Sub(brightAt) >= fullEvery {
			reports = append(reports, report{msgBrightness, byte(disp.brightness)})
			shown.brightness, brightAt = disp.brightness, now
		}
		if disp.keepAwake && now.Sub(awakeAt) >= time.Second {
			reports = append(reports, report{msgKeepAwake, 3})
			awakeAt = now
		}
		for _, r := range reports {
			if err := dev.send(r); err != nil {
				say("keyboard: %v; reconnecting", err)
				dev.close()
				dev, events = nil, nil
				nextOpen = now.Add(2 * time.Second)
				break
			}
		}
	}
}

// dedupLog logs a message only when it differs from the previous one.
func dedupLog() func(format string, args ...any) {
	var last string
	return func(format string, args ...any) {
		msg := fmt.Sprintf(format, args...)
		if msg != last {
			log.Print(msg)
			last = msg
		}
	}
}

func pollSys(ctx context.Context, st *state) {
	r := newSysReader("/")
	for ctx.Err() == nil {
		s := r.read()
		st.update(func(st *state) {
			st.sys = s
			st.cpuHist = appendHistory(st.cpuHist, s.CPU)
			st.gpuHist = appendHistory(st.gpuHist, s.GPU)
		})
		sleep(ctx, time.Second)
	}
}

func appendHistory(h []uint8, v uint8) []uint8 {
	h = append(h, v)
	if len(h) > historyN {
		h = h[len(h)-historyN:]
	}
	return h
}

// agentiqueFromConfig makes the Agentique client from kbscreen's config file:
//
//	[agentique]
//	url = "https://host.tailnet.ts.net:19201"  # optional; unset means this machine's server
//	token = "aqt_..."                           # agentique tokens add kbscreen --perm read
func agentiqueFromConfig(path, localDir string) *agentiqueClient {
	cfg, err := os.ReadFile(path)
	if err != nil {
		log.Printf("agents: %v; the agent screen stays off", err)
		return nil
	}
	token, remote := tomlString(cfg, "token"), tomlString(cfg, "url")
	if token == "" {
		log.Printf("agents: no token in %s; the agent screen stays off", path)
		return nil
	}
	var c *agentiqueClient
	if remote != "" {
		c, err = newRemoteAgentiqueClient(remote, token)
	} else {
		c, err = newAgentiqueClient(localDir, token)
	}
	if err != nil {
		log.Printf("agents: %v; the agent screen stays off", err)
		return nil
	}
	return c
}

func pollAgents(ctx context.Context, st *state, c *agentiqueClient) {
	var lastErr string
	for ctx.Err() == nil {
		a, err := c.agents(ctx)
		if err != nil {
			if err.Error() != lastErr {
				log.Printf("agents: %v", err)
				lastErr = err.Error()
			}
		} else {
			lastErr = ""
		}
		st.update(func(st *state) { st.agents, st.hasAgents = a, err == nil })
		sleep(ctx, 2*time.Second)
	}
}

// watchMedia follows the player and the volume, polls the position while
// playing, and runs the spectrum analyser only while something plays.
func watchMedia(ctx context.Context, st *state, spectrum chan<- [bandCount]uint8) {
	tracks := make(chan trackInfo, 4)
	go followPlayer(ctx, func(t trackInfo) { tracks <- t })
	go followVolume(ctx, func(v uint8, muted bool) {
		st.update(func(st *state) {
			if st.media.Volume != 255 && (v != st.media.Volume || muted != st.media.Muted) {
				st.media.VolumeChanged = time.Now()
			}
			st.media.Volume, st.media.Muted = v, muted
		})
	})

	var cur trackInfo
	var stopSpectrum context.CancelFunc
	pos := time.NewTicker(time.Second)
	defer pos.Stop()
	for {
		select {
		case <-ctx.Done():
			if stopSpectrum != nil {
				stopSpectrum()
			}
			return
		case t := <-tracks:
			artChanged := t.artURL != cur.artURL
			cur = t
			st.update(func(st *state) {
				st.media.Playing, st.media.Length = t.playing, t.length
				st.media.Title, st.media.Artist = t.title, t.artist
				if artChanged {
					st.media.Art, st.artURL = [artSize]byte{}, t.artURL
				}
			})
			if artChanged && t.artURL != "" {
				go func(url string) {
					img, err := loadArt(ctx, url)
					if err != nil {
						log.Printf("media: %v", err)
						return
					}
					art := ditherArt(img)
					st.update(func(st *state) {
						if st.artURL == url { // still the same track
							st.media.Art = art
						}
					})
				}(t.artURL)
			}
			if t.playing && stopSpectrum == nil {
				var sctx context.Context
				sctx, stopSpectrum = context.WithCancel(ctx)
				go runSpectrum(sctx, spectrum)
			} else if !t.playing && stopSpectrum != nil {
				stopSpectrum()
				stopSpectrum = nil
			}
		case <-pos.C:
			if cur.playing {
				if p, ok := playerPosition(ctx); ok {
					st.update(func(st *state) { st.media.Position = p })
				}
			}
		}
	}
}

func logData(ctx context.Context, st *state) {
	for ctx.Err() == nil {
		sleep(ctx, time.Second)
		d := st.data(time.Now())
		s, m := d.Sys, d.Media
		log.Printf("cpu %d%% gpu %d%% ram %.1f/%.0fG vram %.1f/%.0fG battery %d%% %s %s",
			s.CPU, s.GPU, s.RAMUsed, s.RAMTotal, s.VRAMUsed, s.VRAMTotal, s.Battery, s.BatteryState, s.Clock)
		log.Printf("media playing=%v %d/%ds vol %d muted=%v %q / %q bands %v", m.Playing, m.Position, m.Length, m.Volume, m.Muted, m.Title, m.Artist, m.Bands)
		if a := d.Agents; a != nil {
			log.Printf("agents run %d wait %d, later wait %d (oldest %s) idle %d, new question %v, rows %v",
				a.Running, a.Waiting, a.LaterWaiting, a.OldestWait, a.LaterIdle, a.NewQuestion, a.Rows)
		}
	}
}
