package core

import "time"

// History keeps the last hour of key metrics, sampled every HistoryInterval,
// for sparklines and trend charts (web app; the panel keeps its own).
const (
	HistoryInterval = 5 * time.Second
	historyLen      = 720 // 1 h
)

// Metric keys, shared with the web app.
var HistoryMetrics = []string{"wind", "gust", "rain", "temp", "hum", "pres", "lux", "batt", "tether", "alt"}

type Sample struct {
	Seq int64               `json:"seq"`
	T   time.Time           `json:"t"`
	V   map[string]*float64 `json:"v"` // nil/absent = no data
}

type history struct {
	seq     int64
	next    time.Time
	samples []Sample
}

// sampleLocked records one sample if the interval has elapsed.
func (s *Station) sampleLocked(now time.Time, wx Weather, wxFresh bool) {
	h := &s.hist
	if now.Before(h.next) {
		return
	}
	h.next = now.Add(HistoryInterval)
	f := func(v float64) *float64 { return &v }
	v := map[string]*float64{
		"batt":   f(s.drone.Batt),
		"tether": f(s.drone.Tether),
		"alt":    f(s.drone.Alt),
	}
	if wxFresh {
		v["wind"], v["gust"], v["temp"], v["hum"], v["pres"], v["lux"] =
			wx.Wind, wx.Gust, wx.Temp, wx.Hum, wx.Pres, wx.Lux
		v["rain"] = wx.RainRate
	}
	h.seq++
	h.samples = append(h.samples, Sample{Seq: h.seq, T: now, V: v})
	if len(h.samples) > historyLen {
		h.samples = h.samples[len(h.samples)-historyLen:]
	}
}

// History returns samples newer than since (0 = everything kept).
func (s *Station) History(since int64) []Sample {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Sample{}
	for _, smp := range s.hist.samples {
		if smp.Seq > since {
			out = append(out, smp)
		}
	}
	return out
}
