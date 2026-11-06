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
	base  string // https://127.0.0.1:19201
	token string
	http  *http.Client
	names map[string]string // project id -> name
}

type readSession struct {
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	State     string `json:"state"`
	UpdatedAt string `json:"updatedAt"`
	NeedsYou  *struct {
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

func (c *agentiqueClient) get(ctx context.Context, path string, v any) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("agentique: GET %s: %s", path, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

func (c *agentiqueClient) agents(ctx context.Context) (Agents, error) {
	var s struct {
		Sessions []readSession `json:"sessions"`
	}
	if err := c.get(ctx, "/api/read/sessions", &s); err != nil {
		return Agents{}, err
	}
	for _, sess := range s.Sessions {
		if _, ok := c.names[sess.ProjectID]; !ok {
			c.loadProjects(ctx)
			break
		}
	}
	return summarize(s.Sessions, c.names, time.Now()), nil
}

func (c *agentiqueClient) loadProjects(ctx context.Context) {
	var p struct {
		Projects []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"projects"`
	}
	if c.get(ctx, "/api/read/projects", &p) != nil {
		return
	}
	c.names = map[string]string{}
	for _, pr := range p.Projects {
		c.names[pr.ID] = pr.Name
	}
}

const (
	recentFor      = time.Hour        // updated within this, a session gets its own row
	newQuestionFor = 10 * time.Minute // a question this fresh marks the other screens
)

// summarize splits live sessions into rows for those updated in the last
// hour, newest first, and counts for the rest. Stopped, failed and done
// (finished for good) sessions are left out, even with a turn nobody looked
// at: Agentique keeps hundreds of those.
func summarize(sessions []readSession, names map[string]string, now time.Time) Agents {
	var a Agents
	type ranked struct {
		row     AgentRow
		updated time.Time
	}
	var rows []ranked
	for _, s := range sessions {
		var st uint8
		ny := s.NeedsYou
		switch {
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
		label := names[s.ProjectID]
		if label == "" {
			label = s.Name
		}
		rows = append(rows, ranked{AgentRow{shortName(label), st}, updated})
	}
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
