// kbscreen feeds the Sofle's left OLED over Raw HID: system load, what is
// playing, and Agentique sessions. The keyboard decides what to show.
package main

import (
	"context"
	"flag"
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
)

// state is what the sources have learned; the sender turns it into reports.
type state struct {
	mu        sync.Mutex
	sys       Sys
	media     Media
	agents    Agents
	hasAgents bool
	artURL    string        // the track whose art media.Art is, or is waiting for
	changed   chan struct{} // media text or art changed: send now
}

func (s *state) update(f func(*state)) {
	s.mu.Lock()
	f(s)
	s.mu.Unlock()
}

func (s *state) poke() {
	select {
	case s.changed <- struct{}{}:
	default:
	}
}

func main() {
	home, _ := os.UserHomeDir()
	config := flag.String("config", filepath.Join(home, ".config/kbscreen/config.toml"),
		"config file: [agentique] url and token (see README)")
	dry := flag.Bool("dry", false, "print what would be sent once a second instead of sending it")
	flag.Parse()
	log.SetFlags(0)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st := &state{media: Media{Volume: 255}, changed: make(chan struct{}, 1)}
	spectrum := make(chan [bandCount]uint8, 1)

	go pollSys(ctx, st)
	go watchMedia(ctx, st, spectrum)
	if c := agentiqueFromConfig(*config, filepath.Join(home, ".config/agentique")); c != nil {
		go pollAgents(ctx, st, c)
	}

	if *dry {
		dryRun(ctx, st, spectrum)
		return
	}
	for ctx.Err() == nil {
		path, err := findRawHID("/sys", vendorID, productID)
		if err == nil {
			var dev *device
			if dev, err = openDevice(path); err == nil {
				log.Printf("sending to %s", path)
				err = serve(ctx, dev, st, spectrum)
				dev.close()
			}
		}
		if err != nil && ctx.Err() == nil {
			log.Printf("keyboard: %v; retrying", err)
		}
		sleep(ctx, 2*time.Second)
	}
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

// serve sends reports until a write fails. Everything is resent
// periodically, so a keyboard that was replugged or reflashed catches up.
func serve(ctx context.Context, dev *device, st *state, spectrum <-chan [bandCount]uint8) error {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	sendAll := func(reports ...report) error {
		for _, r := range reports {
			if err := dev.send(r); err != nil {
				return err
			}
		}
		return nil
	}
	snapshot := func() (Sys, Media, Agents, bool) {
		st.mu.Lock()
		defer st.mu.Unlock()
		return st.sys, st.media, st.agents, st.hasAgents
	}
	full := func() error {
		_, m, _, _ := snapshot()
		reports := append(textReports(textTitle, m.Title), textReports(textArtist, m.Artist)...)
		reports = append(reports, artReports(m.Art)...)
		return sendAll(append(reports, m.report())...)
	}
	if err := full(); err != nil {
		return err
	}
	for n := 1; ; n++ {
		select {
		case <-ctx.Done():
			return nil
		case b := <-spectrum:
			if err := dev.send(spectrumReport(b)); err != nil {
				return err
			}
		case <-st.changed:
			if err := full(); err != nil {
				return err
			}
		case <-tick.C:
			s, m, a, hasAgents := snapshot()
			reports := []report{s.report(), m.report()}
			if hasAgents {
				reports = append(reports, a.reports()...)
			}
			if err := sendAll(reports...); err != nil {
				return err
			}
			if n%5 == 0 {
				if err := full(); err != nil {
					return err
				}
			}
		}
	}
}

func pollSys(ctx context.Context, st *state) {
	r := newSysReader("/")
	for ctx.Err() == nil {
		s := r.read()
		st.update(func(st *state) { st.sys = s })
		sleep(ctx, time.Second)
	}
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
		st.update(func(st *state) { st.media.Volume, st.media.Muted = v, muted })
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
					st.poke()
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
			st.poke()
		case <-pos.C:
			if cur.playing {
				if p, ok := playerPosition(ctx); ok {
					st.update(func(st *state) { st.media.Position = p })
				}
			}
		}
	}
}

func dryRun(ctx context.Context, st *state, spectrum <-chan [bandCount]uint8) {
	var bands [bandCount]uint8
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case bands = <-spectrum:
		case <-st.changed:
		case <-tick.C:
			st.mu.Lock()
			s, m, a, has := st.sys, st.media, st.agents, st.hasAgents
			st.mu.Unlock()
			art := 0
			for _, b := range m.Art {
				for ; b != 0; b &= b - 1 {
					art++
				}
			}
			log.Printf("cpu %d%% threads %v temp %dC ram %d%% gpu %d%% %dW", s.CPU, s.Threads, s.Temp, s.RAM, s.GPU, s.Power)
			log.Printf("media playing=%v %d/%ds vol %d muted=%v %q / %q art %d px lit, bands %v",
				m.Playing, m.Position, m.Length, m.Volume, m.Muted, m.Title, m.Artist, art, bands)
			if has {
				log.Printf("agents run %d wait %d idle %d rows %v", a.Running, a.Waiting, a.Idle, a.Rows)
			}
		}
	}
}
