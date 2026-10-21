package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakePicotool models picotool 2.3.1 on RP2040: --ser matches the flash ID
// (not the USB serial), access is denied for the first calls after a half
// appears (udev lag), and load/save draw progress bars with \r.
const fakePicotool = `#!/bin/bash
D=$FAKE/sys/bus/usb/devices
ser=""; args=("$@"); for ((i=0;i<${#args[@]};i++)); do [[ ${args[i]} == --ser ]] && ser=${args[i+1]}; done
echo "$*" >> $FAKE/calls.log
[[ -d $D/bootsel ]] || { echo "No accessible RP-series devices in BOOTSEL mode were found." >&2; exit 249; }
n=$(cat $FAKE/denied 2>/dev/null || echo 0)
if [[ $n -lt 2 ]]; then echo $((n+1)) > $FAKE/denied; echo "No accessible RP-series devices" >&2; exit 249; fi
fid="F1A5$(cat $D/bootsel/serial)"
[[ -n $ser && $ser != "$fid" ]] && { echo "No accessible RP-series devices in BOOTSEL mode were found with serial number $ser." >&2; exit 249; }
bar() { for p in 0 50 100; do printf '%s:  [%-30s]  %d%%\r' "$1" "" $p; done; echo; }
case $1 in
  info) echo " flash id:    0x$fid";;
  save) bar "Saving file"; bar "Verifying Flash"; out=""; for a in "$@"; do [[ $a == *.uf2 ]] && out=$a; done; cp $FAKE/sample.uf2 "$out";;
  load) bar "Loading into Flash"; bar "Verifying Flash";;
  erase) bar "Erasing";;
  reboot) rm -f $FAKE/denied; rm -rf $D/bootsel; mkdir -p $D/app; echo 8d1d > $D/app/idVendor; echo ec32 > $D/app/idProduct;;
esac
`

type fakeKeyboard struct {
	dir   string
	mu    sync.Mutex
	queue []string // USB serials of the halves the "person" double-taps, in order
}

func newFakeKeyboard(t *testing.T, taps ...string) *fakeKeyboard {
	t.Helper()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "picotool"), []byte(fakePicotool), 0o755))
	must(t, os.MkdirAll(filepath.Join(dir, "sys/bus/usb/devices/app"), 0o755))
	must(t, os.WriteFile(filepath.Join(dir, "sys/bus/usb/devices/app/idVendor"), []byte("8d1d\n"), 0o644))
	must(t, os.WriteFile(filepath.Join(dir, "sample.uf2"), sampleUF2(), 0o644))
	t.Setenv("FAKE", dir)
	picotool, sysfs = filepath.Join(dir, "picotool"), filepath.Join(dir, "sys")
	return &fakeKeyboard{dir: dir, queue: taps}
}

// run plays the person: whenever the keyboard is up, double-tap the next half.
func (k *fakeKeyboard) run(ctx context.Context) {
	devs := filepath.Join(k.dir, "sys/bus/usb/devices")
	for ctx.Err() == nil {
		time.Sleep(200 * time.Millisecond)
		if _, err := os.Stat(filepath.Join(devs, "app")); err != nil {
			continue
		}
		k.mu.Lock()
		if len(k.queue) == 0 {
			k.mu.Unlock()
			continue
		}
		serial := k.queue[0]
		k.queue = k.queue[1:]
		k.mu.Unlock()
		os.RemoveAll(filepath.Join(devs, "app"))
		b := filepath.Join(devs, "bootsel")
		os.MkdirAll(b, 0o755)
		os.WriteFile(filepath.Join(b, "idVendor"), []byte("2e8a\n"), 0o644)
		os.WriteFile(filepath.Join(b, "idProduct"), []byte("0003\n"), 0o644)
		os.WriteFile(filepath.Join(b, "serial"), []byte(serial+"\n"), 0o644)
	}
}

func (k *fakeKeyboard) calls(t *testing.T) string {
	data, _ := os.ReadFile(filepath.Join(k.dir, "calls.log"))
	return string(data)
}

var testConfig = config{AppVendor: "8d1d", Halves: []half{
	{Side: "left", FlashID: "F1A5AAAA", Bootmagic: `"5"`},
	{Side: "right", FlashID: "F1A5BBBB", Bootmagic: `"6"`},
}}

func newRunner(t *testing.T, k *fakeKeyboard) (*runner, *bytes.Buffer) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
	go k.run(ctx)
	out := &bytes.Buffer{}
	return &runner{ctx: ctx, cfg: testConfig, rep: &plainReporter{w: out, last: map[string]string{}},
		rows: map[string]*row{}, started: time.Now()}, out
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// sampleUF2 is three blocks: data at 0x10000000, blank, data at 0x101ff000.
func sampleUF2() []byte {
	var out bytes.Buffer
	for i, addr := range []uint32{0x10000000, 0x10000100, 0x101ff000} {
		block := make([]byte, uf2Block)
		binary.LittleEndian.PutUint32(block[12:], addr)
		binary.LittleEndian.PutUint32(block[16:], 256)
		binary.LittleEndian.PutUint32(block[20:], uint32(i))
		binary.LittleEndian.PutUint32(block[24:], 3)
		payload := bytes.Repeat([]byte{0xff}, 256)
		if i != 1 {
			payload[0] = byte(i + 1)
		}
		copy(block[uf2Payload:], payload)
		out.Write(block)
	}
	return out.Bytes()
}

func TestDrillRestoresEachImageToItsOwnHalf(t *testing.T) {
	// backup left, right; restore starts right; the left half is tapped twice
	k := newFakeKeyboard(t, "AAAA", "BBBB", "BBBB", "BBBB", "AAAA")
	r, out := newRunner(t, k)
	dir, _, err := r.backup(t.TempDir(), "drill", "save", []string{"left", "right"})
	must(t, err)
	last, err := r.restore(dir, "load", []string{"right", "left"})
	must(t, err)
	if last != "left" {
		t.Errorf("last half = %q, want left", last)
	}
	calls := k.calls(t)
	for _, want := range []string{
		"save -a -v " + filepath.Join(dir, "left.uf2") + " --ser F1A5AAAA",
		"save -a -v " + filepath.Join(dir, "right.uf2") + " --ser F1A5BBBB",
		"erase -r 0x10000000 0x10200000 --ser F1A5BBBB",
		"erase -r 0x10000000 0x10200000 --ser F1A5AAAA",
	} {
		if !strings.Contains(calls, want) {
			t.Errorf("picotool never called with %q\ncalls:\n%s", want, calls)
		}
	}
	if !strings.Contains(out.String(), "RIGHT was already done, rebooted it unchanged") {
		t.Errorf("repeat tap on a finished half not reported:\n%s", out.String())
	}
	for _, stage := range []string{"save LEFT: reading", "load RIGHT: writing", "load LEFT: verifying"} {
		if !strings.Contains(out.String(), stage) {
			t.Errorf("progress stage %q not reported:\n%s", stage, out.String())
		}
	}
}

func TestUnknownHalfStops(t *testing.T) {
	k := newFakeKeyboard(t, "CCCC")
	r, _ := newRunner(t, k)
	firmware := filepath.Join(t.TempDir(), "fw.uf2")
	must(t, os.WriteFile(firmware, sampleUF2(), 0o644))
	_, err := r.flash(firmware, "", []string{"left", "right"}, false)
	if err == nil || !strings.Contains(err.Error(), "unknown half, flash ID F1A5CCCC") {
		t.Fatalf("err = %v, want unknown half", err)
	}
	if strings.Contains(k.calls(t), "load") {
		t.Error("wrote to an unknown half")
	}
}

func TestRestoreRefusesTamperedImage(t *testing.T) {
	k := newFakeKeyboard(t, "AAAA")
	r, _ := newRunner(t, k)
	dir, _, err := r.backup(t.TempDir(), "", "", []string{"left"})
	must(t, err)
	f, _ := os.OpenFile(filepath.Join(dir, "left.uf2"), os.O_APPEND|os.O_WRONLY, 0)
	f.Write([]byte("x"))
	f.Close()
	if _, err := r.restore(dir, "", []string{"left"}); err == nil || !strings.Contains(err.Error(), "checksum") {
		t.Fatalf("err = %v, want checksum mismatch", err)
	}
}

func TestSparseUF2KeepsOnlyDataBlocks(t *testing.T) {
	dir := t.TempDir()
	src, dst := filepath.Join(dir, "full.uf2"), filepath.Join(dir, "sparse.uf2")
	must(t, os.WriteFile(src, sampleUF2(), 0o644))
	n, err := sparseUF2(src, dst)
	must(t, err)
	data, _ := os.ReadFile(dst)
	if n != 2 || len(data) != 2*uf2Block {
		t.Fatalf("kept %d blocks (%d bytes), want 2", n, len(data))
	}
	for i, wantAddr := range []uint32{0x10000000, 0x101ff000} {
		b := data[i*uf2Block:]
		if addr := binary.LittleEndian.Uint32(b[12:]); addr != wantAddr {
			t.Errorf("block %d addr %#x, want %#x", i, addr, wantAddr)
		}
		if no, total := binary.LittleEndian.Uint32(b[20:]), binary.LittleEndian.Uint32(b[24:]); no != uint32(i) || total != 2 {
			t.Errorf("block %d numbered %d/%d, want %d/2", i, no, total, i)
		}
	}
}

func TestRunPicotoolReturnsStdout(t *testing.T) {
	script := filepath.Join(t.TempDir(), "picotool")
	must(t, os.WriteFile(script, []byte("#!/bin/bash\nprintf 'Device Information\\n flash id:    0xABC\\n'\necho warning >&2\n"), 0o755))
	picotool = script
	out, err := runPicotool(context.Background(), "", nil, "info", "-a")
	must(t, err)
	if !strings.Contains(out, "flash id:    0xABC") {
		t.Fatalf("stdout lost: %q", out)
	}
}
