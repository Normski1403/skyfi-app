package preflight

import (
	"strings"
	"testing"
	"time"

	"github.com/zimchaa/skyfi-app/server/config"
)

func fp(v float64) *float64 { return &v }

func newSvc(t *testing.T, live Live) *Service {
	t.Helper()
	b, err := LoadBundle(config.Defaults())
	if err != nil {
		t.Fatalf("default bundle: %v", err)
	}
	st, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return NewService(b, st, func() Live { live.Now = time.Now(); return live })
}

var calm = Live{Wind: fp(2), Gust: fp(4), WxAgeS: 1}

func stepErrs(v *View, id string) []string {
	for _, s := range v.Steps {
		if s.ID == id {
			return s.Errors
		}
	}
	return nil
}

// fill answers every step of the standard procedure for the bench site.
func fill(t *testing.T, s *Service, id string) *View {
	t.Helper()
	photo, _ := s.Store().PutBlob([]byte("jpeg"))
	sig, _ := s.Store().PutBlob([]byte("png"))
	answers := map[string]map[string]any{
		"location":   {"position": map[string]any{"lat": 51.5, "lon": -0.14}},
		"weather":    {"conditions": true, "agreed": true},
		"airspace":   {"checks": map[string]any{"notam": true, "ctr": true, "mil": true, "emcomm": true}},
		"regulatory": {"acknowledged": true},
		"photo":      {"photos": []any{photo}},
		"hazards":    {"people": "none", "power": "none", "structures": "none", "water": "none", "fuel": "none"},
		"crew":       {"crew": map[string]any{"members": []any{"op-pic-1"}, "pic": "op-pic-1"}},
		"contact":    {"name": "Ops desk", "phone": "+44 1234 567890", "relation": "dispatch"},
		"parameters": {"altitude": 40.0, "tether": 50.0, "window": 120.0},
		"signature":  {"signature": map[string]any{"blob": sig}},
		"risk":       {"accepted": true},
	}
	var v *View
	var err error
	for step, vals := range answers {
		if v, err = s.SaveStep(id, step, vals); err != nil {
			t.Fatal(err)
		}
	}
	return v
}

func TestDefaultsPrefilled(t *testing.T) {
	s := newSvc(t, calm)
	v, err := s.Start("bench")
	if err != nil {
		t.Fatal(err)
	}
	if v.Run.Data["contact"]["name"] != "Ops desk" || v.Run.Data["parameters"]["altitude"] != 30.0 {
		t.Fatalf("prefill: %+v", v.Run.Data)
	}
	if v.Ready {
		t.Fatal("empty run reported ready")
	}
	if !strings.Contains(v.Procedure.Steps[3].Fields[0].Text, "Bench testing") {
		t.Fatalf("$site.regulatory not expanded: %q", v.Procedure.Steps[3].Fields[0].Text)
	}
}

func TestValidationRules(t *testing.T) {
	s := newSvc(t, calm)
	v, _ := s.Start("bench")
	v = fill(t, s, v.Run.ID)
	if !v.Ready {
		t.Fatalf("filled run not ready: %+v", v.Steps)
	}
	// Blocking hazard
	v, _ = s.SaveStep(v.Run.ID, "hazards", map[string]any{"people": "within", "power": "none", "structures": "none", "water": "none", "fuel": "none"})
	if e := stepErrs(v, "hazards"); len(e) != 1 || !strings.Contains(e[0], "blocks launch") {
		t.Fatalf("blocking hazard: %v", e)
	}
	// Structures lower the ceiling to 80, the bench ceiling (50) still wins; tether < altitude
	v, _ = s.SaveStep(v.Run.ID, "parameters", map[string]any{"altitude": 60.0, "tether": 40.0, "window": 60.0})
	if e := stepErrs(v, "parameters"); len(e) != 2 {
		t.Fatalf("parameter rules: %v", e)
	}
	// Expired PiC certificate
	v, _ = s.SaveStep(v.Run.ID, "crew", map[string]any{"crew": map[string]any{"members": []any{"op-pic-2"}, "pic": "op-pic-2"}})
	if e := stepErrs(v, "crew"); len(e) != 1 || !strings.Contains(e[0], "expired") {
		t.Fatalf("expired cert: %v", e)
	}
}

func TestGeofenceAndMinCrew(t *testing.T) {
	s := newSvc(t, calm)
	v, _ := s.Start("field-demo")
	v, _ = s.SaveStep(v.Run.ID, "location", map[string]any{"position": map[string]any{"lat": 51.52, "lon": -0.14}})
	if e := stepErrs(v, "location"); len(e) != 1 || !strings.Contains(e[0], "from the site centre") {
		t.Fatalf("geofence: %v", e)
	}
	v, _ = s.SaveStep(v.Run.ID, "crew", map[string]any{"crew": map[string]any{"members": []any{"op-pic-1"}, "pic": "op-pic-1"}})
	if e := stepErrs(v, "crew"); len(e) != 1 || !strings.Contains(e[0], "at least 2") {
		t.Fatalf("min crew: %v", e)
	}
}

func TestLiveWeatherLimit(t *testing.T) {
	s := newSvc(t, Live{Wind: fp(11), Gust: fp(12), WxAgeS: 1})
	v, _ := s.Start("bench")
	v, _ = s.SaveStep(v.Run.ID, "weather", map[string]any{"conditions": true, "agreed": true})
	if e := stepErrs(v, "weather"); len(e) != 1 || !strings.Contains(e[0], "Wind 11.0") {
		t.Fatalf("wind over limit: %v", e)
	}
}

func TestSealClearanceAndLaunch(t *testing.T) {
	s := newSvc(t, calm)
	if _, _, err := s.CheckLaunch(0); err == nil {
		t.Fatal("launch allowed without a pre-flight")
	}
	v, _ := s.Start("bench")
	fill(t, s, v.Run.ID)
	v, err := s.Complete(v.Run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if v.Run.Status != "complete" || len(v.Run.SealHash) != 64 || v.Run.SealSig == "" {
		t.Fatalf("seal: %+v", v.Run)
	}
	if _, err := s.SaveStep(v.Run.ID, "risk", map[string]any{"accepted": false}); err == nil {
		t.Fatal("sealed run was editable")
	}
	c, alt, err := s.CheckLaunch(0)
	if err != nil || c.State != "cleared" || alt != 40 {
		t.Fatalf("launch after seal: %+v alt=%v err=%v", c, alt, err)
	}
	if _, alt, _ := s.CheckLaunch(120); alt != 50 {
		t.Fatalf("request above the bench ceiling not capped: %v", alt)
	}
	rec, _ := s.Store().Record(v.Run.ID)
	if !strings.Contains(rec, `"checked_at"`) {
		t.Fatal("live weather observation not frozen into the record")
	}
	_ = s.Void(v.Run.ID)
	if c := s.Current(); c.State != "none" {
		t.Fatalf("voided pre-flight still clears launch: %+v", c)
	}
}

func TestOverride(t *testing.T) {
	s := newSvc(t, calm)
	if _, err := s.Override("bench", "op-obs-1", "flood response, no time"); err == nil {
		t.Fatal("observer allowed to override")
	}
	if _, err := s.Override("bench", "op-pic-1", "short"); err == nil {
		t.Fatal("override without a real reason")
	}
	c, err := s.Override("bench", "op-pic-1", "flood response, pre-flight app unavailable")
	if err != nil || c.State != "override" || c.By != "Pilot One" {
		t.Fatalf("override: %+v %v", c, err)
	}
	if _, alt, err := s.CheckLaunch(0); err != nil || alt != 30 {
		t.Fatalf("launch under override: alt=%v err=%v", alt, err)
	}
}
