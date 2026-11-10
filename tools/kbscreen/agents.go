package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Agentique sessions from its read-only API (/api/read/*), which takes a
// read-scoped token: agentique tokens add --perm read.

type agentiqueClient struct {
	base     string // https://127.0.0.1:19201
	token    string
	http     *http.Client
	names    map[string]string // project id -> name, every machine's
	namesAt  time.Time
	machines []string          // the other machines this Agentique reaches
	held     map[string]source // each machine's last good answer ("" is this one)
}

type readSession struct {
	ID         string   `json:"id"`
	ProjectID  string   `json:"projectId"`
	TurnCount  int      `json:"turnCount"`
	Merged     bool     `json:"merged"`
	Model      string   `json:"model"`
	ArchivedAt string   `json:"archivedAt"`
	ParentID   string   `json:"parentId"`
	InFlight   *int     `json:"agentsInFlight"`
	ContextPct *float64 `json:"contextPercent"` // 0..100; absent until Agentique has a reading
	Name       string   `json:"name"`
	State      string   `json:"state"`
	UpdatedAt  string   `json:"updatedAt"`
	NeedsYou   *struct {
		UnseenCompletedAt string `json:"unseenCompletedAt"`
		ApprovalTool      string `json:"approvalTool"`
		Question          bool   `json:"question"`
		SurfacesWaiting   int    `json:"surfacesWaiting"`
		WaitingSince      string `json:"waitingSince"`
	} `json:"needsYou"`
}

// newRemoteAgentiqueClient talks to an Agentique server elsewhere, such as
// https://host.tailnet.ts.net:19201, verifying its certificate normally.
func newRemoteAgentiqueClient(base, token string) (*agentiqueClient, error) {
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return nil, fmt.Errorf("agentique: bad URL %q, want https://host:port", base)
	}
	return &agentiqueClient{
		base:  strings.TrimRight(base, "/"),
		token: token,
		http:  &http.Client{Timeout: 5 * time.Second},
	}, nil
}

// newAgentiqueClient reads the local server's address from Agentique's
// config.toml and trusts only the certificate at its tls-cert path.
func newAgentiqueClient(configDir, token string) (*agentiqueClient, error) {
	cfg, err := os.ReadFile(configDir + "/config.toml")
	if err != nil {
		return nil, err
	}
	addr := tomlString(cfg, "addr")
	if addr == "" {
		return nil, errors.New("agentique: no addr in config.toml")
	}
	port := addr[strings.LastIndex(addr, ":")+1:]
	certPath := tomlString(cfg, "tls-cert")
	if certPath == "" {
		return &agentiqueClient{base: "http://127.0.0.1:" + port, token: token, http: &http.Client{Timeout: 5 * time.Second}}, nil
	}
	if !strings.HasPrefix(certPath, "/") {
		certPath = configDir + "/" + certPath
	}
	pemBytes, err := os.ReadFile(certPath)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("agentique: no certificate in " + certPath)
	}
	// The certificate names the tailnet host, not 127.0.0.1, so match the
	// exact certificate instead of verifying names.
	tlsCfg := &tls.Config{
		InsecureSkipVerify: true,
		VerifyPeerCertificate: func(raw [][]byte, _ [][]*x509.Certificate) error {
			if len(raw) == 0 || !bytes.Equal(raw[0], block.Bytes) {
				return errors.New("agentique: server certificate does not match " + certPath)
			}
			return nil
		},
	}
	return &agentiqueClient{
		base:  "https://127.0.0.1:" + port,
		token: token,
		http:  &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{TLSClientConfig: tlsCfg}},
	}, nil
}

var tomlLine = regexp.MustCompile(`(?m)^\s*([\w-]+)\s*=\s*"([^"]*)"`)

func tomlString(cfg []byte, key string) string {
	for _, m := range tomlLine.FindAllSubmatch(cfg, -1) {
		if string(m[1]) == key {
			return string(m[2])
		}
	}
	return ""
}

var errNotFound = errors.New("not found")

func (c *agentiqueClient) get(ctx context.Context, path string, v any) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("agentique: GET %s: %w", path, errNotFound)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("agentique: GET %s: %s", path, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

// agents reads the sessions and councils of this Agentique and of every
// machine it reaches (its read proxy, /api/read/machines/{id}/...), so agents
// on the other machines are on the screen too. A machine that does not answer
// is left out of this round; councils that cannot be read (a 404 from an
// Agentique without them) are none.
func (c *agentiqueClient) agents(ctx context.Context) (Agents, error) {
	if c.held == nil {
		c.held = map[string]source{}
	}
	src, err := c.fetchSource(ctx, "/api/read")
	self, err := c.hold("", src, err)
	if err != nil {
		return Agents{}, err
	}
	var m struct {
		Machines []struct {
			ID    string `json:"id"`
			Self  bool   `json:"self"`
			Reach string `json:"reach"`
		} `json:"machines"`
	}
	if c.get(ctx, "/api/read/machines", &m) == nil { // otherwise the machines from before
		c.machines = nil
		for _, mc := range m.Machines {
			if !mc.Self && mc.Reach == "ok" {
				c.machines = append(c.machines, mc.ID)
			}
		}
	}
	type answer struct {
		id  string
		src source
		err error
	}
	answers := make(chan answer, len(c.machines))
	for _, id := range c.machines {
		go func() {
			src, err := c.fetchSource(ctx, "/api/read/machines/"+id)
			answers <- answer{id, src, err}
		}()
	}
	all, councils := self.sessions, self.councils
	for range c.machines {
		a := <-answers
		if src, err := c.hold(a.id, a.src, a.err); err == nil {
			all = append(all, src.sessions...)
			councils = append(councils, src.councils...)
		}
	}
	updated := func(c Council) time.Time { t, _ := time.Parse(time.RFC3339Nano, c.UpdatedAt); return t }
	sort.SliceStable(councils, func(i, j int) bool { return updated(councils[i]).After(updated(councils[j])) })
	for _, sess := range all {
		if _, ok := c.names[sess.ProjectID]; !ok && time.Since(c.namesAt) > time.Minute {
			c.loadProjects(ctx)
			break
		}
	}
	a := summarize(all, c.names, time.Now())
	a.Councils = councils
	return a, nil
}

// A machine's sessions and councils as last read. One slow or failed read
// does not empty the screen: the last good answer stands for holdFor, so
// creatures do not go home and come back, nor councils come and go, with
// every timeout.
type source struct {
	sessions       []readSession
	councils       []Council
	councilsFailed bool
	at             time.Time
}

var holdFor = time.Minute

// fetchSource reads one machine (prefix /api/read, or its proxy path). No
// councils route (an older Agentique) is no councils, not a failure.
func (c *agentiqueClient) fetchSource(ctx context.Context, prefix string) (source, error) {
	var s struct {
		Sessions []readSession `json:"sessions"`
	}
	if err := c.get(ctx, prefix+"/sessions", &s); err != nil {
		return source{}, err
	}
	var r struct {
		Councils []Council `json:"councils"`
	}
	err := c.get(ctx, prefix+"/councils", &r)
	return source{sessions: s.Sessions, councils: r.Councils, councilsFailed: err != nil && !errors.Is(err, errNotFound), at: time.Now()}, nil
}

// hold keeps a good answer for key and stands in the last one for a failed
// read while it is fresh.
func (c *agentiqueClient) hold(key string, src source, err error) (source, error) {
	h, had := c.held[key]
	if err != nil {
		if had && time.Since(h.at) < holdFor {
			return h, nil
		}
		return source{}, err
	}
	if src.councilsFailed && had {
		src.councils = h.councils
	}
	c.held[key] = src
	return src, nil
}

// loadProjects names the projects of this machine and the ones it reaches;
// at most once a minute, so a machine that keeps failing is not asked every
// poll.
func (c *agentiqueClient) loadProjects(ctx context.Context) {
	c.namesAt = time.Now()
	names := map[string]string{}
	for _, path := range append([]string{"/api/read/projects"}, machinePaths(c.machines, "projects")...) {
		var p struct {
			Projects []struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"projects"`
		}
		if c.get(ctx, path, &p) != nil {
			continue
		}
		for _, pr := range p.Projects {
			names[pr.ID] = pr.Name
		}
	}
	c.names = names
}

func machinePaths(ids []string, route string) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = "/api/read/machines/" + id + "/" + route
	}
	return out
}

const (
	recentFor      = time.Hour        // updated within this, a session gets its own row
	archivedFor    = 24 * time.Hour   // archived within this, a session is still in Sessions
	newQuestionFor = 10 * time.Minute // a question this fresh marks the other screens
)

// summarize splits live sessions into rows for those updated in the last
// hour, newest first, and counts for the rest. Stopped, failed and done
// (finished for good) sessions are left out, even with a turn nobody looked
// at: Agentique keeps hundreds of those. Sessions has every live and parked
// session and those archived in the last day, for the game; Totals count all.
func summarize(sessions []readSession, names map[string]string, now time.Time) Agents {
	var a Agents
	type ranked struct {
		row     AgentRow
		updated time.Time
	}
	var rows []ranked
	models := map[string]bool{}
	for _, s := range sessions {
		label := names[s.ProjectID]
		if label == "" {
			label = s.Name
		}
		short := shortName(label)
		helpers := 0
		if s.InFlight != nil {
			helpers = *s.InFlight
		}
		context := -1
		if s.ContextPct != nil {
			context = int(math.Round(min(max(*s.ContextPct, 0), 100)))
		}
		sess := Session{ID: s.ID, Name: short, Turns: s.TurnCount, Merged: s.Merged, Parent: s.ParentID, Helpers: helpers, Context: context}
		a.Totals.Sessions++
		a.Totals.Turns += s.TurnCount
		if s.Merged {
			a.Totals.Merged++
		}
		if s.Model != "" {
			models[s.Model] = true
		}
		if s.ArchivedAt != "" {
			a.Totals.Archived++
			if at, err := time.Parse(time.RFC3339Nano, s.ArchivedAt); err == nil && now.Sub(at) < archivedFor {
				sess.State = agentArchived
				a.Sessions = append(a.Sessions, sess)
			}
			continue
		}
		var st uint8
		ny := s.NeedsYou
		switch {
		case s.State == "stopped":
			sess.State = agentParked
			a.Sessions = append(a.Sessions, sess)
			continue
		case s.State != "idle" && s.State != "running" && s.State != "merging":
			continue
		case ny != nil && (ny.ApprovalTool != "" || ny.Question || ny.SurfacesWaiting > 0 || ny.WaitingSince != ""):
			st = agentWaiting
			a.Waiting++
		case s.State != "idle":
			st = agentWorking
			a.Running++
		case ny != nil && ny.UnseenCompletedAt != "":
			st = agentDone
		default:
			st = agentIdle
		}
		sess.State = st
		a.Sessions = append(a.Sessions, sess)
		updated, _ := time.Parse(time.RFC3339Nano, s.UpdatedAt)
		if st == agentWaiting {
			since := updated
			if t, err := time.Parse(time.RFC3339Nano, ny.WaitingSince); err == nil {
				since = t
			}
			if now.Sub(since) < newQuestionFor {
				a.NewQuestion = true
			}
		}
		if now.Sub(updated) >= recentFor && st != agentWorking {
			if st == agentWaiting {
				a.LaterWaiting++
				a.OldestWait = max(a.OldestWait, now.Sub(updated))
			} else {
				a.LaterIdle++
			}
			continue
		}
		rows = append(rows, ranked{AgentRow{short, st, s.ID, s.ParentID, helpers, context}, updated})
	}
	a.Totals.Models = len(models)
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].updated.After(rows[j].updated) })
	for _, r := range rows {
		a.Rows = append(a.Rows, r.row)
	}
	return a
}

var nonAlnum = regexp.MustCompile(`[^A-Za-z0-9]+`)

// shortName makes a 5-character label: "QMK Userspace" -> "QMK",
// "The Pint" -> "PINT", "terminal-drift" -> "TERMI".
func shortName(s string) string {
	for _, w := range nonAlnum.Split(asciiOnly(s), -1) {
		if w == "" || strings.EqualFold(w, "the") {
			continue
		}
		w = strings.ToUpper(w)
		return w[:min(5, len(w))]
	}
	return "?"
}
