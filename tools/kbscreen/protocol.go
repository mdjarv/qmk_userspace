package main

// Raw HID reports for the keyboard's left OLED. The firmware side, and the
// byte layout of each report, is keyboards/.../keymaps/mdjarv/hostdata.h.

import (
	"strings"
	"time"
)

const reportSize = 32

type report [reportSize]byte

const (
	msgSys      = 0x01
	msgMedia    = 0x02
	msgText     = 0x03
	msgArt      = 0x04
	msgSpectrum = 0x05
	msgAgents   = 0x06
)

const (
	textTitle  = 0
	textArtist = 1
	textMax    = 64
	textChunk  = 28
	artSize    = 128
	artChunk   = 28
	bandCount  = 10
	agentRows  = 6 // sessions updated in the last hour
	agentChunk = 3
)

const (
	agentIdle = iota
	agentWorking
	agentWaiting
	agentDone
)

type Sys struct {
	CPU, Temp, RAM, GPU, Power uint8
}

func (s Sys) report() report {
	return report{msgSys, s.CPU, s.Temp, s.RAM, s.GPU, s.Power}
}

type Media struct {
	Playing, Muted   bool
	Position, Length uint16 // seconds
	Volume           uint8  // percent, 255 unknown
	Title, Artist    string
	Art              [artSize]byte
}

func (m Media) report() report {
	r := report{msgMedia}
	if m.Playing {
		r[1] = 1
	}
	r[2], r[3] = byte(m.Position), byte(m.Position>>8)
	r[4], r[5] = byte(m.Length), byte(m.Length>>8)
	r[6] = m.Volume
	if m.Muted {
		r[7] = 1
	}
	return r
}

func textReports(field byte, s string) []report {
	b := []byte(asciiOnly(s))
	if len(b) > textMax {
		b = b[:textMax]
	}
	var out []report
	for off := 0; off == 0 || off < len(b); off += textChunk {
		r := report{msgText, field, byte(len(b)), byte(off)}
		copy(r[4:], b[off:])
		out = append(out, r)
	}
	return out
}

func artReports(art [artSize]byte) []report {
	var out []report
	for c := 0; c*artChunk < artSize; c++ {
		r := report{msgArt, byte(c)}
		copy(r[2:2+artChunk], art[c*artChunk:])
		out = append(out, r)
	}
	return out
}

func spectrumReport(bands [bandCount]uint8) report {
	r := report{msgSpectrum}
	copy(r[1:], bands[:])
	return r
}

type AgentRow struct {
	Name  string
	State uint8
}

type Agents struct {
	Rows             []AgentRow // updated in the last hour, newest first; agentRows are sent
	Running, Waiting int        // over every live session
	LaterWaiting     int        // questions older than an hour
	LaterIdle        int        // idle or finished sessions older than an hour
	OldestWait       time.Duration
	NewQuestion      bool // a session started waiting in the last 10 minutes
}

func (a Agents) reports() []report {
	rows := a.Rows[:min(len(a.Rows), agentRows)]
	var out []report
	for first := 0; first == 0 || first < len(rows); first += agentChunk {
		chunk := rows[first:min(first+agentChunk, len(rows))]
		r := report{msgAgents, byte(len(rows)), byte(first), byte(len(chunk)),
			clamp8(a.Running), clamp8(a.Waiting), clamp8(a.LaterWaiting), clamp8(a.LaterIdle), ageCode(a.OldestWait)}
		if a.NewQuestion {
			r[9] = 1
		}
		for i, row := range chunk {
			name := []byte(asciiOnly(strings.ToUpper(row.Name)) + "     ")[:5]
			copy(r[10+i*6:], name)
			r[10+i*6+5] = row.State
		}
		out = append(out, r)
	}
	return out
}

// ageCode packs an age into a byte: minutes 0..59, then 60+hours up to a day,
// then 84+days.
func ageCode(d time.Duration) byte {
	switch {
	case d < time.Hour:
		return byte(max(d, 0) / time.Minute)
	case d < 24*time.Hour:
		return byte(60 + d/time.Hour)
	default:
		return byte(min(84+d/(24*time.Hour), 255))
	}
}

func clamp8(n int) byte { return byte(min(max(n, 0), 255)) }

var fold = strings.NewReplacer(
	"å", "a", "ä", "a", "à", "a", "á", "a", "â", "a", "ã", "a", "Å", "A", "Ä", "A", "À", "A", "Á", "A",
	"ö", "o", "ø", "o", "ó", "o", "ò", "o", "ô", "o", "Ö", "O", "Ø", "O", "Ó", "O",
	"é", "e", "è", "e", "ê", "e", "ë", "e", "É", "E", "È", "E",
	"í", "i", "ì", "i", "ï", "i", "ú", "u", "ù", "u", "ü", "u", "Ü", "U",
	"ñ", "n", "ç", "c", "ß", "ss", "æ", "ae", "Æ", "AE",
	"‘", "'", "’", "'", "“", "\"", "”", "\"", "–", "-", "—", "-", "…", "...",
)

// asciiOnly folds common accents and replaces anything else outside
// printable ASCII with '?': the OLED font has nothing else.
func asciiOnly(s string) string {
	s = fold.Replace(s)
	var b strings.Builder
	for _, r := range s {
		if r >= 32 && r < 127 {
			b.WriteRune(r)
		} else {
			b.WriteByte('?')
		}
	}
	return b.String()
}
