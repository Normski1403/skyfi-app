package preflight

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Data is a run's answers: step id -> field id -> value (decoded JSON).
type Data map[string]map[string]any

// Live is the ground station's current state, for live_weather fields.
type Live struct {
	Wind, Gust *float64
	WxAgeS     float64 // -1 = never
	Now        time.Time
}

// Env is everything a token or rule can refer to.
type Env struct {
	Site      Site
	Bundle    *Bundle
	Data      Data
	Live      Live
	BlobExist func(id string) bool
}

// MaxAlt is the site ceiling, lowered by any hazard answer that limits it.
func (e Env) MaxAlt(p Procedure) float64 {
	alt := e.Site.Rules.MaxAltM
	for _, st := range p.Steps {
		for _, f := range st.Fields {
			if f.Type != "choice" {
				continue
			}
			v, _ := e.Data[st.ID][f.ID].(string)
			for _, o := range f.Options {
				if o.Value == v && o.MaxAltM != nil && *o.MaxAltM < alt {
					alt = *o.MaxAltM
				}
			}
		}
	}
	return alt
}

var reToken = regexp.MustCompile(`\$(site|limits)(\.[a-z_]+)+`)

// lookup resolves "$site.rules.min_crew", "$site.contact.name",
// "$limits.max_alt_m", or a "step.field" data reference.
func (e Env) lookup(p Procedure, ref string) (any, bool) {
	if strings.HasPrefix(ref, "$limits.") {
		if ref == "$limits.max_alt_m" {
			return e.MaxAlt(p), true
		}
		return nil, false
	}
	if strings.HasPrefix(ref, "$site.") {
		parts := strings.Split(strings.TrimPrefix(ref, "$site."), ".")
		r := e.Site.Rules
		switch strings.Join(parts, ".") {
		case "name":
			return e.Site.Name, true
		case "regulatory":
			return e.Site.Regulatory, true
		case "contact.name":
			return e.Site.Contact.Name, true
		case "contact.phone":
			return e.Site.Contact.Phone, true
		case "rules.max_alt_m":
			return r.MaxAltM, true
		case "rules.wind_land_ms":
			return r.WindLandMS, true
		case "rules.gust_land_ms":
			return r.GustLandMS, true
		case "rules.min_crew":
			return float64(r.MinCrew), true
		case "rules.validity_h":
			return r.ValidityH, true
		}
		return nil, false
	}
	step, field, ok := strings.Cut(ref, ".")
	if !ok {
		return nil, false
	}
	v, ok := e.Data[step][field]
	return v, ok && v != nil
}

// Text expands $tokens in config text (intros, info fields, rule messages).
func (e Env) Text(p Procedure, s string) string {
	return reToken.ReplaceAllStringFunc(s, func(tok string) string {
		v, ok := e.lookup(p, tok)
		if !ok {
			return tok
		}
		if f, isNum := v.(float64); isNum {
			return strconv.FormatFloat(f, 'f', -1, 64)
		}
		return fmt.Sprint(v)
	})
}

func (e Env) number(p Procedure, v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case string:
		if strings.HasPrefix(x, "$") || strings.Contains(x, ".") && !isNumeric(x) {
			r, ok := e.lookup(p, x)
			if !ok {
				return 0, false
			}
			return e.number(p, r)
		}
		f, err := strconv.ParseFloat(x, 64)
		return f, err == nil
	}
	return 0, false
}

func isNumeric(s string) bool { _, err := strconv.ParseFloat(s, 64); return err == nil }

// StepStatus is the server's verdict on one step.
type StepStatus struct {
	ID       string   `json:"id"`
	Complete bool     `json:"complete"`
	Errors   []string `json:"errors"`
}

// Validate checks every step; the run can be sealed when all are complete.
func (e Env) Validate(p Procedure) []StepStatus {
	out := make([]StepStatus, 0, len(p.Steps))
	for _, st := range p.Steps {
		ss := StepStatus{ID: st.ID, Errors: []string{}}
		for _, f := range st.Fields {
			if msg := e.checkField(p, st, f); msg != "" {
				ss.Errors = append(ss.Errors, msg)
			}
		}
		for _, r := range st.Rules {
			if ok, known := e.evalRule(p, r.Check); known && !ok {
				ss.Errors = append(ss.Errors, e.Text(p, r.Message))
			}
		}
		ss.Complete = len(ss.Errors) == 0
		out = append(out, ss)
	}
	return out
}

func (e Env) evalRule(p Procedure, check string) (ok, known bool) {
	m := reRule.FindStringSubmatch(check)
	if m == nil {
		return false, false
	}
	a, okA := e.number(p, m[1])
	b, okB := e.number(p, m[3])
	if !okA || !okB {
		return false, false // operand missing: the required-field checks report it
	}
	switch m[2] {
	case ">=":
		return a >= b, true
	case "<=":
		return a <= b, true
	case ">":
		return a > b, true
	case "<":
		return a < b, true
	case "==":
		return a == b, true
	case "!=":
		return a != b, true
	}
	return false, false
}

func (e Env) checkField(p Procedure, st Step, f Field) string {
	v, present := e.Data[st.ID][f.ID]
	present = present && v != nil
	missing := func() string {
		if f.Required {
			return f.Label + ": required"
		}
		return ""
	}
	switch f.Type {
	case "info":
		return ""
	case "ack":
		if b, _ := v.(bool); !b {
			return missing()
		}
	case "checklist":
		m, _ := v.(map[string]any)
		for _, it := range f.Items {
			if b, _ := m[it.ID].(bool); !b && f.Required {
				return f.Label + ": " + it.Label + " not confirmed"
			}
		}
	case "choice":
		s, _ := v.(string)
		if s == "" {
			return missing()
		}
		for _, o := range f.Options {
			if o.Value == s {
				if o.Blocks {
					return f.Label + ": \"" + o.Label + "\" blocks launch"
				}
				return ""
			}
		}
		return f.Label + ": not a valid option"
	case "text", "tel":
		s, _ := v.(string)
		if strings.TrimSpace(s) == "" {
			return missing()
		}
		if f.Pattern != "" && !regexp.MustCompile(f.Pattern).MatchString(s) {
			return f.Label + ": invalid format"
		}
	case "number":
		n, ok := e.number(p, v)
		if !present || !ok {
			return missing()
		}
		if lo, ok := e.number(p, f.Min); ok && n < lo {
			return fmt.Sprintf("%s: at least %g %s", f.Label, lo, f.Unit)
		}
		if hi, ok := e.number(p, f.Max); ok && n > hi {
			return fmt.Sprintf("%s: at most %g %s", f.Label, hi, f.Unit)
		}
	case "location":
		m, _ := v.(map[string]any)
		lat, okLat := m["lat"].(float64)
		lon, okLon := m["lon"].(float64)
		if !okLat || !okLon {
			return missing()
		}
		if f.WithinSite && e.Site.Lat != nil {
			d := haversineM(lat, lon, *e.Site.Lat, *e.Site.Lon)
			if d > e.Site.RadiusM {
				return fmt.Sprintf("%s: %.0f m from the site centre (limit %.0f m)", f.Label, d, e.Site.RadiusM)
			}
		}
	case "live_weather":
		if !present {
			return missing()
		}
		l, r := e.Live, e.Site.Rules
		switch {
		case l.WxAgeS < 0 || l.WxAgeS > 30:
			return "No current on-site weather (is the Presto/Enviro connected?)"
		case l.Wind != nil && *l.Wind >= r.WindLandMS:
			return fmt.Sprintf("Wind %.1f m/s is at or above this site's limit (%.0f)", *l.Wind, r.WindLandMS)
		case l.Gust != nil && *l.Gust >= r.GustLandMS:
			return fmt.Sprintf("Gust %.1f m/s is at or above this site's limit (%.0f)", *l.Gust, r.GustLandMS)
		}
	case "photo":
		ids, _ := v.([]any)
		lo, _ := e.number(p, f.Min)
		if len(ids) == 0 || float64(len(ids)) < lo {
			if len(ids) == 0 {
				return missing()
			}
			return fmt.Sprintf("%s: at least %g needed", f.Label, lo)
		}
		for _, id := range ids {
			if s, _ := id.(string); s == "" || !e.BlobExist(s) {
				return f.Label + ": a photo is missing on the device"
			}
		}
	case "crew":
		m, _ := v.(map[string]any)
		members, _ := m["members"].([]any)
		pic, _ := m["pic"].(string)
		if len(members) == 0 {
			return missing()
		}
		min, _ := e.number(p, f.Min)
		if float64(len(members)) < min {
			return fmt.Sprintf("Crew: at least %g people required at this site", min)
		}
		inCrew := false
		for _, id := range members {
			s, _ := id.(string)
			if _, ok := e.Bundle.Operator(s); !ok {
				return "Crew: unknown operator " + s
			}
			inCrew = inCrew || s == pic
		}
		if pic == "" || !inCrew {
			return "Crew: choose a pilot in command from the crew"
		}
		op, _ := e.Bundle.Operator(pic)
		if !op.Has("pic") {
			return "Crew: " + op.Name + " is not qualified as pilot in command"
		}
		if !op.CertValid(e.Live.Now) {
			return "Crew: " + op.Name + "'s PiC certificate has expired"
		}
	case "signature":
		m, _ := v.(map[string]any)
		id, _ := m["blob"].(string)
		if id == "" {
			return missing()
		}
		if !e.BlobExist(id) {
			return f.Label + ": signature image missing on the device"
		}
	}
	return ""
}

func haversineM(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371000.0
	rad := math.Pi / 180
	dlat, dlon := (lat2-lat1)*rad, (lon2-lon1)*rad
	a := math.Sin(dlat/2)*math.Sin(dlat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dlon/2)*math.Sin(dlon/2)
	return 2 * r * math.Asin(math.Sqrt(a))
}
