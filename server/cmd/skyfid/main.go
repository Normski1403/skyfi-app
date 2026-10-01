// skyfid is the Sky-Fi ground-station daemon: it serves the web app, bridges
// the Presto panel over USB serial, simulates the drone and runs auto-land.
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/zimchaa/skyfi-app/server/internal/api"
	"github.com/zimchaa/skyfi-app/server/internal/core"
	"github.com/zimchaa/skyfi-app/server/internal/presto"
	"github.com/zimchaa/skyfi-app/server/web"
)

func main() {
	listen := flag.String("listen", ":8000", "comma-separated listen addresses (e.g. :80,:8000)")
	serial := flag.String("serial", "/dev/serial/by-id/usb-Raspberry_Pi_Pico_*-if00", "Presto serial device glob")
	ssid := flag.String("wifi-ssid", "SkyFi-Ground", "field WiFi SSID shown as the panel's join QR")
	pw := flag.String("wifi-password", "skyfi-field-1234", "field WiFi password")
	debug := flag.Bool("debug-panel", false, "log the panel's raw debug lines")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	st := core.NewStation()
	wifi := presto.WiFiInfo{SSID: *ssid, Password: *pw}

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

	h := (&api.Server{Station: st, Static: web.FS(), WiFi: wifi}).Handler()
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
