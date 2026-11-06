package main

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"net"
	"net/http"
	"sync"
	"time"
)

// A browser preview of the left OLED: the latest frame, 4x, refreshed ten
// times a second, with the script error if there is one.

const previewScale = 4

type previewServer struct {
	mu    sync.Mutex
	frame []byte
	err   string
}

func startPreview(ctx context.Context, addr string) (*previewServer, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	p := &previewServer{}
	mux := http.NewServeMux()
	mux.HandleFunc("/", p.page)
	mux.HandleFunc("/frame.png", p.png)
	mux.HandleFunc("/error", func(w http.ResponseWriter, _ *http.Request) {
		p.mu.Lock()
		defer p.mu.Unlock()
		w.Write([]byte(p.err))
	})
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go srv.Serve(ln)
	go func() { <-ctx.Done(); srv.Close() }()
	return p, nil
}

// The methods are no-ops on a nil server, so the render loop need not check.
func (p *previewServer) setFrame(f []byte) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.frame = f
	p.mu.Unlock()
}

func (p *previewServer) setError(err error) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.err = ""
	if err != nil {
		p.err = err.Error()
	}
	p.mu.Unlock()
}

func (p *previewServer) page(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(`<!doctype html><meta charset=utf-8><title>kbscreen</title>
<body style="background:#111;color:#ccc;font:14px monospace;display:flex;gap:24px;padding:24px">
<img id=f src=frame.png style="image-rendering:pixelated;border:2px solid #333">
<pre id=e style="color:#f77;white-space:pre-wrap"></pre>
<script>setInterval(async()=>{document.getElementById('f').src='frame.png?'+Date.now();
document.getElementById('e').textContent=await (await fetch('error')).text()},100)</script>`))
}

func (p *previewServer) png(w http.ResponseWriter, _ *http.Request) {
	p.mu.Lock()
	frame := p.frame
	p.mu.Unlock()
	var buf bytes.Buffer
	png.Encode(&buf, frameImage(frame, previewScale))
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(buf.Bytes())
}

// frameImage draws a frame (OLED layout) as a black-and-white picture.
func frameImage(frame []byte, scale int) image.Image {
	img := image.NewGray(image.Rect(0, 0, 32*scale, 128*scale))
	for y := range 128 {
		for x := range 32 {
			if len(frame) == frameSize && frame[x+(y/8)*32]&(1<<(y%8)) != 0 {
				for j := range scale {
					for i := range scale {
						img.SetGray(x*scale+i, y*scale+j, color.Gray{235})
					}
				}
			}
		}
	}
	return img
}
