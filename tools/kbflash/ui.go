package main

import (
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

// ANSI colours, so the terminal's own theme decides the shades.
var (
	styleMuted  = lipgloss.NewStyle().Foreground(lipgloss.BrightBlack)
	styleBright = lipgloss.NewStyle().Bold(true)
	styleActive = lipgloss.NewStyle().Foreground(lipgloss.Blue)
	styleDone   = lipgloss.NewStyle().Foreground(lipgloss.Green)
	styleWait   = lipgloss.NewStyle().Foreground(lipgloss.Yellow)
	styleFail   = lipgloss.NewStyle().Foreground(lipgloss.Red)
)

var spinnerFrames = []string{"⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"}

const (
	labelWidth = 10
	textWidth  = 44 // text column, so times line up on the right
	barWidth   = 30
	hintIndent = 14 // under the text column: " ✓ " + label + " "
)

type (
	rowMsg    row
	noteMsg   string
	finishMsg struct {
		lines []string
		err   error
	}
	tickMsg time.Time
)

// model renders the checklist inline (no alternate screen), so the finished
// run stays in scrollback like any other command's output.
type model struct {
	rows   []row
	notes  []string
	footer []string
	err    error
	frame  int
	done   bool
	cancel func()
}

func tick() tea.Cmd {
	return tea.Tick(100*time.Millisecond, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (m model) Init() tea.Cmd { return tick() }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case rowMsg:
		for i := range m.rows {
			if m.rows[i].key == msg.key {
				m.rows[i] = row(msg)
				return m, nil
			}
		}
		m.rows = append(m.rows, row(msg))
	case noteMsg:
		m.notes = append(m.notes, string(msg))
	case tickMsg:
		m.frame++
		if !m.done {
			return m, tick()
		}
	case tea.KeyPressMsg:
		if msg.String() == "ctrl+c" {
			m.cancel() // the worker stops picotool and reports back via finishMsg
		}
	case finishMsg:
		m.done, m.footer, m.err = true, msg.lines, msg.err
		return m, tea.Quit
	}
	return m, nil
}

func (m model) View() tea.View {
	var b strings.Builder
	b.WriteString("\n")
	for _, n := range m.notes {
		b.WriteString(" " + styleMuted.Render(n) + "\n")
	}
	if len(m.notes) > 0 {
		b.WriteString("\n")
	}
	for _, r := range m.rows {
		b.WriteString(m.renderRow(r))
	}
	if m.done {
		b.WriteString("\n")
		if m.err != nil {
			b.WriteString(" " + styleFail.Render(m.err.Error()) + "\n")
		}
		for i, line := range m.footer {
			if i == 0 && m.err == nil && strings.HasPrefix(line, "Done") {
				head, rest, _ := strings.Cut(line, " Move")
				line = styleDone.Render(head)
				if rest != "" {
					line += " Move" + rest
				}
			}
			b.WriteString(" " + line + "\n")
		}
	}
	return tea.NewView(b.String())
}

func (m model) renderRow(r row) string {
	var icon, label, text string
	label = fmt.Sprintf("%-*s", labelWidth, r.label)
	switch r.state {
	case statePending:
		icon, label, text = styleMuted.Render("·"), styleMuted.Render(label), styleMuted.Render(r.text)
	case stateWaiting:
		icon, label, text = styleWait.Render("›"), styleBright.Render(label), r.text
	case stateActive:
		icon, label, text = styleActive.Render(spinnerFrames[m.frame%len(spinnerFrames)]), styleBright.Render(label), r.text
	case stateDone:
		icon, text = styleDone.Render("✓"), r.text
		if r.key == "build" {
			text = styleBright.Render(r.text)
		}
	case stateFailed:
		icon, label, text = styleFail.Render("✗"), styleBright.Render(label), styleFail.Render(r.text)
	}
	if r.pct >= 0 && r.state == stateActive {
		filled := barWidth * r.pct / 100
		text = fmt.Sprintf("%-9s %s%s %3d%%", r.text,
			styleActive.Render(strings.Repeat("━", filled)),
			styleMuted.Render(strings.Repeat("─", barWidth-filled)), r.pct)
	}
	var right string
	switch {
	case r.detail != "":
		right = r.detail
	case r.state == stateWaiting:
		e := time.Since(r.since)
		right = fmt.Sprintf("%d:%02d", int(e.Minutes()), int(e.Seconds())%60)
	case r.state == stateDone:
		right = fmt.Sprintf("%.1fs", r.took.Seconds())
	}
	line := fmt.Sprintf(" %s %s %s", icon, label, text)
	if right != "" {
		pad := max(2, hintIndent+textWidth-lipgloss.Width(line))
		line += strings.Repeat(" ", pad) + styleMuted.Render(right)
	}
	line += "\n"
	if r.hint != "" {
		line += strings.Repeat(" ", hintIndent) + styleWait.Render(r.hint) + "\n"
	}
	return line
}

// tuiReporter sends progress to the running program.
type tuiReporter struct{ p *tea.Program }

func (t tuiReporter) update(r row)  { t.p.Send(rowMsg(r)) }
func (t tuiReporter) note(s string) { t.p.Send(noteMsg(s)) }
func (t tuiReporter) finish(lines []string, err error) {
	t.p.Send(finishMsg{lines, err})
}

// plainReporter prints one line per change, for logs and tests (no TTY).
type plainReporter struct {
	w    io.Writer
	mu   sync.Mutex
	last map[string]string
}

func (p *plainReporter) update(r row) {
	p.mu.Lock()
	defer p.mu.Unlock()
	line := fmt.Sprintf("%s: %s", r.label, r.text)
	if r.detail != "" {
		line += " (" + r.detail + ")"
	}
	if r.hint != "" {
		line += " | " + r.hint
	}
	if p.last[r.key] == line {
		return
	}
	p.last[r.key] = line
	fmt.Fprintln(p.w, line)
}

func (p *plainReporter) note(s string) { fmt.Fprintln(p.w, s) }

func (p *plainReporter) finish(lines []string, err error) {
	if err != nil {
		fmt.Fprintln(p.w, "kbflash: stopped:", err)
	}
	for _, l := range lines {
		fmt.Fprintln(p.w, l)
	}
}
