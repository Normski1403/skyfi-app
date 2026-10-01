package core

import (
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
