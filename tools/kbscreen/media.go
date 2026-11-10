package main

import (
	"bufio"
	"context"
	"log"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// Media state comes from playerctl (MPRIS) and wpctl/pactl (volume).

const playerFormat = "{{status}}\t{{mpris:length}}\t{{xesam:title}}\t{{xesam:artist}}"

type trackInfo struct {
	playing       bool
	length        uint16
	title, artist string
}

func parseTrack(line string) trackInfo {
	f := strings.Split(line, "\t")
	if len(f) < 4 || f[0] == "" {
		return trackInfo{}
	}
	us, _ := strconv.ParseUint(f[1], 10, 64)
	return trackInfo{
		playing: f[0] == "Playing",
		length:  uint16(min(us/1_000_000, 65535)),
		title:   f[2],
		artist:  f[3],
	}
}

// followPlayer calls onTrack with every change playerctl reports, restarting
// playerctl when it exits.
func followPlayer(ctx context.Context, onTrack func(trackInfo)) {
	for ctx.Err() == nil {
		cmd := exec.CommandContext(ctx, "playerctl", "--follow", "metadata", "--format", playerFormat)
		out, err := cmd.StdoutPipe()
		if err == nil {
			err = cmd.Start()
		}
		if err != nil {
			log.Printf("media: playerctl: %v", err)
			sleep(ctx, 30*time.Second)
			continue
		}
		sc := bufio.NewScanner(out)
		for sc.Scan() {
			onTrack(parseTrack(sc.Text()))
		}
		if err := sc.Err(); err != nil {
			log.Printf("media: playerctl: %v", err)
		}
		cmd.Wait()
		onTrack(trackInfo{})
		sleep(ctx, 2*time.Second)
	}
}

func playerPosition(ctx context.Context) (uint16, bool) {
	out, err := exec.CommandContext(ctx, "playerctl", "position").Output()
	if err != nil {
		return 0, false
	}
	s, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil || s < 0 {
		return 0, false
	}
	return uint16(min(s, 65535)), true
}

// parseVolume reads wpctl's "Volume: 0.40" or "Volume: 0.40 [MUTED]".
func parseVolume(s string) (pct uint8, muted, ok bool) {
	f := strings.Fields(s)
	if len(f) < 2 || f[0] != "Volume:" {
		return 0, false, false
	}
	v, err := strconv.ParseFloat(f[1], 64)
	if err != nil {
		return 0, false, false
	}
	return uint8(min(v*100+0.5, 254)), strings.Contains(s, "[MUTED]"), true
}

func readVolume(ctx context.Context) (uint8, bool, bool) {
	out, err := exec.CommandContext(ctx, "wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@").Output()
	if err != nil {
		return 0, false, false
	}
	return parseVolume(string(out))
}

// followVolume calls onVolume at start and after every sink or server change
// pactl reports.
func followVolume(ctx context.Context, onVolume func(pct uint8, muted bool)) {
	for ctx.Err() == nil {
		if v, m, ok := readVolume(ctx); ok {
			onVolume(v, m)
		}
		cmd := exec.CommandContext(ctx, "pactl", "subscribe")
		out, err := cmd.StdoutPipe()
		if err == nil {
			err = cmd.Start()
		}
		if err != nil {
			log.Printf("media: pactl: %v", err)
			sleep(ctx, 30*time.Second)
			continue
		}
		sc := bufio.NewScanner(out)
		for sc.Scan() {
			if line := sc.Text(); strings.Contains(line, " sink ") || strings.Contains(line, " server") {
				if v, m, ok := readVolume(ctx); ok {
					onVolume(v, m)
				}
			}
		}
		if err := sc.Err(); err != nil {
			log.Printf("media: pactl: %v", err)
		}
		cmd.Wait()
		sleep(ctx, 2*time.Second)
	}
}

func sleep(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
