package main

import (
	"bytes"
	"fmt"
	"path/filepath"
)

// scenes are set pieces for design rounds: each starts a fresh game, sets
// something up in front of the player and returns the time to draw it at.
var scenes = []struct {
	name string
	run  func() uint32
}{
	{"rat", func() uint32 { put(1, 'r'); return 0 }},
	{"bat", func() uint32 { put(1, 'b'); return 0 }},
	{"skeleton", func() uint32 { put(1, 'k'); return 0 }},
	{"slime", func() uint32 { put(1, 'm'); return 0 }},
	{"skeleton-far", func() uint32 { put(2, 'k'); return 0 }},
	{"rat-farthest", func() uint32 { put(3, 'r'); return 0 }},
	{"potion", func() uint32 { put(1, 'p'); return 0 }},
	{"sword-far", func() uint32 { put(2, 's'); return 0 }},
	{"stairs", func() uint32 { put(1, '>'); return 0 }},
	{"on-stairs", func() uint32 { put(1, '>'); press(buttons["w"], 100); return 100 }},
	{"hit", func() uint32 {
		put(1, 'm')
		for now := uint32(1000); now < 20000; now += 1000 { // until a blow lands
			press(buttons["space"], now)
			if !bytes.Equal(render(now+50), render(now+400)) {
				return now + 50
			}
		}
		return 0
	}},
	{"behind", func() uint32 { put(1, 'k'); press(buttons["q"], 10); press(buttons["q"], 20); return 20 }},
	{"dead", func() uint32 { setHP(0); return 0 }},
}

func writeScenes(dir string, seed uint32, scale int) error {
	for i, s := range scenes {
		start(seed+uint32(i), 0)
		path := filepath.Join(dir, fmt.Sprintf("%02d-%s.png", i, s.name))
		t := s.run()
		if err := writePNG(path, render(t), renderHUD(t), scale); err != nil {
			return err
		}
	}
	return nil
}
