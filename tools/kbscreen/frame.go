package main

// Frames for the keyboard's left OLED over Raw HID. The firmware side is
// keyboards/.../keymaps/mdjarv/hostdata.h.

import "time"

const (
	reportSize = 32
	frameSize  = 512 // 32x128, OLED layout: byte x + (y/8)*32, bit y%8
	chunkSize  = 28
	chunkCount = (frameSize + chunkSize - 1) / chunkSize

	msgFrame      = 0x10 // [1] chunk  [2..29] bytes at chunk*28 into the back buffer
	msgPresent    = 0x11 // show the back buffer
	msgBrightness = 0x12 // [1] 0..255
	msgKeepAwake  = 0x13 // [1] seconds to keep the OLEDs on; repeated while wanted
	msgEvent      = 0x80 // keyboard to host: [1] event kind  [2..] data

	eventKnob       = 1
	eventState      = 2 // [2] highest layer  [3] mods
	eventKnobLong   = 3
	eventKnobDouble = 4

	fullEvery = 5 * time.Second // resend every chunk: a reflashed keyboard has none
	keepAlive = time.Second     // present at least this often; the keyboard gives up after 3 s
)

type report [reportSize]byte

// frameSender turns frames into the reports that update the keyboard: the
// chunks that changed since the last frame, then a present.
type frameSender struct {
	last             [frameSize]byte
	lastFull, lastAt time.Time
}

func (s *frameSender) reports(frame []byte, now time.Time) []report {
	full := now.Sub(s.lastFull) >= fullEvery
	var out []report
	for c := range chunkCount {
		lo, hi := c*chunkSize, min((c+1)*chunkSize, frameSize)
		if !full && string(frame[lo:hi]) == string(s.last[lo:hi]) {
			continue
		}
		r := report{msgFrame, byte(c)}
		copy(r[2:], frame[lo:hi])
		out = append(out, r)
	}
	if len(out) == 0 && now.Sub(s.lastAt) < keepAlive {
		return nil
	}
	copy(s.last[:], frame)
	if full {
		s.lastFull = now
	}
	s.lastAt = now
	return append(out, report{msgPresent})
}

// reset makes the next frame go out whole, for a keyboard that just appeared.
func (s *frameSender) reset() { *s = frameSender{} }
