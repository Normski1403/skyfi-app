// Package preflight runs configuration-driven pre-flight procedures: sites,
// procedures and operators are data (server/config, later installed from the
// cloud admin interface), the Pi validates answers server-side against that
// data, seals completed pre-flights, and gates launch on a valid one.
package preflight

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"sort"
	"time"
)

// Rules are a site's operating limits.
type Rules struct {
	MaxAltM           float64 `json:"max_alt_m"`
	WindLandMS        float64 `json:"wind_land_ms"`
	GustLandMS        float64 `json:"gust_land_ms"`
	MinCrew           int     `json:"min_crew"`
	ValidityH         float64 `json:"validity_h"`
	AllowOverride     bool    `json:"allow_override"`
	OverrideValidityH float64 `json:"override_validity_h"`
	RequireCloudSync  bool    `json:"require_cloud_sync"`
}

type Contact struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

type Site struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Procedure   string   `json:"procedure"`
	Lat         *float64 `json:"lat,omitempty"`
	Lon         *float64 `json:"lon,omitempty"`
	RadiusM     float64  `json:"radius_m,omitempty"`
	Rules       Rules    `json:"rules"`
	Contact     Contact  `json:"contact"`
	Regulatory  string   `json:"regulatory,omitempty"`
}

type Operator struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Roles       []string `json:"roles"`
	Cert        string   `json:"cert,omitempty"`
	CertExpires string   `json:"cert_expires,omitempty"` // YYYY-MM-DD
}

func (o Operator) Has(role string) bool {
	for _, r := range o.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// CertValid reports whether the operator holds an unexpired certificate.
func (o Operator) CertValid(now time.Time) bool {
	if o.Cert == "" || o.CertExpires == "" {
		return false
	}
	exp, err := time.Parse("2006-01-02", o.CertExpires)
	return err == nil && !now.After(exp.Add(24*time.Hour))
}

type Option struct {
	Value   string   `json:"value"`
	Label   string   `json:"label"`
	Blocks  bool     `json:"blocks,omitempty"`    // selecting it fails the step
	MaxAltM *float64 `json:"max_alt_m,omitempty"` // selecting it lowers the ceiling
}

type Item struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// Field types: info, ack, checklist, choice, text, tel, number, location,
// live_weather, photo, crew, signature.
type Field struct {
	ID         string   `json:"id"`
	Type       string   `json:"type"`
	Label      string   `json:"label"`
	Help       string   `json:"help,omitempty"`
	Text       string   `json:"text,omitempty"` // info
	Required   bool     `json:"required,omitempty"`
	Options    []Option `json:"options,omitempty"`
	Items      []Item   `json:"items,omitempty"`
	Pattern    string   `json:"pattern,omitempty"`
	Unit       string   `json:"unit,omitempty"`
	Min        any      `json:"min,omitempty"` // number, or "$site.rules.min_crew"
	Max        any      `json:"max,omitempty"`
	Step       float64  `json:"step,omitempty"`
	Default    any      `json:"default,omitempty"` // literal or "$site...."
	WithinSite bool     `json:"within_site,omitempty"`
}

type Rule struct {
	Check   string `json:"check"`   // "<operand> <op> <operand>"
	Message string `json:"message"` // may contain $tokens
}

type Intro struct {
	Tone string `json:"tone"` // info | warn | ok
	Text string `json:"text"`
}

type Step struct {
	ID     string  `json:"id"`
	Short  string  `json:"short"`
	Title  string  `json:"title"`
	Kind   string  `json:"kind"` // input | review | auto
	Intro  *Intro  `json:"intro,omitempty"`
	Fields []Field `json:"fields"`
	Rules  []Rule  `json:"rules,omitempty"`
}

type Procedure struct {
	ID          string `json:"id"`
	Version     string `json:"version"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Steps       []Step `json:"steps"`
}

// Bundle is a complete, cross-checked configuration.
type Bundle struct {
	Sites      []Site
	Operators  []Operator
	Procedures map[string]Procedure
}

func (b *Bundle) Site(id string) (Site, bool) {
	for _, s := range b.Sites {
		if s.ID == id {
			return s, true
		}
	}
	return Site{}, false
}

func (b *Bundle) Operator(id string) (Operator, bool) {
	for _, o := range b.Operators {
		if o.ID == id {
			return o, true
		}
	}
	return Operator{}, false
}

var knownTypes = map[string]bool{
	"info": true, "ack": true, "checklist": true, "choice": true, "text": true, "tel": true,
	"number": true, "location": true, "live_weather": true, "photo": true, "crew": true, "signature": true,
}

var reRule = regexp.MustCompile(`^\s*(\S+)\s*(>=|<=|==|!=|>|<)\s*(\S+)\s*$`)

// LoadBundle reads sites.json, operators.json and procedures/*.json and
// checks they're consistent, so a bad bundle is rejected as a whole.
func LoadBundle(fsys fs.FS) (*Bundle, error) {
	var sites struct {
		Sites []Site `json:"sites"`
	}
	var ops struct {
		Operators []Operator `json:"operators"`
	}
	if err := readJSON(fsys, "sites.json", &sites); err != nil {
		return nil, err
	}
	if err := readJSON(fsys, "operators.json", &ops); err != nil {
		return nil, err
	}
	b := &Bundle{Sites: sites.Sites, Operators: ops.Operators, Procedures: map[string]Procedure{}}

	files, err := fs.Glob(fsys, "procedures/*.json")
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	for _, f := range files {
		var p Procedure
		if err := readJSON(fsys, f, &p); err != nil {
			return nil, err
		}
		if err := checkProcedure(p); err != nil {
			return nil, fmt.Errorf("%s: %w", f, err)
		}
		b.Procedures[p.ID] = p
	}

	seen := map[string]bool{}
	for _, s := range b.Sites {
		if s.ID == "" || seen[s.ID] {
			return nil, fmt.Errorf("sites.json: missing or duplicate site id %q", s.ID)
		}
		seen[s.ID] = true
		if _, ok := b.Procedures[s.Procedure]; !ok {
			return nil, fmt.Errorf("site %s: unknown procedure %q", s.ID, s.Procedure)
		}
		if (s.Lat == nil) != (s.Lon == nil) || (s.Lat != nil && s.RadiusM <= 0) {
			return nil, fmt.Errorf("site %s: lat, lon and radius_m go together", s.ID)
		}
		if s.Rules.ValidityH <= 0 || s.Rules.MaxAltM <= 0 {
			return nil, fmt.Errorf("site %s: rules.validity_h and rules.max_alt_m are required", s.ID)
		}
	}
	return b, nil
}

func checkProcedure(p Procedure) error {
	if p.ID == "" || p.Version == "" || len(p.Steps) == 0 {
		return fmt.Errorf("procedure needs id, version and steps")
	}
	ids := map[string]bool{}
	for _, st := range p.Steps {
		if st.ID == "" || ids[st.ID] {
			return fmt.Errorf("missing or duplicate step id %q", st.ID)
		}
		ids[st.ID] = true
		fids := map[string]bool{}
		for _, f := range st.Fields {
			if !knownTypes[f.Type] {
				return fmt.Errorf("step %s field %s: unknown type %q", st.ID, f.ID, f.Type)
			}
			if f.ID == "" || fids[f.ID] {
				return fmt.Errorf("step %s: missing or duplicate field id %q", st.ID, f.ID)
			}
			fids[f.ID] = true
			if f.Pattern != "" {
				if _, err := regexp.Compile(f.Pattern); err != nil {
					return fmt.Errorf("step %s field %s: bad pattern: %w", st.ID, f.ID, err)
				}
			}
		}
		for _, r := range st.Rules {
			if !reRule.MatchString(r.Check) {
				return fmt.Errorf("step %s: bad rule %q", st.ID, r.Check)
			}
		}
	}
	return nil
}

func readJSON(fsys fs.FS, name string, v any) error {
	b, err := fs.ReadFile(fsys, path.Clean(name))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	return nil
}
