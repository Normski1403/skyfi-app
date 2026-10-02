// skyfid is the Sky-Fi ground-station daemon: it serves the web app, bridges
// the Presto panel over USB serial, simulates the drone and runs auto-land.
package main

import (
	"context"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/zimchaa/skyfi-app/server/config"
	"github.com/zimchaa/skyfi-app/server/internal/api"
	"github.com/zimchaa/skyfi-app/server/internal/core"
	"github.com/zimchaa/skyfi-app/server/internal/preflight"
	"github.com/zimchaa/skyfi-app/server/internal/presto"
	"github.com/zimchaa/skyfi-app/server/web"
)

func main() {
	listen := flag.String("listen", ":8000", "comma-separated listen addresses (e.g. :80,:8000)")
	serial := flag.String("serial", "/dev/serial/by-id/usb-Raspberry_Pi_Pico_*-if00", "Presto serial device glob")
	ssid := flag.String("wifi-ssid", "SkyFi-Ground", "field WiFi SSID shown as the panel's join QR")
	pw := flag.String("wifi-password", "skyfi-field-1234", "field WiFi password")
	debug := flag.Bool("debug-panel", false, "log the panel's raw debug lines")
	stateDir := flag.String("state-dir", "/var/lib/skyfi", "database, device key, photos; a config/ bundle here overrides the built-in one")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	st := core.NewStation()
	wifi := presto.WiFiInfo{SSID: *ssid, Password: *pw}
	pf := setupPreflight(st, *stateDir)

	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				st.Tick(time.Second)
			}
		}
	}()

	go (&presto.Link{Glob: *serial, Station: st, WiFi: wifi, Debug: *debug}).Run(ctx)

	h := (&api.Server{Station: st, Static: web.FS(), WiFi: wifi, PF: pf}).Handler()
	for _, addr := range strings.Split(*listen, ",") {
		srv := &http.Server{Addr: strings.TrimSpace(addr), Handler: h, ReadHeaderTimeout: 5 * time.Second}
		go func() {
			log.Printf("http: listening on %s", srv.Addr)
			if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Fatalf("http %s: %v", srv.Addr, err)
			}
		}()
		go func() { <-ctx.Done(); srv.Close() }()
	}
	<-ctx.Done()
	log.Print("shutting down")
}

// setupPreflight loads the configuration bundle (state-dir/config if present,
// else the built-in one), opens the store and installs the launch gate.
// Without a usable store the station runs ungated, loudly.
func setupPreflight(st *core.Station, stateDir string) *preflight.Service {
	var cfg fs.FS = config.Defaults()
	src := "built-in"
	if d := filepath.Join(stateDir, "config"); dirExists(d) {
		cfg, src = os.DirFS(d), d
	}
	bundle, err := preflight.LoadBundle(cfg)
	if err != nil && src != "built-in" {
		log.Printf("preflight: config %s rejected (%v), using built-in", src, err)
		bundle, err, src = mustBuiltin()
	}
	if err != nil {
		log.Printf("preflight: DISABLED, no valid config: %v", err)
		return nil
	}
	store, err := preflight.OpenStore(stateDir)
	if err != nil {
		log.Printf("preflight: DISABLED, store %s: %v", stateDir, err)
		st.Note("info", "server", "Pre-flight DISABLED: cannot open "+stateDir)
		return nil
	}
	live := func() preflight.Live {
		s := st.Snapshot()
		return preflight.Live{Wind: s.Weather.Wind, Gust: s.Weather.Gust, WxAgeS: s.WxAge, Now: time.Now()}
	}
	svc := preflight.NewService(bundle, store, live)
	st.SetGate(func(alt float64) (core.GateResult, error) {
		c, a, err := svc.CheckLaunch(alt)
		return core.GateResult{Mode: c.State, Site: c.SiteName, By: c.By, Alt: a,
			WindLand: c.WindLandMS, GustLand: c.GustLandMS}, err
	}, func() (any, string) {
		c := svc.Current()
		switch c.State {
		case "cleared":
			return c, "CLEARED until " + c.ExpiresAt.Local().Format("15:04")
		case "override":
			return c, "OVERRIDE until " + c.ExpiresAt.Local().Format("15:04")
		}
		return c, "NO PRE-FLIGHT"
	})
	log.Printf("preflight: %d sites, %d procedures, %d operators (config: %s, state: %s)",
		len(bundle.Sites), len(bundle.Procedures), len(bundle.Operators), src, stateDir)
	return svc
}

func mustBuiltin() (*preflight.Bundle, error, string) {
	b, err := preflight.LoadBundle(config.Defaults())
	if err != nil {
		err = fmt.Errorf("built-in config: %w", err)
	}
	return b, err, "built-in"
}

func dirExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
}
