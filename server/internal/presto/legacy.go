package presto

import (
	"math"
	"regexp"
	"strconv"

	"github.com/zimchaa/skyfi-app/server/internal/core"
)

// Pre-protocol firmware only prints debug lines such as
//
//	sensor_hub: wind 0.0 m/s (gust 0.0) dir -1 raw 4036 rain 0.0mm st 0x04
//	sensor_hub: light 9.3 lux
//
// Parsing them gets real weather to the server before the firmware speaks v1.
var (
	reWind  = regexp.MustCompile(`wind\s+(-?[\d.]+)\s*m/s\s*\(gust\s+(-?[\d.]+)\)(?:\s*dir\s+(-?[\d.]+))?`)
	reRain  = regexp.MustCompile(`rain\s+(-?[\d.]+)\s*mm`)
	reLight = regexp.MustCompile(`light\s+(-?[\d.]+)\s*lux`)
	reTemp  = regexp.MustCompile(`temp\s+(-?[\d.]+)`)
	reHum   = regexp.MustCompile(`hum(?:idity)?\s+(-?[\d.]+)`)
	rePres  = regexp.MustCompile(`pres(?:sure)?\s+(-?[\d.]+)`)
)

func parseLegacy(line string) (core.Weather, bool) {
	const prefix = "sensor_hub:"
	if len(line) < len(prefix) || line[:len(prefix)] != prefix {
		return core.Weather{}, false
	}
	var w core.Weather
	found := false
	num := func(s string) *float64 {
		v, err := strconv.ParseFloat(s, 64)
		if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
			return nil
		}
		found = true
		return &v
	}
	if m := reWind.FindStringSubmatch(line); m != nil {
		w.Wind, w.Gust = num(m[1]), num(m[2])
		if m[3] != "" && m[3] != "-1" {
			w.Dir = num(m[3])
		}
	}
	for _, f := range []struct {
		re  *regexp.Regexp
		dst **float64
	}{{reRain, &w.Rain}, {reLight, &w.Lux}, {reTemp, &w.Temp}, {reHum, &w.Hum}, {rePres, &w.Pres}} {
		if m := f.re.FindStringSubmatch(line); m != nil {
			*f.dst = num(m[1])
		}
	}
	return w, found
}
