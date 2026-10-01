// Package core is the ground-station state: the (simulated) drone, weather from
// the Presto, safety policy, and the single command path every LAND goes through.
package core

import (
	"fmt"
	"net"
	"os"
	"slices"
	"sync"
	"time"
)

// Weather fields are pointers so partial updates (e.g. the legacy debug lines,
// which arrive as separate wind and light lines) merge without zeroing others.
type Weather struct {
	Wind     *float64  `json:"wind,omitempty"`      // m/s
	Gust     *float64  `json:"gust,omitempty"`      // m/s
	Dir      *float64  `json:"dir,omitempty"`       // degrees
	Rain     *float64  `json:"rain,omitempty"`      // mm
	RainRate *float64  `json:"rain_rate,omitempty"` // mm/h
	Temp     *float64  `json:"temp,omitempty"`      // °C
	Hum      *float64  `json:"hum,omitempty"`       // %RH
	Pres     *float64  `json:"pres,omitempty"`      // hPa
	Lux      *float64  `json:"lux,omitempty"`
	Source   string    `json:"source"`
	Updated  time.Time `json:"updated"`
}

func (w *Weather) merge(u Weather) {
	for _, f := range []struct{ dst, src **float64 }{
		{&w.Wind, &u.Wind}, {&w.Gust, &u.Gust}, {&w.Dir, &u.Dir}, {&w.Rain, &u.Rain},
		{&w.RainRate, &u.RainRate}, {&w.Temp, &u.Temp}, {&w.Hum, &u.Hum},
		{&w.Pres, &u.Pres}, {&w.Lux, &u.Lux},
	} {
		if *f.src != nil {
			*f.dst = *f.src
		}
	}
}

func (w Weather) wind() float64 {
	if w.Wind == nil {
		return 0
	}
	return *w.Wind
}

// Panel is the Presto as seen over USB.
type Panel struct {
	Connected bool      `json:"connected"` // serial port open
	Alive     bool      `json:"alive"`     // a line arrived recently
	FW        string    `json:"fw"`
	Proto     int       `json:"proto"` // 0 = legacy debug lines only
	Device    string    `json:"device"`
	LastSeen  time.Time `json:"last_seen"`
	LastLog   string    `json:"last_log"`
}

type Event struct {
	Time   time.Time `json:"time"`
	Kind   string    `json:"kind"` // command | auto | panel | info
	Source string    `json:"source"`
	Msg    string    `json:"msg"`
}

// Snapshot is the full state as served to the web app and used for Presto status.
type Snapshot struct {
	Time    time.Time `json:"time"`
	Host    string    `json:"host"`
	IPs     []string  `json:"ips"`
	Uptime  int64     `json:"uptime_s"`
	Sys     string    `json:"sys"`
	Alerts  []Alert   `json:"alerts"`
	Drone   Drone     `json:"drone"`
	Weather Weather   `json:"weather"`
	WxAge   float64   `json:"weather_age_s"` // -1 if never
	Panel   Panel     `json:"panel"`
	Policy  Policy    `json:"policy"`
	Events  []Event   `json:"events"`
}

const (
	panelAliveFor = 5 * time.Second
	maxEvents     = 200
)

type Station struct {
	mu      sync.Mutex
	started time.Time
	host    string

	drone         Drone
	wx            Weather
	wxOverride    *Weather // simulated weather (demo), wins until expiry
	wxOverrideEnd time.Time
	policy        Policy
	panel         Panel
	alerts        []Alert
	windHighSince time.Time

	events  []Event
	cmdSeq  int
	landIDs map[string]string // panel land id -> command id (idempotent retries)

	subs map[chan struct{}]struct{}
}

func NewStation() *Station {
	host, _ := os.Hostname()
	s := &Station{
		started: time.Now(),
		host:    host,
		drone:   newDrone(),
		policy:  defaultPolicy(),
		landIDs: map[string]string{},
		subs:    map[chan struct{}]struct{}{},
	}
	s.logLocked("info", "server", "Ground station started")
	return s
}

// ── change notification ──────────────────────────────────────────────

// Subscribe returns a channel that receives a (coalesced) signal on every change.
func (s *Station) Subscribe() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	return ch, func() {
		s.mu.Lock()
		delete(s.subs, ch)
		s.mu.Unlock()
	}
}

func (s *Station) notifyLocked() {
	for ch := range s.subs {
		select {
		case ch <- struct{}{}:
		default: // already pending
		}
	}
}

func (s *Station) logLocked(kind, source, msg string) {
	s.events = append(s.events, Event{time.Now(), kind, source, msg})
	if len(s.events) > maxEvents {
		s.events = s.events[len(s.events)-maxEvents:]
	}
}

// ── commands (one path for web, panel and auto) ──────────────────────

// Land commands a landing. dedupeKey (the panel's land id) makes retries
// idempotent: a repeated key returns the original command id without re-issuing.
func (s *Station) Land(source, reason, dedupeKey string) (cmdID string, accepted bool, msg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.landLocked(source, reason, dedupeKey)
}

func (s *Station) landLocked(source, reason, dedupeKey string) (cmdID string, accepted bool, msg string) {
	if dedupeKey != "" {
		if id, ok := s.landIDs[dedupeKey]; ok {
			return id, true, "duplicate"
		}
	}
	s.cmdSeq++
	cmdID = fmt.Sprintf("c-%04d", s.cmdSeq)
	if dedupeKey != "" {
		s.landIDs[dedupeKey] = cmdID
	}

	switch s.drone.State {
	case Ascending, Airborne:
		s.drone.State = Descending
		msg = "landing"
	case Descending:
		msg = "already landing"
	default:
		msg = "already grounded"
	}
	kind := "command"
	if source == "auto" {
		kind = "auto"
	}
	text := "LAND (" + msg + ")"
	if reason != "" {
		text += ": " + reason
	}
	s.logLocked(kind, source, text+" ["+cmdID+"]")
	s.notifyLocked()
	return cmdID, true, msg
}

func (s *Station) Launch(source string, alt float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.drone.State != Grounded {
		return fmt.Errorf("cannot launch while %s", s.drone.State)
	}
	if alt > 0 {
		s.drone.TargetAlt = min(alt, 120)
	}
	for _, a := range s.alerts {
		if a.Level == LevelFault {
			return fmt.Errorf("launch blocked: %s", a.Msg)
		}
	}
	s.drone.State = Ascending
	s.logLocked("command", source, fmt.Sprintf("LAUNCH to %.0f m", s.drone.TargetAlt))
	s.notifyLocked()
	return nil
}

func (s *Station) SetAutoLand(source string, on bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.policy.AutoLand = on
	s.logLocked("command", source, fmt.Sprintf("Auto-land %s", map[bool]string{true: "armed", false: "DISARMED"}[on]))
	s.notifyLocked()
}

// ── simulation hooks (demo / testing) ────────────────────────────────

func (s *Station) SetPowerFault(on bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.drone.PowerFault = on
	s.logLocked("info", "sim", fmt.Sprintf("Tether power fault %v", on))
	s.notifyLocked()
}

// SimulateWeather overrides real weather for d (nil clears the override).
func (s *Station) SimulateWeather(w *Weather, d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.wxOverride, s.wxOverrideEnd = w, time.Now().Add(d)
	if w != nil {
		s.logLocked("info", "sim", fmt.Sprintf("Simulated weather for %s", d))
	}
	s.notifyLocked()
}

// ── panel inputs ─────────────────────────────────────────────────────

func (s *Station) UpdateWeather(u Weather, source string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.wx.merge(u)
	s.wx.Source = source
	s.wx.Updated = time.Now()
	s.notifyLocked()
}

func (s *Station) PanelConnected(device string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.panel = Panel{Connected: true, Device: device}
	s.logLocked("panel", "presto-usb", "Serial link open: "+device)
	s.notifyLocked()
}

func (s *Station) PanelDisconnected(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.panel.Connected {
		return
	}
	s.panel.Connected, s.panel.Alive = false, false
	s.logLocked("panel", "presto-usb", fmt.Sprintf("Serial link closed: %v", err))
	s.notifyLocked()
}

// PanelSeen records any line from the panel; proto > 0 marks a hello message.
func (s *Station) PanelSeen(fw string, proto int, logLine string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	wasAlive := s.panel.Alive
	s.panel.LastSeen, s.panel.Alive = time.Now(), true
	if logLine != "" {
		s.panel.LastLog = logLine
	}
	if proto > 0 {
		s.panel.FW, s.panel.Proto = fw, proto
		s.logLocked("panel", "presto-usb", fmt.Sprintf("hello: %s (proto %d)", fw, proto))
	}
	if !wasAlive || proto > 0 {
		s.notifyLocked()
	}
}

// ── clock ────────────────────────────────────────────────────────────

func (s *Station) effectiveWxLocked() Weather {
	if s.wxOverride != nil && time.Now().Before(s.wxOverrideEnd) {
		w := *s.wxOverride
		w.Source, w.Updated = "sim", time.Now()
		return w
	}
	return s.wx
}

// Tick advances the simulation, re-evaluates policy and fires auto-land.
func (s *Station) Tick(dt time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if s.wxOverride != nil && now.After(s.wxOverrideEnd) {
		s.wxOverride = nil
		s.logLocked("info", "sim", "Simulated weather ended")
	}
	if s.panel.Alive && now.Sub(s.panel.LastSeen) > panelAliveFor {
		s.panel.Alive = false
		s.logLocked("panel", "presto-usb", "Panel silent > 5s")
	}

	wx := s.effectiveWxLocked()
	s.drone.step(dt.Seconds(), wx.wind())

	alerts, landReason := s.policy.evaluate(now, s.drone, wx, s.panel.Alive, &s.windHighSince)
	slices.SortStableFunc(alerts, func(a, b Alert) int {
		if a.Level == b.Level {
			return 0
		}
		if a.Level == LevelFault {
			return -1
		}
		return 1
	})
	s.alerts = alerts

	if landReason != "" && s.policy.AutoLand && s.drone.flying() {
		s.landLocked("auto", landReason, "")
	}
	s.notifyLocked()
}

func (s *Station) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	wx := s.effectiveWxLocked()
	age := -1.0
	if !wx.Updated.IsZero() {
		age = now.Sub(wx.Updated).Seconds()
	}
	n := min(len(s.events), 40)
	ev := slices.Clone(s.events[len(s.events)-n:])
	slices.Reverse(ev)
	return Snapshot{
		Time: now, Host: s.host, IPs: localIPs(), Uptime: int64(now.Sub(s.started).Seconds()),
		Sys: worst(s.alerts), Alerts: append([]Alert{}, s.alerts...),
		Drone: s.drone, Weather: wx, WxAge: age, Panel: s.panel, Policy: s.policy, Events: ev,
	}
}

func localIPs() []string {
	ips := []string{} // never null in JSON
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok && !n.IP.IsLoopback() && n.IP.To4() != nil {
			ips = append(ips, n.IP.String())
		}
	}
	return ips
}
