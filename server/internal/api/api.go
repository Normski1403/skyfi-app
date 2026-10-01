// Package api serves the web app and the JSON API.
//
// Web app:   GET /api/v1/state, GET /api/v1/stream (SSE), POST land/launch/autoland/sim
// Panel:     GET /api/v1/status|environment|wifi, POST /api/v1/land — the Presto's
//            WiFi fallback link (same contract as skyfiscreen/mock-server).
package api

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"time"

	"github.com/zimchaa/skyfi-app/server/internal/core"
	"github.com/zimchaa/skyfi-app/server/internal/presto"
)

type Server struct {
	Station *core.Station
	Static  fs.FS
	WiFi    presto.WiFiInfo
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /", http.FileServerFS(s.Static))

	mux.HandleFunc("GET /api/v1/state", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, s.Station.Snapshot())
	})
	mux.HandleFunc("GET /api/v1/stream", s.stream)
	mux.HandleFunc("POST /api/v1/land", s.land)
	mux.HandleFunc("POST /api/v1/launch", s.launch)
	mux.HandleFunc("POST /api/v1/autoland", s.autoland)
	mux.HandleFunc("POST /api/v1/sim", s.sim)

	// Presto WiFi fallback (polled by skyfiscreen/src/net.cpp)
	mux.HandleFunc("GET /api/v1/status", s.compatStatus)
	mux.HandleFunc("GET /api/v1/environment", s.compatEnvironment)
	mux.HandleFunc("GET /api/v1/wifi", s.compatWiFi)
	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(http.MaxBytesReader(nil, r.Body, 4096)).Decode(v)
}

// stream pushes a full snapshot on every change (≤ 4 Hz) plus a 1 Hz heartbeat.
func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	changes, unsub := s.Station.Subscribe()
	defer unsub()
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		b, _ := json.Marshal(s.Station.Snapshot())
		if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
			return
		}
		fl.Flush()
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
		case <-changes:
			time.Sleep(250 * time.Millisecond)
		}
	}
}

func (s *Server) land(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Source  string `json:"source"`
		Reason  string `json:"reason"`
		Confirm bool   `json:"confirm"`
		ID      string `json:"id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"accepted": false, "error": err.Error()})
		return
	}
	if !req.Confirm {
		writeJSON(w, http.StatusOK, map[string]any{"accepted": false, "error": "confirm required"})
		return
	}
	source := "web"
	if req.Source == "presto-panel" { // firmware's WiFi client
		source = "presto-wifi"
	}
	reason := req.Reason
	if reason == "" || reason == "operator_button" {
		reason = "operator LAND"
	}
	cmd, ok, msg := s.Station.Land(source, reason, req.ID)
	writeJSON(w, http.StatusOK, map[string]any{"accepted": ok, "command_id": cmd, "result": msg})
}

func (s *Server) launch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Alt float64 `json:"alt"`
	}
	_ = readJSON(r, &req)
	if err := s.Station.Launch("web", req.Alt); err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) autoland(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	s.Station.SetAutoLand("web", req.Enabled)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// sim drives the simulator for demos/tests:
//
//	{"power_fault": true}                      tether power lost -> battery drain
//	{"weather": {"wind": 12, "gust": 16}, "for_s": 60}   override real weather
//	{"weather": null}                          clear override
func (s *Server) sim(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PowerFault *bool            `json:"power_fault"`
		Weather    *json.RawMessage `json:"weather"`
		ForS       float64          `json:"for_s"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if req.PowerFault != nil {
		s.Station.SetPowerFault(*req.PowerFault)
	}
	if req.Weather != nil {
		var wx *core.Weather
		if err := json.Unmarshal(*req.Weather, &wx); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		d := time.Duration(max(req.ForS, 1) * float64(time.Second))
		if req.ForS == 0 {
			d = time.Minute
		}
		s.Station.SimulateWeather(wx, d)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ── Presto WiFi fallback contract ────────────────────────────────────

func (s *Server) compatStatus(w http.ResponseWriter, r *http.Request) {
	snap := s.Station.Snapshot()
	drone := snap.Drone.State
	if drone == core.Descending {
		drone = "landing"
	}
	writeJSON(w, http.StatusOK, map[string]any{"system": snap.Sys, "drone": drone, "link": "ok", "ts": snap.Time.Unix()})
}

func (s *Server) compatEnvironment(w http.ResponseWriter, r *http.Request) {
	snap := s.Station.Snapshot()
	sev := func(v, warn, danger float64) string {
		switch {
		case v >= danger:
			return "fault"
		case v >= warn:
			return "warn"
		}
		return "ok"
	}
	val := func(p *float64) float64 {
		if p == nil {
			return 0
		}
		return *p
	}
	p, d, wx := snap.Policy, snap.Drone, snap.Weather
	battSev := "ok"
	if d.Batt <= p.BattLand {
		battSev = "fault"
	} else if d.Batt <= p.BattWarn {
		battSev = "warn"
	}
	writeJSON(w, http.StatusOK, map[string]any{"readings": []map[string]any{
		{"id": "wind", "label": "WIND", "value": val(wx.Wind), "unit": "m/s", "status": sev(val(wx.Wind), p.WindWarn, p.WindLand)},
		{"id": "gust", "label": "GUST", "value": val(wx.Gust), "unit": "m/s", "status": sev(val(wx.Gust), p.GustWarn, p.GustLand)},
		{"id": "tether", "label": "TETHER", "value": d.Tether, "unit": "kg", "status": sev(d.Tether, 16, 20)},
		{"id": "battery", "label": "BATTERY", "value": d.Batt, "unit": "%", "status": battSev},
	}})
}

func (s *Server) compatWiFi(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ssid": s.WiFi.SSID, "auth": "WPA2", "password": s.WiFi.Password,
		"qr": fmt.Sprintf("WIFI:T:WPA;S:%s;P:%s;;", s.WiFi.SSID, s.WiFi.Password),
	})
}
