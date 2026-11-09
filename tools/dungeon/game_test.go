package main

import (
	"bytes"
	"math/rand/v2"
	"testing"
)

// These test the core's contract (deterministic, answers keys, survives any
// input), not what it draws, so changing the game's look does not break them.
// Run with -asan (make dungeon-test) so the soak catches writes out of bounds.

func play(seed uint32, presses []int) []byte {
	start(seed, 0)
	now := uint32(0)
	for _, b := range presses {
		now += 200
		press(b, now)
	}
	return render(now)
}

func TestSameSeedAndKeysDrawTheSameFrame(t *testing.T) {
	keys := []int{buttons["w"], buttons["a"], buttons["w"], buttons["d"], buttons["space"]}
	if a, b := play(7, keys), play(7, keys); !bytes.Equal(a, b) {
		t.Fatal("same seed and keys drew different frames")
	}
}

func TestAKeyChangesTheFrame(t *testing.T) {
	before := play(7, nil)
	for _, k := range []string{"w", "a", "s", "d", "q", "e"} {
		if !bytes.Equal(play(7, []int{buttons[k]}), before) {
			return
		}
	}
	t.Fatal("no key changed the frame")
}

func TestSurvivesRandomPlay(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	for range 50 {
		start(r.Uint32(), r.Uint32()) // a clock anywhere, wrap included
		now := r.Uint32()
		for i := range 2000 {
			now += uint32(r.IntN(3000))
			press(r.IntN(10), now) // past the last button too
			if i%7 == 0 {
				render(now)
				renderHUD(now)
			}
		}
	}
}

func TestSpaceStartsAgainAfterDying(t *testing.T) {
	start(7, 0)
	setHP(0)
	dead := render(100)
	press(buttons["w"], 200)
	if !bytes.Equal(render(100), dead) {
		t.Fatal("a key other than Space left the death screen")
	}
	press(buttons["space"], 300)
	if bytes.Equal(render(100), dead) {
		t.Fatal("Space did not start a new game")
	}
}

// A turn glides from the key press: a frame shortly after it is between the
// old view and the new one. Only the top half of the view is compared (rows
// 0-63, above the hands, whose flame flickers), all within one torch-flicker
// period (250 ms).
func TestATurnGlidesFromThePress(t *testing.T) {
	top := func(f []byte) []byte { return f[:256] }
	start(7, 0)
	before := top(render(1000))
	press(buttons["q"], 1000)
	mid, end := top(render(1080)), top(render(1240))
	if bytes.Equal(mid, before) || bytes.Equal(mid, end) {
		t.Fatal("the view 80 ms after a turn is not between the old and new view")
	}
}
