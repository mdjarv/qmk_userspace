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
	w.Write([]byte(previewHTML))
}

// The preview: the frame on the left; on the right the actions the pages
// offer, grouped by page and section ('page/section: label'), each page's
// own reset beside its name and the reset of everything on top.
const previewHTML = `<!doctype html><meta charset=utf-8><title>kbscreen</title>
<style>
:root{--bg:#121212;--fg:#e8e8e8;--muted:#9a9a9a;--faint:#666;--btn:#1e1e1e;--line:#333;--hover:#2a2a2a;--ok:#4caf7a}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif;display:flex;gap:32px;padding:24px;align-items:flex-start}
#f{image-rendering:pixelated;border:1px solid var(--line);flex:none}
main{display:flex;flex-direction:column;gap:28px;max-width:560px}
#top{display:flex;align-items:center;gap:12px}
#top p{margin:0;color:var(--faint);font-size:13px}
button{background:var(--btn);color:var(--fg);border:1px solid var(--line);border-radius:6px;font:13px system-ui,sans-serif;padding:5px 10px;cursor:pointer;transition:background .15s,border-color .15s}
button:hover{background:var(--hover)}
button.done{border-color:var(--ok);background:#1f3328}
#reset{background:var(--fg);color:var(--bg);border-color:var(--fg);font-weight:600;padding:7px 14px}
#reset:hover{background:#fff}
section h2{margin:0 0 10px;font-size:16px;font-weight:600;display:flex;align-items:baseline;gap:12px;text-transform:capitalize}
section h2 a{font-size:12px;font-weight:400;color:var(--muted);cursor:pointer;text-transform:none}
section h2 a:hover{color:var(--fg)}
.row{display:grid;grid-template-columns:110px 1fr;gap:10px;align-items:baseline;margin:6px 0}
.row span{color:var(--faint);font-size:12px;text-align:right}
.row div{display:flex;flex-wrap:wrap;gap:6px}
#a{display:flex;flex-direction:column;gap:24px}
#e{color:#f77;white-space:pre-wrap;margin:0}
</style>
<img id=f src=frame.png>
<main>
<div id=top><button id=reset hidden>Reset to now</button><p>Ends every scene set off here and goes back to the automatic page.</p></div>
<div id=a></div>
<pre id=e></pre>
</main>
<script>
const post=(n,b)=>{fetch('action?name='+encodeURIComponent(n),{method:'POST'});if(b){b.classList.add('done');setTimeout(()=>b.classList.remove('done'),600)}};
function make(tag,props,kids){const e=Object.assign(document.createElement(tag),props||{});(kids||[]).forEach(k=>e.append(k));return e}
document.getElementById('reset').onclick=e=>post('reset',e.target);
setInterval(async()=>{document.getElementById('f').src='frame.png?'+Date.now();
document.getElementById('e').textContent=await (await fetch('error')).text()},100);
let shown='';
setInterval(async()=>{
  const names=await (await fetch('actions')).json()||[];const key=names.join('|');if(key===shown)return;shown=key;
  document.getElementById('reset').hidden=!names.includes('reset');
  const pages=new Map();
  names.forEach(n=>{const m=/^([^/:]+)(?:\/([^:]+))?: (.+)$/.exec(n);if(!m)return;
    const [,pg,sec,label]=m;if(!pages.has(pg))pages.set(pg,{reset:null,secs:new Map()});const p=pages.get(pg);
    if(label==='reset'&&!sec){p.reset=n;return}
    const s=sec||'';if(!p.secs.has(s))p.secs.set(s,[]);p.secs.get(s).push([label,n])});
  document.getElementById('a').replaceChildren(...[...pages].map(([pg,p])=>make('section',{},[
    make('h2',{},[pg].concat(p.reset?[make('a',{textContent:'reset '+pg,onclick:e=>post(p.reset)})]:[])),
    ...[...p.secs].map(([s,acts])=>make('div',{className:'row'},[make('span',{textContent:s}),
      make('div',{},acts.map(([label,n])=>make('button',{textContent:label,onclick:e=>post(n,e.target)})))]))])));
},1000);
</script>`

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
