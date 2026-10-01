package presto

import "testing"

func TestParseLegacy(t *testing.T) {
	w, ok := parseLegacy("sensor_hub: wind 3.4 m/s (gust 5.6) dir 225 raw 4036 rain 1.2mm st 0x04")
	if !ok || *w.Wind != 3.4 || *w.Gust != 5.6 || *w.Dir != 225 || *w.Rain != 1.2 {
		t.Fatalf("wind line: %+v ok=%v", w, ok)
	}
	w, _ = parseLegacy("sensor_hub: wind 0.0 m/s (gust 0.0) dir -1 raw 4036 rain 0.0mm st 0x04")
	if w.Dir != nil {
		t.Fatalf("dir -1 should be unknown, got %v", *w.Dir)
	}
	w, ok = parseLegacy("sensor_hub: light 9.3 lux")
	if !ok || *w.Lux != 9.3 || w.Wind != nil {
		t.Fatalf("light line: %+v", w)
	}
	if _, ok := parseLegacy("net: wifi up"); ok {
		t.Fatal("non-sensor line parsed")
	}
}
