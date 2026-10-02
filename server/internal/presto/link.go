// Package presto bridges the Presto panel's USB serial link to the station,
// speaking contracts/presto-link.md (newline-delimited JSON, protocol v1).
package presto

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/unix"

	"github.com/zimchaa/skyfi-app/server/internal/core"
)

const maxLine = 512

type WiFiInfo struct{ SSID, Password string }

type Link struct {
	Glob    string // e.g. /dev/serial/by-id/usb-Raspberry_Pi_Pico_*-if00
	Station *core.Station
	WiFi    WiFiInfo
	Debug   bool // log raw panel debug lines

	notPanel map[string]bool // devices identified as something else (e.g. the Enviro hub)
}

var errNotPanel = errors.New("not the panel")

// Run keeps (re)opening the panel's serial port until ctx is cancelled.
func (l *Link) Run(ctx context.Context) {
	for ctx.Err() == nil {
		dev := l.find()
		if dev == "" {
			sleep(ctx, time.Second)
			continue
		}
		err := l.session(ctx, dev)
		if errors.Is(err, errNotPanel) {
			log.Printf("presto: %s is not the panel, skipping it", dev)
			l.notPanel[dev] = true
			continue
		}
		l.Station.PanelDisconnected(err)
		log.Printf("presto: %s closed: %v", dev, err)
		sleep(ctx, time.Second)
	}
}

// find returns the first matching device not known to be something else.
// Other Picos (the Enviro hub, when plugged in for flashing) match the same
// glob; they're identified by their first line and skipped until replugged.
func (l *Link) find() string {
	if l.notPanel == nil {
		l.notPanel = map[string]bool{}
	}
	m, _ := filepath.Glob(l.Glob)
	for dev := range l.notPanel {
		if _, err := os.Stat(dev); err != nil {
			delete(l.notPanel, dev) // unplugged: re-identify next time
		}
	}
	for _, dev := range m {
		if !l.notPanel[dev] {
			return dev
		}
	}
	return ""
}

func (l *Link) session(ctx context.Context, dev string) error {
	f, err := openRaw(dev)
	if err != nil {
		return err
	}
	defer f.Close()
	log.Printf("presto: opened %s, identifying", dev)

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var wmu sync.Mutex
	// Firmware that doesn't read stdin (pre-v1) lets the CDC buffers fill;
	// a write deadline turns that into dropped messages, not a stuck link.
	send := func(v any) error {
		b, _ := json.Marshal(v)
		wmu.Lock()
		defer wmu.Unlock()
		_ = f.SetWriteDeadline(time.Now().Add(500 * time.Millisecond))
		_, err := f.Write(append(b, '\n'))
		if errors.Is(err, os.ErrDeadlineExceeded) {
			return nil
		}
		return err
	}

	// Writer: status at 1 Hz and on every change (coalesced to ≤ 5 Hz).
	startWriter := func() {
		changes, unsub := l.Station.Subscribe()
		defer unsub()
		tick := time.NewTicker(time.Second)
		defer tick.Stop()
		_ = l.sendWiFi(send)
		// LANDs issued elsewhere (web, auto) are announced so the panel alerts
		// too; start from the current one so nothing old is replayed.
		var landSent int64
		if ll := l.Station.Snapshot().Land; ll != nil {
			landSent = ll.Seq
		}
		for {
			snap := l.Station.Snapshot()
			if ll := snap.Land; ll != nil && ll.Seq > landSent {
				landSent = ll.Seq
				if ll.Source != "presto-usb" {
					_ = send(map[string]any{"t": "landing", "src": ll.Source, "cmd": ll.Cmd, "result": ll.Result})
				}
			}
			if err := send(statusMsg(snap)); err != nil {
				cancel()
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
			case <-changes:
				sleep(ctx, 200*time.Millisecond)
			}
		}
	}

	// Reader: closing the file unblocks Scan when ctx ends.
	go func() { <-ctx.Done(); f.Close() }()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 4096), 4096)
	identified := false
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !identified && line != "" {
			if strings.HasPrefix(line, "enviro-hub") {
				return errNotPanel
			}
			identified = true
			l.Station.PanelConnected(dev)
			go startWriter()
		}
		l.handle(line, send)
	}
	if err := sc.Err(); err != nil {
		return err
	}
	return fmt.Errorf("eof")
}

func (l *Link) sendWiFi(send func(any) error) error {
	if l.WiFi.SSID == "" {
		return nil
	}
	return send(map[string]any{
		"t": "wifi", "ssid": l.WiFi.SSID, "pw": l.WiFi.Password,
		"qr": fmt.Sprintf("WIFI:T:WPA;S:%s;P:%s;;", l.WiFi.SSID, l.WiFi.Password),
	})
}

type inMsg struct {
	T      string `json:"t"`
	FW     string `json:"fw"`
	Proto  int    `json:"proto"`
	ID     string `json:"id"`
	Reason string `json:"reason"`
	core.Weather
}

func (l *Link) handle(line string, send func(any) error) {
	if line == "" {
		return
	}
	if line[0] != '{' {
		// Debug log; legacy firmware's sensor lines double as weather.
		l.Station.PanelSeen("", 0, line)
		if l.Debug {
			log.Printf("presto| %s", line)
		}
		if w, ok := parseLegacy(line); ok {
			l.Station.UpdateWeather(w, "presto-legacy")
		}
		return
	}
	if len(line) > maxLine {
		log.Printf("presto: dropping %d-byte line", len(line))
		return
	}
	var m inMsg
	if err := json.Unmarshal([]byte(line), &m); err != nil {
		log.Printf("presto: bad json %q: %v", line, err)
		return
	}
	l.Station.PanelSeen(m.FW, m.Proto*boolInt(m.T == "hello"), "")
	switch m.T {
	case "hello":
		_ = l.sendWiFi(send)
	case "wx":
		l.Station.UpdateWeather(m.Weather, "presto-usb")
	case "land":
		if m.ID == "" {
			_ = send(map[string]any{"t": "ack", "ok": false, "err": "id required"})
			return
		}
		reason := m.Reason
		if reason == "" {
			reason = "panel LAND NOW"
		}
		cmd, ok, _ := l.Station.Land("presto-usb", reason, m.ID)
		_ = send(map[string]any{"t": "ack", "id": m.ID, "ok": ok, "cmd": cmd})
	}
}

func statusMsg(s core.Snapshot) map[string]any {
	msg := ""
	if len(s.Alerts) > 0 {
		msg = s.Alerts[0].Msg
		if len(msg) > 40 {
			msg = msg[:40]
		}
	}
	ip := ""
	if len(s.IPs) > 0 {
		ip = s.IPs[0]
	}
	auto := "off"
	if s.Policy.AutoLand {
		auto = "armed"
	}
	r1 := func(v float64) float64 { return float64(int(v*10+0.5)) / 10 }
	return map[string]any{
		"t": "status", "sys": s.Sys, "drone": s.Drone.State,
		"batt": int(s.Drone.Batt + 0.5), "alt": r1(s.Drone.Alt), "tgt": r1(s.Drone.TargetAlt), "tether": r1(s.Drone.Tether),
		"power": s.Drone.Power, "auto": auto, "ip": ip, "host": s.Host, "msg": msg,
	}
}

// openRaw opens a tty in raw mode (no echo, no line discipline translation).
func openRaw(dev string) (*os.File, error) {
	f, err := os.OpenFile(dev, os.O_RDWR|unix.O_NOCTTY, 0)
	if err != nil {
		return nil, err
	}
	t, err := unix.IoctlGetTermios(int(f.Fd()), unix.TCGETS)
	if err != nil {
		f.Close()
		return nil, err
	}
	t.Iflag &^= unix.IGNBRK | unix.BRKINT | unix.PARMRK | unix.ISTRIP | unix.INLCR | unix.IGNCR | unix.ICRNL | unix.IXON
	t.Oflag &^= unix.OPOST
	t.Lflag &^= unix.ECHO | unix.ECHONL | unix.ICANON | unix.ISIG | unix.IEXTEN
	t.Cflag &^= unix.CSIZE | unix.PARENB
	t.Cflag |= unix.CS8 | unix.CREAD | unix.CLOCAL
	t.Cc[unix.VMIN], t.Cc[unix.VTIME] = 1, 0
	if err := unix.IoctlSetTermios(int(f.Fd()), unix.TCSETS, t); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func sleep(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
