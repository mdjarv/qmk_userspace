package main

import (
	"context"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// loadArt opens an MPRIS art URL: a file:// path or an http(s) URL.
func loadArt(ctx context.Context, raw string) (image.Image, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	var r io.ReadCloser
	switch u.Scheme {
	case "file":
		r, err = os.Open(u.Path)
	case "http", "https":
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
		var resp *http.Response
		resp, err = http.DefaultClient.Do(req)
		if err == nil && resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			err = fmt.Errorf("art: %s", resp.Status)
		}
		if err == nil {
			r = resp.Body
		}
	default:
		return nil, fmt.Errorf("art: unsupported URL scheme %q", u.Scheme)
	}
	if err != nil {
		return nil, err
	}
	defer r.Close()
	img, _, err := image.Decode(io.LimitReader(r, 20<<20))
	return img, err
}

// ditherArt scales img to 32x32, stretches its contrast and Floyd-Steinberg
// dithers it into OLED layout: 4 pages of 32 columns, bit 0 the top row.
func ditherArt(img image.Image) [artSize]byte {
	const n = 32
	gray := image.NewGray(image.Rect(0, 0, n, n))
	draw.CatmullRom.Scale(gray, gray.Bounds(), img, img.Bounds(), draw.Src, nil)

	lo, hi := 255, 0
	for _, v := range gray.Pix {
		lo, hi = min(lo, int(v)), max(hi, int(v))
	}
	px := make([]float64, n*n)
	for i, v := range gray.Pix {
		if hi > lo {
			px[i] = float64(int(v)-lo) / float64(hi-lo)
		}
	}

	var out [artSize]byte
	for y := range n {
		for x := range n {
			i := y*n + x
			on := px[i] >= 0.5
			e := px[i]
			if on {
				out[x+(y/8)*n] |= 1 << (y % 8)
				e -= 1
			}
			if x+1 < n {
				px[i+1] += e * 7 / 16
			}
			if y+1 < n {
				if x > 0 {
					px[i+n-1] += e * 3 / 16
				}
				px[i+n] += e * 5 / 16
				if x+1 < n {
					px[i+n+1] += e * 1 / 16
				}
			}
		}
	}
	return out
}
