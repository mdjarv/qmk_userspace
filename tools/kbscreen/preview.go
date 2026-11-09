package main

import (
	"bytes"
	"context"
	"encoding/json"
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
	mu      sync.Mutex
	frame   []byte
	err     string
	actions []string
	run     chan string // actions asked for, for the render loop
}

func startPreview(ctx context.Context, addr string) (*previewServer, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	p := &previewServer{run: make(chan string, 8)}
	mux := http.NewServeMux()
	mux.HandleFunc("/actions", func(w http.ResponseWriter, _ *http.Request) {
		p.mu.Lock()
		defer p.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(p.actions)
	})
	// POST /action?name=...: from this page only (a browser's cross-site
	// POST carries another Origin).
	mux.HandleFunc("/action", func(w http.ResponseWriter, r *http.Request) {
		if o := r.Header.Get("Origin"); r.Method != http.MethodPost || (o != "" && o != "http://"+r.Host) {
			http.Error(w, "POST from the preview page", http.StatusForbidden)
			return
		}
		select {
		case p.run <- r.URL.Query().Get("name"):
			w.WriteHeader(http.StatusAccepted)
		default:
			http.Error(w, "busy", http.StatusServiceUnavailable)
		}
	})
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

func (p *previewServer) setActions(names []string) {
	if p == nil {
		return
	}
	p.mu.Lock()
	p.actions = names
	p.mu.Unlock()
}

// requests is where the render loop takes the actions asked for; nil (never
// ready) without a preview.
func (p *previewServer) requests() <-chan string {
	if p == nil {
		return nil
	}
	return p.run
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
<img id=f src=frame.png style="image-rendering:pixelated;border:2px solid #333;align-self:flex-start">
<div><div id=a style="display:flex;flex-wrap:wrap;gap:6px;max-width:480px"></div>
<pre id=e style="color:#f77;white-space:pre-wrap"></pre></div>
<script>setInterval(async()=>{document.getElementById('f').src='frame.png?'+Date.now();
document.getElementById('e').textContent=await (await fetch('error')).text()},100);
let shown='';setInterval(async()=>{const names=(await (await fetch('actions')).json()||[]).sort((x,y)=>(y==='reset')-(x==='reset'));const key=names.join('|');if(key===shown)return;shown=key;
const a=document.getElementById('a');a.replaceChildren(...names.map(n=>{const b=document.createElement('button');b.textContent=n;
b.style.cssText='background:#222;color:#ccc;border:1px solid #444;font:13px monospace;padding:4px 8px;cursor:pointer';
b.onclick=()=>fetch('action?name='+encodeURIComponent(n),{method:'POST'});return b}))},1000)</script>`))
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
