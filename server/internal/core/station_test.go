package core

import (
	"errors"
	"testing"
	"time"
)

func f(v float64) *float64 { return &v }

func flying(t *testing.T) *Station {
	s := NewStation()
	s.UpdateWeather(Weather{Wind: f(3), Gust: f(4)}, "test")
	s.PanelSeen("", 0, "x")
	s.Tick(time.Second)
	if err := s.Launch("test", 10); err != nil {
		t.Fatal(err)
	}
	for range 10 {
		s.Tick(time.Second)
	}
	if s.drone.State != Airborne {
		t.Fatalf("want airborne, got %s", s.drone.State)
	}
	return s
}

func TestLandIsIdempotentPerPanelID(t *testing.T) {
	s := flying(t)
	c1, ok, _ := s.Land("presto-usb", "", "p-1")
	c2, _, msg := s.Land("presto-usb", "", "p-1")
	if !ok || c1 != c2 || msg != "duplicate" || s.drone.State != Descending {
		t.Fatalf("c1=%s c2=%s msg=%s state=%s", c1, c2, msg, s.drone.State)
	}
}

func TestGustAutoLands(t *testing.T) {
	s := flying(t)
	s.UpdateWeather(Weather{Gust: f(16)}, "test")
	s.Tick(time.Second)
	if s.drone.State != Descending {
		t.Fatalf("gust should auto-land, state=%s", s.drone.State)
	}
}

func TestSustainedWindNeedsDuration(t *testing.T) {
	s := flying(t)
	s.UpdateWeather(Weather{Wind: f(11)}, "test")
	s.Tick(time.Second)
	if s.drone.State != Airborne {
		t.Fatal("landed on the first high-wind sample")
	}
	s.windHighSince = time.Now().Add(-11 * time.Second)
	s.Tick(time.Second)
	if s.drone.State != Descending {
		t.Fatalf("sustained wind should auto-land, state=%s", s.drone.State)
	}
}

func TestAutoLandDisarmed(t *testing.T) {
	s := flying(t)
	s.SetAutoLand("test", false)
	s.UpdateWeather(Weather{Gust: f(20)}, "test")
	s.Tick(time.Second)
	if s.drone.State != Airborne || s.Snapshot().Sys != LevelFault {
		t.Fatalf("disarmed: state=%s sys=%s", s.drone.State, s.Snapshot().Sys)
	}
}

func TestLaunchBlockedInFault(t *testing.T) {
	s := NewStation()
	s.UpdateWeather(Weather{Gust: f(20)}, "test")
	s.Tick(time.Second)
	if err := s.Launch("test", 0); err == nil {
		t.Fatal("launch allowed during gust fault")
	}
}

func TestHistorySampling(t *testing.T) {
	s := NewStation()
	s.UpdateWeather(Weather{Wind: f(3)}, "test")
	s.Tick(time.Second) // first sample is immediate
	s.Tick(time.Second) // within the interval: no new sample
	h := s.History(0)
	if len(h) != 1 || *h[0].V["wind"] != 3 || h[0].V["batt"] == nil {
		t.Fatalf("history %+v", h)
	}
	s.hist.next = time.Now().Add(-time.Second)
	s.Tick(time.Second)
	if got := s.History(h[0].Seq); len(got) != 1 {
		t.Fatalf("since filter: %d samples", len(got))
	}
}

func TestLastLandRecorded(t *testing.T) {
	s := flying(t)
	s.Land("web", "operator", "")
	ll := s.Snapshot().Land
	if ll == nil || ll.Seq != 1 || ll.Source != "web" || ll.Result != "landing" {
		t.Fatalf("last land %+v", ll)
	}
	s.Land("auto", "gust", "")
	if ll := s.Snapshot().Land; ll.Seq != 2 || ll.Result != "already landing" {
		t.Fatalf("second land %+v", ll)
	}
}

func TestLaunchGate(t *testing.T) {
	s := NewStation()
	s.UpdateWeather(Weather{Wind: f(2)}, "test")
	s.Tick(time.Second)
	s.SetGate(func(float64) (GateResult, error) { return GateResult{}, errors.New("no pre-flight") }, nil)
	if err := s.Launch("web", 0); err == nil {
		t.Fatal("launched without clearance")
	}
	s.SetGate(func(float64) (GateResult, error) {
		return GateResult{Mode: "cleared", Site: "bench", By: "P1", Alt: 40, WindLand: 8, GustLand: 12}, nil
	}, func() (any, string) { return "detail", "CLEARED" })
	if err := s.Launch("web", 0); err != nil {
		t.Fatal(err)
	}
	snap := s.Snapshot()
	if snap.Drone.TargetAlt != 40 || snap.Policy.WindLand != 8 || snap.Policy.GustLand != 12 || snap.ClearanceText != "CLEARED" {
		t.Fatalf("gate not applied: alt=%v policy=%+v clr=%q", snap.Drone.TargetAlt, snap.Policy, snap.ClearanceText)
	}
}
