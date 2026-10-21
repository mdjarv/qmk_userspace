// kbflash: guided backup, restore and flashing of a split RP2040 keyboard.
//
// Waits for each half to enter the bootloader, recognises it by its RP2040
// flash ID (listed in kbflash.json), drives picotool and reboots it. No
// keypress is needed mid-run, since the keyboard is down while a half is in
// the bootloader. A backup can only be restored to the half it came from.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"golang.org/x/term"
)

const usage = `usage:
  kbflash flash FIRMWARE.uf2 [--build CMD] [--erase] [--sides left,right]
  kbflash backup [--label NAME] [--sides left,right]
  kbflash restore DIR [--sides left,right]
  kbflash drill

  flash    flash the same firmware to both halves; --build runs CMD first,
           --erase clears stored settings (the 2 MB firmware region) first
  backup   full-flash image of each half into the backup directory
  restore  write a backup back, each image to the half it came from
  drill    backup, then restore it, to prove recovery works

environment: KBFLASH_CONFIG (default ./kbflash.json), KBFLASH_BACKUPS
(default ~/git/keyboard/backups), KBFLASH_PICOTOOL, KBFLASH_SYSFS
`

func main() {
	os.Exit(run())
}

func run() int {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		return 2
	}
	cmd := os.Args[1]
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	fs.Usage = func() { fmt.Fprint(os.Stderr, usage) }
	sidesFlag := fs.String("sides", "", "comma-separated halves, default all in kbflash.json")
	label := fs.String("label", "", "suffix for the backup directory")
	build := fs.String("build", "", "command that builds the firmware first")
	erase := fs.Bool("erase", false, "erase the firmware region first")
	args, err := parseInterspersed(fs, os.Args[2:])
	if err != nil {
		return 2
	}

	home, _ := os.UserHomeDir()
	backupRoot := envOr("KBFLASH_BACKUPS", filepath.Join(home, "git/keyboard/backups"))
	cfg, err := loadConfig(envOr("KBFLASH_CONFIG", "kbflash.json"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "kbflash:", err)
		return 1
	}
	if _, err := exec.LookPath(picotool); err != nil {
		fmt.Fprintln(os.Stderr, "kbflash: picotool not found")
		return 1
	}
	sides := cfg.sides()
	if *sidesFlag != "" {
		sides = strings.Split(*sidesFlag, ",")
		for _, s := range sides {
			if _, ok := cfg.half(s); !ok {
				fmt.Fprintf(os.Stderr, "kbflash: unknown side %q; kbflash.json has %s\n", s, strings.Join(cfg.sides(), ", "))
				return 2
			}
		}
	}

	var work func(r *runner) (string, error)
	switch cmd {
	case "flash":
		if len(args) != 1 {
			fs.Usage()
			return 2
		}
		if len(sides) != len(cfg.Halves) && !confirm("Halves must run the same firmware. Flash only "+strings.Join(sides, ", ")+"?") {
			return 1
		}
		work = func(r *runner) (string, error) { return r.flash(args[0], *build, sides, *erase) }
	case "backup":
		work = func(r *runner) (string, error) {
			_, last, err := r.backup(backupRoot, *label, "", sides)
			return last, err
		}
	case "restore":
		if len(args) != 1 {
			fs.Usage()
			return 2
		}
		dir := expandHome(args[0])
		work = func(r *runner) (string, error) { return r.restore(dir, "", sides) }
	case "drill":
		work = func(r *runner) (string, error) {
			dir, _, err := r.backup(backupRoot, "drill", "save", cfg.sides())
			if err != nil {
				return "", err
			}
			// restore starts with the half the cable is already in
			reversed := slices.Clone(cfg.sides())
			slices.Reverse(reversed)
			last, err := r.restore(dir, "load", reversed)
			if err == nil {
				r.rep.note("Drill passed: " + dir)
			}
			return last, err
		}
	default:
		fs.Usage()
		return 2
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var rep reporter
	var prog *tea.Program
	if term.IsTerminal(int(os.Stdout.Fd())) {
		// no WithContext: on ctrl+c the model cancels ctx, and the program
		// quits only once the worker has sent the final footer
		prog = tea.NewProgram(model{cancel: cancel})
		rep = tuiReporter{prog}
	} else {
		rep = &plainReporter{w: os.Stdout, last: map[string]string{}}
	}
	r := &runner{ctx: ctx, cfg: cfg, rep: rep, rows: map[string]*row{}, started: time.Now()}

	result := make(chan error, 1)
	go func() {
		last, err := work(r)
		if errors.Is(err, context.Canceled) {
			err = errors.New("interrupted")
		}
		shown := err
		if r.rowFailed {
			shown = nil // already on its row
		}
		rep.finish(r.footer(last, err, backupRoot), shown)
		result <- err
	}()
	if prog != nil {
		if _, err := prog.Run(); err != nil {
			fmt.Fprintln(os.Stderr, "kbflash:", err)
		}
	}
	if err := <-result; err != nil {
		return 1
	}
	return 0
}

// parseInterspersed lets flags follow positional arguments, as make passes them.
func parseInterspersed(fs *flag.FlagSet, args []string) ([]string, error) {
	var positional []string
	for len(args) > 0 {
		if err := fs.Parse(args); err != nil {
			return nil, err
		}
		args = fs.Args()
		if len(args) > 0 {
			positional = append(positional, args[0])
			args = args[1:]
		}
	}
	return positional, nil
}

func expandHome(p string) string {
	if rest, ok := strings.CutPrefix(p, "~/"); ok {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, rest)
	}
	return p
}

func confirm(msg string) bool {
	fmt.Printf("%s [y/N] ", msg)
	line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	return strings.TrimSpace(strings.ToLower(line)) == "y"
}
