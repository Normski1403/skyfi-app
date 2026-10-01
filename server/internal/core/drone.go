package core

import "math/rand/v2"

// Drone states, as reported to the web app and the Presto (contract: status.drone).
const (
	Grounded   = "grounded"
	Ascending  = "ascending"
	Airborne   = "airborne"
	Descending = "descending"
)

// Drone is a simulated tethered drone. It stands in for the MAVLink autopilot
// (Phase 3) behind the same inputs (Launch/Land) and outputs (telemetry).
//
// A tethered drone is normally powered up the tether; the battery is a backup.
// The simulated tether-power fault switches it onto battery so drain and the
// low-battery auto-land path can be exercised.
type Drone struct {
	State      string  `json:"state"`
	Alt        float64 `json:"alt"`        // m
	TargetAlt  float64 `json:"target_alt"` // m
	Batt       float64 `json:"batt"`       // %
	Tether     float64 `json:"tether"`     // tension, kg
	Power      string  `json:"power"`      // "tether" | "battery"
	PowerFault bool    `json:"power_fault"`
}

const (
	climbRate   = 2.0 // m/s
	descentRate = 1.5 // m/s
	chargeRate  = 0.2 // %/s on tether / ground power
	drainRate   = 0.5 // %/s on battery (fast, so the demo shows it)
)

func newDrone() Drone {
	return Drone{State: Grounded, TargetAlt: 50, Batt: 100, Power: "tether"}
}

func (d *Drone) flying() bool { return d.State == Ascending || d.State == Airborne }

// step advances the simulation by dt seconds under the given wind (m/s).
func (d *Drone) step(dt, wind float64) {
	switch d.State {
	case Ascending:
		d.Alt += climbRate * dt
		if d.Alt >= d.TargetAlt {
			d.Alt, d.State = d.TargetAlt, Airborne
		}
	case Airborne:
		// station-keeping wobble that grows with wind
		d.Alt = d.TargetAlt + (rand.Float64()-0.5)*(0.2+wind*0.08)
	case Descending:
		d.Alt -= descentRate * dt
		if d.Alt <= 0 {
			d.Alt, d.State = 0, Grounded
		}
	}

	if d.State != Grounded && d.PowerFault {
		d.Power = "battery"
		d.Batt -= drainRate * dt
	} else {
		d.Power = "tether"
		d.Batt += chargeRate * dt
	}
	d.Batt = min(100, max(0, d.Batt))

	if d.Alt > 0.1 {
		d.Tether = 2 + d.Alt*0.15 + wind*wind*0.08 + (rand.Float64()-0.5)*0.4
	} else {
		d.Tether = 0
	}
}
