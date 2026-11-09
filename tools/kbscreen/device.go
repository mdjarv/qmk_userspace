package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// QMK's Raw HID interface: usage page 0xFF60, the first item of its report
// descriptor.
var rawHIDDescriptorPrefix = []byte{0x06, 0x60, 0xFF}

// findRawHID returns the /dev path of the keyboard's Raw HID interface, from
// sysfs under sysRoot ("/sys" outside tests).
func findRawHID(sysRoot string, vid, pid uint16) (string, error) {
	want := fmt.Sprintf("HID_ID=0003:%08X:%08X", vid, pid)
	nodes, _ := filepath.Glob(filepath.Join(sysRoot, "class/hidraw/hidraw*"))
	for _, node := range nodes {
		uevent, err := os.ReadFile(filepath.Join(node, "device/uevent"))
		if err != nil || !strings.Contains(strings.ToUpper(string(uevent)), want) {
			continue
		}
		desc, err := os.ReadFile(filepath.Join(node, "device/report_descriptor"))
		if err != nil || !bytes.HasPrefix(desc, rawHIDDescriptorPrefix) {
			continue
		}
		return "/dev/" + filepath.Base(node), nil
	}
	return "", fmt.Errorf("no Raw HID interface for %04x:%04x", vid, pid)
}

type device struct{ f *os.File }

func openDevice(path string) (*device, error) {
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return nil, err
	}
	return &device{f}, nil
}

// send writes one report. hidraw wants the report number first, 0 for a
// device without numbered reports.
func (d *device) send(r report) error {
	var buf [reportSize + 1]byte
	copy(buf[1:], r[:])
	_, err := d.f.Write(buf[:])
	return err
}

type event struct {
	kind, a, b byte
	data       [reportSize - 2]byte // everything after the kind; a and b are its first two bytes
}

// events delivers the keyboard's event reports until the device closes.
func (d *device) events() <-chan event {
	ch := make(chan event, 8)
	go func() {
		defer close(ch)
		var buf [reportSize]byte
		for {
			n, err := d.f.Read(buf[:])
			if err != nil {
				return
			}
			if n >= 4 && buf[0] == msgEvent {
				ev := event{kind: buf[1], a: buf[2], b: buf[3]}
				copy(ev.data[:], buf[2:])
				select {
				case ch <- ev:
				default:
				}
			}
		}
	}()
	return ch
}

func (d *device) close() { d.f.Close() }
