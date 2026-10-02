package preflight

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"
	"os"
	"strings"
	"sync"
	"time"
)

// Service ties the bundle, the store and live station state together, and
// is the launch gate.
type Service struct {
	mu     sync.Mutex
	bundle *Bundle
	store  *Store
	host   string
	live   func() Live // must not call back into Service
}

func NewService(b *Bundle, st *Store, live func() Live) *Service {
	host, _ := os.Hostname()
	return &Service{bundle: b, store: st, host: host, live: live}
}

func (s *Service) Bundle() *Bundle { return s.bundle }
func (s *Service) Store() *Store   { return s.store }

func newID(prefix string) string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return prefix + time.Now().UTC().Format("20060102-1504") + "-" + hex.EncodeToString(b[:3])
}

// View is a run plus everything the client needs to render it: the site,
// the procedure with $tokens expanded, operators, and the server's verdict.
type View struct {
	Run       *Run         `json:"run"`
	Site      Site         `json:"site"`
	Procedure Procedure    `json:"procedure"`
	Operators []Operator   `json:"operators"`
	Steps     []StepStatus `json:"steps"`
	Ready     bool         `json:"ready"` // every step complete: can be sealed
	MaxAltM   float64      `json:"max_alt_m"`
}

func (s *Service) env(r *Run, site Site, live Live) Env {
	return Env{Site: site, Bundle: s.bundle, Data: r.Data, Live: live, BlobExist: s.store.BlobExists}
}

func (s *Service) view(r *Run, live Live) (*View, error) {
	site, ok := s.bundle.Site(r.SiteID)
	if !ok {
		return nil, fmt.Errorf("site %s is no longer configured", r.SiteID)
	}
	proc, ok := s.bundle.Procedures[r.ProcedureID]
	if !ok {
		return nil, fmt.Errorf("procedure %s is no longer configured", r.ProcedureID)
	}
	e := s.env(r, site, live)
	steps := e.Validate(proc)
	ready := true
	for _, st := range steps {
		ready = ready && st.Complete
	}
	// Expand $tokens in display text.
	shown := proc
	shown.Steps = make([]Step, len(proc.Steps))
	for i, st := range proc.Steps {
		if st.Intro != nil {
			in := *st.Intro
			in.Text = e.Text(proc, in.Text)
			st.Intro = &in
		}
		fs := make([]Field, len(st.Fields))
		for j, f := range st.Fields {
			f.Text = e.Text(proc, f.Text)
			if v, ok := f.Min.(string); ok {
				if n, ok := e.number(proc, v); ok {
					f.Min = n
				}
			}
			fs[j] = f
		}
		st.Fields = fs
		shown.Steps[i] = st
	}
	return &View{Run: r, Site: site, Procedure: shown, Operators: s.bundle.Operators,
		Steps: steps, Ready: ready && r.Status == "draft", MaxAltM: e.MaxAlt(proc)}, nil
}

// Start begins a draft for a site, prefilled with the procedure's defaults.
func (s *Service) Start(siteID string) (*View, error) {
	live := s.live()
	s.mu.Lock()
	defer s.mu.Unlock()
	site, ok := s.bundle.Site(siteID)
	if !ok {
		return nil, fmt.Errorf("unknown site %q", siteID)
	}
	proc := s.bundle.Procedures[site.Procedure]
	now := time.Now()
	r := &Run{ID: newID("pf-"), SiteID: site.ID, ProcedureID: proc.ID, ProcedureVersion: proc.Version,
		Status: "draft", Data: Data{}, CreatedAt: now, UpdatedAt: now}
	e := s.env(r, site, live)
	for _, st := range proc.Steps {
		for _, f := range st.Fields {
			if f.Default == nil {
				continue
			}
			v := f.Default
			if str, ok := v.(string); ok && strings.HasPrefix(str, "$") {
				if rv, ok := e.lookup(proc, str); ok {
					v = rv
				} else {
					continue
				}
			}
			if r.Data[st.ID] == nil {
				r.Data[st.ID] = map[string]any{}
			}
			r.Data[st.ID][f.ID] = v
		}
	}
	if err := s.store.CreateRun(r); err != nil {
		return nil, err
	}
	return s.view(r, live)
}

func (s *Service) Get(id string) (*View, error) {
	live := s.live()
	s.mu.Lock()
	defer s.mu.Unlock()
	r, err := s.store.GetRun(id)
	if err != nil {
		return nil, err
	}
	return s.view(r, live)
}

// SaveStep replaces one step's answers in a draft and returns the new verdict.
func (s *Service) SaveStep(id, stepID string, values map[string]any) (*View, error) {
	live := s.live()
	s.mu.Lock()
	defer s.mu.Unlock()
	r, err := s.store.GetRun(id)
	if err != nil {
		return nil, err
	}
	proc := s.bundle.Procedures[r.ProcedureID]
	known := false
	for _, st := range proc.Steps {
		known = known || st.ID == stepID
	}
	if !known {
		return nil, fmt.Errorf("unknown step %q", stepID)
	}
	r.Data[stepID] = values
	if err := s.store.SaveDraft(id, r.Data, time.Now()); err != nil {
		return nil, err
	}
	return s.view(r, live)
}

func (s *Service) Void(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.store.VoidRun(id, time.Now())
}

// sealedRecord is the canonical content that gets hashed and signed.
type sealedRecord struct {
	Type      string     `json:"type"`
	ID        string     `json:"id"`
	Device    deviceInfo `json:"device"`
	Site      Site       `json:"site"`
	Procedure struct {
		ID      string `json:"id"`
		Version string `json:"version"`
	} `json:"procedure"`
	Data        Data      `json:"data"`
	PIC         Operator  `json:"pic"`
	MaxAltM     float64   `json:"max_alt_m"`
	TargetAltM  float64   `json:"target_alt_m"`
	StartedAt   time.Time `json:"started_at"`
	CompletedAt time.Time `json:"completed_at"`
	ExpiresAt   time.Time `json:"expires_at"`
}

type deviceInfo struct {
	Host      string `json:"host"`
	PublicKey string `json:"public_key"`
}

// Complete re-validates server-side, records the live weather observed, and
// seals the run. It then becomes the site's launch clearance until expiry.
func (s *Service) Complete(id string) (*View, error) {
	live := s.live()
	s.mu.Lock()
	defer s.mu.Unlock()
	r, err := s.store.GetRun(id)
	if err != nil {
		return nil, err
	}
	if r.Status != "draft" {
		return nil, fmt.Errorf("pre-flight %s is already %s", id, r.Status)
	}
	site, _ := s.bundle.Site(r.SiteID)
	proc := s.bundle.Procedures[r.ProcedureID]
	e := s.env(r, site, live)
	for _, st := range e.Validate(proc) {
		if !st.Complete {
			return nil, fmt.Errorf("step %q is not complete: %s", st.ID, strings.Join(st.Errors, "; "))
		}
	}

	// Freeze what the live checks saw into the record.
	for _, st := range proc.Steps {
		for _, f := range st.Fields {
			if f.Type == "live_weather" {
				r.Data[st.ID][f.ID] = map[string]any{"wind": live.Wind, "gust": live.Gust,
					"age_s": live.WxAgeS, "checked_at": live.Now.UTC()}
			}
		}
	}

	var pic Operator
	target := math.NaN()
	for _, st := range proc.Steps {
		for _, f := range st.Fields {
			if f.Type == "crew" {
				m, _ := r.Data[st.ID][f.ID].(map[string]any)
				id, _ := m["pic"].(string)
				pic, _ = s.bundle.Operator(id)
			}
			if st.ID == "parameters" && f.ID == "altitude" {
				target, _ = e.number(proc, r.Data[st.ID][f.ID])
			}
		}
	}
	maxAlt := e.MaxAlt(proc)
	if math.IsNaN(target) || target > maxAlt {
		target = maxAlt
	}

	now := time.Now()
	exp := now.Add(time.Duration(site.Rules.ValidityH * float64(time.Hour)))
	rec := sealedRecord{Type: "preflight", ID: r.ID, Device: deviceInfo{s.host, s.store.PublicKey()},
		Site: site, Data: r.Data, PIC: pic, MaxAltM: maxAlt, TargetAltM: target,
		StartedAt: r.CreatedAt.UTC(), CompletedAt: now.UTC(), ExpiresAt: exp.UTC()}
	rec.Procedure.ID, rec.Procedure.Version = proc.ID, proc.Version
	canon, hash, sig, err := s.store.seal(rec)
	if err != nil {
		return nil, err
	}
	r.Status, r.CompletedAt, r.ExpiresAt = "complete", &now, &exp
	r.PicID, r.MaxAltM, r.TargetAltM, r.SealHash, r.SealSig, r.SyncStatus = pic.ID, maxAlt, target, hash, sig, "pending"
	if err := s.store.completeRun(r, canon); err != nil {
		return nil, err
	}
	return s.view(r, live)
}

// ── clearance (launch gate) ──────────────────────────────────────────

// Clearance is what currently permits (or doesn't) a launch.
type Clearance struct {
	State      string     `json:"state"` // cleared | override | none
	SiteID     string     `json:"site_id,omitempty"`
	SiteName   string     `json:"site_name,omitempty"`
	RunID      string     `json:"run_id,omitempty"`
	By         string     `json:"by,omitempty"` // PiC / overriding operator
	Reason     string     `json:"reason,omitempty"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	SealHash   string     `json:"seal_hash,omitempty"`
	MaxAltM    float64    `json:"max_alt_m,omitempty"`
	TargetAltM float64    `json:"target_alt_m,omitempty"`
	WindLandMS float64    `json:"wind_land_ms,omitempty"`
	GustLandMS float64    `json:"gust_land_ms,omitempty"`
}

// Current returns the clearance in force: the latest unexpired sealed
// pre-flight, else an unexpired override, else none.
func (s *Service) Current() Clearance {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if r, _ := s.store.latestComplete(); r != nil && r.ExpiresAt != nil && now.Before(*r.ExpiresAt) {
		if site, ok := s.bundle.Site(r.SiteID); ok {
			pic, _ := s.bundle.Operator(r.PicID)
			return Clearance{State: "cleared", SiteID: site.ID, SiteName: site.Name, RunID: r.ID, By: pic.Name,
				ExpiresAt: r.ExpiresAt, SealHash: r.SealHash, MaxAltM: r.MaxAltM, TargetAltM: r.TargetAltM,
				WindLandMS: site.Rules.WindLandMS, GustLandMS: site.Rules.GustLandMS}
		}
	}
	if o, _ := s.store.latestOverride(); o != nil && now.Before(o.ExpiresAt) {
		if site, ok := s.bundle.Site(o.SiteID); ok {
			op, _ := s.bundle.Operator(o.OperatorID)
			exp := o.ExpiresAt
			return Clearance{State: "override", SiteID: site.ID, SiteName: site.Name, By: op.Name, Reason: o.Reason,
				ExpiresAt: &exp, SealHash: o.SealHash, MaxAltM: site.Rules.MaxAltM,
				WindLandMS: site.Rules.WindLandMS, GustLandMS: site.Rules.GustLandMS}
		}
	}
	return Clearance{State: "none"}
}

// CheckLaunch is the launch gate: it returns the altitude to fly (the
// request capped by the clearance, or the pre-flight's target if 0).
func (s *Service) CheckLaunch(requestAlt float64) (Clearance, float64, error) {
	c := s.Current()
	if c.State == "none" {
		return c, 0, fmt.Errorf("no valid pre-flight: complete the pre-flight (or use an emergency override)")
	}
	alt := requestAlt
	if alt <= 0 {
		alt = c.TargetAltM
	}
	if alt <= 0 {
		alt = math.Min(30, c.MaxAltM)
	}
	return c, math.Min(alt, c.MaxAltM), nil
}

// Override records a sealed emergency override for a site.
func (s *Service) Override(siteID, operatorID, reason string) (Clearance, error) {
	s.mu.Lock()
	site, ok := s.bundle.Site(siteID)
	if !ok {
		s.mu.Unlock()
		return Clearance{}, fmt.Errorf("unknown site %q", siteID)
	}
	if !site.Rules.AllowOverride {
		s.mu.Unlock()
		return Clearance{}, fmt.Errorf("site %s does not allow overrides", site.Name)
	}
	op, ok := s.bundle.Operator(operatorID)
	now := time.Now()
	if !ok || !op.Has("pic") || !op.CertValid(now) {
		s.mu.Unlock()
		return Clearance{}, fmt.Errorf("an override needs a pilot in command with a valid certificate")
	}
	reason = strings.TrimSpace(reason)
	if len(reason) < 10 {
		s.mu.Unlock()
		return Clearance{}, fmt.Errorf("give a reason (at least 10 characters)")
	}
	validity := site.Rules.OverrideValidityH
	if validity <= 0 {
		validity = 1
	}
	o := &Override{ID: newID("ov-"), SiteID: site.ID, OperatorID: op.ID, Reason: reason,
		CreatedAt: now, ExpiresAt: now.Add(time.Duration(validity * float64(time.Hour)))}
	rec := map[string]any{"type": "override", "id": o.ID, "site": site, "operator": op, "reason": reason,
		"created_at": now.UTC(), "expires_at": o.ExpiresAt.UTC(),
		"device": deviceInfo{s.host, s.store.PublicKey()}, "flag": "review_required"}
	canon, hash, sig, err := s.store.seal(rec)
	if err == nil {
		o.SealHash, o.SealSig = hash, sig
		err = s.store.addOverride(o, canon)
	}
	s.mu.Unlock()
	if err != nil {
		return Clearance{}, err
	}
	return s.Current(), nil
}
