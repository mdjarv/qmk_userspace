package main

import (
	"context"
	"encoding/binary"
	"io"
	"log"
	"math"
	"math/cmplx"
	"os/exec"
)

// The spectrum of what is playing, from the default sink's monitor via parec.

const (
	sampleRate = 48000
	fftSize    = 2048
	hopSize    = sampleRate / 30 // 30 frames a second
	bandLow    = 50.0            // Hz, lower edge of the first band
	bandHigh   = 14000.0         // Hz, upper edge of the last band
	floorDB    = -70.0           // maps to an empty band
	rangeDB    = 60.0            // floorDB + rangeDB maps to a full band
	release    = 0.80            // per frame; bands rise at once and fall by this
)

// runSpectrum streams bands to out until ctx ends or parec fails.
func runSpectrum(ctx context.Context, out chan<- [bandCount]uint8) {
	cmd := exec.CommandContext(ctx, "parec", "--device=@DEFAULT_MONITOR@", "--format=s16le",
		"--rate=48000", "--channels=1", "--raw", "--latency-msec=30")
	stdout, err := cmd.StdoutPipe()
	if err == nil {
		err = cmd.Start()
	}
	if err != nil {
		log.Printf("spectrum: parec: %v", err)
		return
	}
	defer cmd.Wait()

	an := newAnalyzer()
	window := make([]float64, fftSize)
	hop := make([]int16, hopSize)
	for {
		if err := binary.Read(stdout, binary.LittleEndian, hop); err != nil {
			if err != io.EOF && ctx.Err() == nil {
				log.Printf("spectrum: %v", err)
			}
			return
		}
		copy(window, window[hopSize:])
		for i, s := range hop {
			window[fftSize-hopSize+i] = float64(s) / 32768
		}
		select {
		case out <- an.bands(window):
		default: // the sender is behind; drop the frame
		}
	}
}

type analyzer struct {
	hann  []float64
	edges [bandCount + 1]int // FFT bin edges
	level [bandCount]float64 // smoothed 0..1
}

func newAnalyzer() *analyzer {
	a := &analyzer{hann: make([]float64, fftSize)}
	for i := range a.hann {
		a.hann[i] = 0.5 - 0.5*math.Cos(2*math.Pi*float64(i)/float64(fftSize-1))
	}
	for b := range a.edges {
		hz := bandLow * math.Pow(bandHigh/bandLow, float64(b)/bandCount)
		a.edges[b] = max(1, int(hz*fftSize/sampleRate))
	}
	for b := 1; b < len(a.edges); b++ { // every band at least one bin wide
		a.edges[b] = max(a.edges[b], a.edges[b-1]+1)
	}
	return a
}

func (a *analyzer) bands(samples []float64) [bandCount]uint8 {
	buf := make([]complex128, fftSize)
	for i, s := range samples {
		buf[i] = complex(s*a.hann[i], 0)
	}
	fft(buf)
	var out [bandCount]uint8
	for b := range bandCount {
		peak := 0.0
		for k := a.edges[b]; k < a.edges[b+1]; k++ {
			peak = max(peak, cmplx.Abs(buf[k]))
		}
		db := 20 * math.Log10(peak/(fftSize/4)+1e-12)
		v := math.Min(math.Max((db-floorDB)/rangeDB, 0), 1)
		a.level[b] = math.Max(v, a.level[b]*release)
		out[b] = uint8(a.level[b]*255 + 0.5)
	}
	return out
}

// fft is an in-place radix-2 Cooley-Tukey FFT; len(x) must be a power of two.
func fft(x []complex128) {
	n := len(x)
	for i, j := 1, 0; i < n; i++ {
		bit := n >> 1
		for ; j&bit != 0; bit >>= 1 {
			j ^= bit
		}
		j ^= bit
		if i < j {
			x[i], x[j] = x[j], x[i]
		}
	}
	for size := 2; size <= n; size <<= 1 {
		w := cmplx.Exp(complex(0, -2*math.Pi/float64(size)))
		for start := 0; start < n; start += size {
			wk := complex(1, 0)
			for k := range size / 2 {
				u, v := x[start+k], x[start+k+size/2]*wk
				x[start+k], x[start+k+size/2] = u+v, u-v
				wk *= w
			}
		}
	}
}
