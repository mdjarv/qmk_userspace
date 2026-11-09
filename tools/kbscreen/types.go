package main

import (
	"strconv"
	"strings"
	"time"
)

// What the sources learn about the machine. render.go hands it to the
// JavaScript screens.

const (
	artSize   = 128 // 32x32 album art in OLED layout
	bandCount = 10
	historyN  = 32 // load samples kept, one a second
)

const (
	agentIdle = iota
	agentWorking
	agentWaiting
	agentDone
	agentParked   // stopped but not archived
	agentArchived // archived in the last day
)

const (
	batteryHidden = iota // no battery, or on AC and not charging
	batteryDischarging
	batteryCharging
)

type Sys struct {
	CPU, GPU          uint8   // percent
	RAMUsed, RAMTotal float64 // GiB
	VRAMUsed          float64 // GiB, including what spilled into system memory (GTT)
	VRAMTotal         float64 // GiB
	Battery           uint8   // percent
	BatteryState      uint8   // batteryHidden, batteryDischarging, batteryCharging
}

type Media struct {
	Playing, Muted   bool
	Position, Length uint16 // seconds
	Volume           uint8  // percent, 255 unknown
	VolumeChanged    time.Time
	Title, Artist    string
	Art              [artSize]byte
	Bands            [bandCount]uint8
	BandsAt          time.Time
}

type AgentRow struct {
	Name    string
	State   uint8
	ID      string
	Parent  string // the session that started this one ("" for a top-level one)
	Helpers int    // subagents running inside its turn
}

// Session is one session as the game sees it: live, parked, or archived in
// the last day.
type Session struct {
	ID, Name string
	State    uint8
	Turns    int
	Merged   bool
	Parent   string
	Helpers  int
}

// Totals count every session Agentique lists, archived ones included.
type Totals struct {
	Sessions int `json:"sessions"`
	Turns    int `json:"turns"`
	Archived int `json:"archived"`
	Merged   int `json:"merged"`
	Models   int `json:"models"`
}

type Agents struct {
	Rows             []AgentRow // updated in the last hour, newest first
	Running, Waiting int        // over every live session
	LaterWaiting     int        // questions older than an hour
	LaterIdle        int        // idle or finished sessions older than an hour
	OldestWait       time.Duration
	NewQuestion      bool // a session started waiting in the last 10 minutes
	Sessions         []Session
	Totals           Totals
}

// ageText is a short age: 5M, 3H, 2D.
func ageText(d time.Duration) string {
	switch {
	case d < time.Hour:
		return strconv.Itoa(int(max(d, 0)/time.Minute)) + "M"
	case d < 24*time.Hour:
		return strconv.Itoa(int(d/time.Hour)) + "H"
	default:
		return strconv.Itoa(int(d/(24*time.Hour))) + "D"
	}
}

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
