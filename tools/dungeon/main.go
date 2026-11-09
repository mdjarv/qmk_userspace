// Command dungeon plays the keyboard's dungeon game on the PC, from the same C
// core the firmware runs (keymaps/mdjarv/dungeon). Interactive in the
// terminal by default; with -png it plays -keys and writes the last frame.
package main

import (
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
)

func main() {
	seed := flag.Uint("seed", 0, "game seed (0: from the clock)")
	keys := flag.String("keys", "", "keys to press first, space-separated (w a s d up space esc ...)")
	out := flag.String("png", "", "write the frame after -keys to this PNG and exit")
	scale := flag.Int("scale", 4, "PNG pixel size")
	at := flag.Uint("at", 0, "ms after the last key the -png frame is drawn at")
	flag.Parse()

	if *seed == 0 {
		*seed = uint(time.Now().UnixNano())
	}
	start(uint32(*seed), 0)
	now := uint32(0)
	for k := range strings.FieldsSeq(*keys) {
		b, ok := buttons[k]
		if !ok {
			fail("unknown key %q", k)
		}
		now += 200
		press(b, now)
	}

	if *out != "" {
		if err := writePNG(*out, render(now+uint32(*at)), *scale); err != nil {
			fail("%v", err)
		}
		return
	}
	m := model{start: time.Now().Add(-time.Duration(now) * time.Millisecond), seed: uint32(*seed)}
	if _, err := tea.NewProgram(m).Run(); err != nil {
		fail("%v", err)
	}
}

func fail(format string, a ...any) {
	fmt.Fprintf(os.Stderr, "dungeon: "+format+"\n", a...)
	os.Exit(1)
}

type tickMsg struct{}

func tick() tea.Cmd {
	return tea.Tick(50*time.Millisecond, func(time.Time) tea.Msg { return tickMsg{} }) // the OLED's 20 fps
}

type model struct {
	start time.Time
	seed  uint32
}

func (m model) now() uint32 { return uint32(time.Since(m.start).Milliseconds()) }

func (m model) Init() tea.Cmd { return tick() }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tickMsg:
		return m, tick()
	case tea.KeyPressMsg:
		switch k := msg.String(); k {
		case "ctrl+c":
			return m, tea.Quit
		case "ctrl+r":
			m.seed++
			start(m.seed, m.now())
		default:
			if b, ok := buttons[k]; ok {
				press(b, m.now())
			}
		}
	}
	return m, nil
}

// View draws the frame with half blocks, two pixels to a character cell, so
// the pixels come out square: 32 columns by 64 lines.
func (m model) View() tea.View {
	f := render(m.now())
	var b strings.Builder
	fmt.Fprintf(&b, "┌%s┐\n", strings.Repeat("─", width))
	for y := 0; y < height; y += 2 {
		b.WriteString("│")
		for x := range width {
			b.WriteString([]string{" ", "▀", "▄", "█"}[btoi(lit(f, x, y))|btoi(lit(f, x, y+1))<<1])
		}
		b.WriteString("│\n")
	}
	fmt.Fprintf(&b, "└%s┘\n", strings.Repeat("─", width))
	fmt.Fprintf(&b, "seed %d  ctrl+r new  ctrl+c quit", m.seed)
	return tea.NewView(b.String())
}

func btoi(b bool) int {
	if b {
		return 1
	}
	return 0
}

func writePNG(path string, f []byte, scale int) error {
	img := frameImage(f, scale)
	w, err := os.Create(path)
	if err != nil {
		return err
	}
	if err := png.Encode(w, img); err != nil {
		w.Close()
		return err
	}
	return w.Close()
}

// frameImage draws lit pixels in the OLED's white on black.
func frameImage(f []byte, scale int) image.Image {
	img := image.NewGray(image.Rect(0, 0, width*scale, height*scale))
	for y := 0; y < height*scale; y++ {
		for x := 0; x < width*scale; x++ {
			if lit(f, x/scale, y/scale) {
				img.SetGray(x, y, color.Gray{Y: 255})
			}
		}
	}
	return img
}
