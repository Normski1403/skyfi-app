package core

import (
	"fmt"
	"time"
)

// Policy holds the weather / safety thresholds that drive alerts and auto-land.
type Policy struct {
	AutoLand   bool          `json:"auto_land"`
	WindWarn   float64       `json:"wind_warn"`   // m/s sustained
	WindLand   float64       `json:"wind_land"`   // m/s sustained for SustainFor
	GustWarn   float64       `json:"gust_warn"`   // m/s
	GustLand   float64       `json:"gust_land"`   // m/s, immediate
	BattWarn   float64       `json:"batt_warn"`   // %
	BattLand   float64       `json:"batt_land"`   // %
	SustainFor time.Duration `json:"-"`
	WxStale    time.Duration `json:"-"`
}

func defaultPolicy() Policy {
	return Policy{
		AutoLand: true,
		WindWarn: 7, WindLand: 10,
		GustWarn: 11, GustLand: 15,
		BattWarn: 40, BattLand: 20,
		SustainFor: 10 * time.Second,
		WxStale:    30 * time.Second,
	}
}

// Alert levels double as the overall system state (contract: status.sys).
const (
	LevelOK       = "ok"
	LevelDegraded = "degraded"
	LevelFault    = "fault"
)

type Alert struct {
	Level string `json:"level"` // degraded | fault
	Code  string `json:"code"`
	Msg   string `json:"msg"`
}

// evaluate returns the current alerts and, if a landing is warranted, the reason.
// windHighSince tracks how long sustained wind has been over WindLand.
func (p Policy) evaluate(now time.Time, d Drone, w Weather, panelAlive bool, windHighSince *time.Time) (alerts []Alert, landReason string) {
	add := func(level, code, format string, a ...any) {
		alerts = append(alerts, Alert{level, code, fmt.Sprintf(format, a...)})
	}

	wxFresh := !w.Updated.IsZero() && now.Sub(w.Updated) < p.WxStale
	switch {
	case w.Updated.IsZero():
		add(LevelDegraded, "wx_none", "No weather data yet")
	case !wxFresh:
		add(LevelDegraded, "wx_stale", "Weather stale (%ds)", int(now.Sub(w.Updated).Seconds()))
	}
	if !panelAlive {
		add(LevelDegraded, "panel_offline", "Presto panel offline")
	}

	if wxFresh && w.Wind != nil {
		wind := *w.Wind
		if wind >= p.WindLand {
			if windHighSince.IsZero() {
				*windHighSince = now
			}
			held := now.Sub(*windHighSince)
			add(LevelFault, "wind_high", "Wind %.1f m/s ≥ %.0f for %ds", wind, p.WindLand, int(held.Seconds()))
			if held >= p.SustainFor {
				landReason = fmt.Sprintf("sustained wind %.1f m/s", wind)
			}
		} else {
			*windHighSince = time.Time{}
			if wind >= p.WindWarn {
				add(LevelDegraded, "wind_warn", "Wind %.1f m/s", wind)
			}
		}
	} else {
		*windHighSince = time.Time{}
	}
	if wxFresh && w.Gust != nil {
		if g := *w.Gust; g >= p.GustLand {
			add(LevelFault, "gust_high", "Gust %.1f m/s ≥ %.0f", g, p.GustLand)
			landReason = fmt.Sprintf("gust %.1f m/s", g)
		} else if g >= p.GustWarn {
			add(LevelDegraded, "gust_warn", "Gust %.1f m/s", g)
		}
	}

	if d.Power == "battery" {
		add(LevelDegraded, "on_battery", "Tether power lost, on battery")
	}
	if d.State != Grounded {
		if d.Batt <= p.BattLand {
			add(LevelFault, "batt_low", "Battery %.0f%%", d.Batt)
			landReason = fmt.Sprintf("battery %.0f%%", d.Batt)
		} else if d.Batt <= p.BattWarn {
			add(LevelDegraded, "batt_warn", "Battery %.0f%%", d.Batt)
		}
	}
	return alerts, landReason
}

func worst(alerts []Alert) string {
	sys := LevelOK
	for _, a := range alerts {
		if a.Level == LevelFault {
			return LevelFault
		}
		sys = LevelDegraded
	}
	return sys
}
