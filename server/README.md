# skyfid — Sky-Fi ground-station server

One Go binary (~6 MB, ~9 MB RAM on a Pi 400). No Node, Python or web server on the Pi.

- Serves the mobile-responsive **ground-station web app** (`web/static`, embedded, no build step).
- Bridges the **Presto panel** over USB serial: [`contracts/presto-link.md`](../contracts/presto-link.md).
- **Simulates the drone** (state machine, altitude, battery, tether tension and power) until the MAVLink link exists.
- One **LAND** path for the web button, the panel (USB or WiFi) and **auto-land** (sustained wind, gusts, low battery).

## Develop / deploy

```bash
deploy/deploy.sh            # test, cross-compile linux/arm64, install + restart on 4our.local
cd server && go test ./...  # unit tests
go run ./cmd/skyfid -listen :8000 -debug-panel   # run locally (panel optional)
```

Go is installed per-user on the dev laptop (`~/.local/go`). The Pi only receives the binary
(`/opt/skyfi/skyfid`, systemd unit `skyfid`). Logs: `ssh 4our.local journalctl -fu skyfid`.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/v1/state` | full snapshot (drone, weather, alerts, panel, policy, events) |
| GET | `/api/v1/stream` | Server-Sent Events: a snapshot on every change, ≥ 1 Hz |
| POST | `/api/v1/land` | `{"confirm":true,"reason":"..."}` |
| POST | `/api/v1/launch` | `{"alt":50}`; refused while any fault alert is active |
| POST | `/api/v1/autoland` | `{"enabled":true}` |
| POST | `/api/v1/sim` | `{"power_fault":true}` · `{"weather":{"wind":12,"gust":16},"for_s":60}` · `{"weather":null}` |
| GET | `/api/v1/status`, `/environment`, `/wifi` | Presto WiFi fallback (same contract as `skyfiscreen/mock-server`) |

Listens on `:80` (phones) and `:8000` (the firmware's default `SKYFI_API_PORT`).
