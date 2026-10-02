# skyfid — Sky-Fi ground-station server

One Go binary (~6 MB, ~9 MB RAM on a Pi 400). No Node, Python or web server on the Pi.

- Serves the mobile-responsive **ground-station web app** (`web/static`, embedded, no build step).
- Bridges the **Presto panel** over USB serial: [`contracts/presto-link.md`](../contracts/presto-link.md).
- **Simulates the drone** (state machine, altitude, battery, tether tension and power) until the MAVLink link exists.
- One **LAND** path for the web button, the panel (USB or WiFi) and **auto-land** (sustained wind, gusts, low battery).

## Pre-flight (configuration-driven)

Launch is gated on a **sealed pre-flight** for the site (or a logged emergency override).

- `config/`: the configuration bundle, embedded as the default. `/var/lib/skyfi/config/` on the Pi
  overrides it (the cloud admin interface will publish this, issue #1):
  - `sites.json`: location/geofence and **rules** (ceiling, wind/gust land limits, min crew,
    validity, override policy)
  - `procedures/*.json`: steps and fields as data. Field types: `info ack checklist choice text
    tel number location live_weather photo crew signature`. Choice options can `blocks` launch or
    lower the ceiling (`max_alt_m`). Step `rules` compare operands, e.g.
    `parameters.tether >= parameters.altitude`, `parameters.altitude <= $limits.max_alt_m`. Text
    can use `$site.…` / `$limits.…` tokens
  - `operators.json`: roles (`pic`, `observer`), certificate and expiry
- The server validates every save against the config (`internal/preflight`), so the rules exist
  in one place. Completing a run seals the canonical record (SHA-256, signed with the device
  Ed25519 key in `/var/lib/skyfi/device.key`) into SQLite with `sync_status=pending` (cloud sync,
  issue #2).
- While cleared, launches fly the pre-flight's altitude (capped by the site/hazard ceiling) and
  the site's wind/gust limits become the auto-land thresholds.
- Emergency override: a PiC with a valid certificate gives a reason. It is sealed, logged and
  flagged for review, and valid for `override_validity_h`.

| Method | Path | |
|---|---|---|
| GET | `/api/v1/preflight/config` | sites (with procedure titles) and operators |
| GET | `/api/v1/preflight/clearance` | `cleared` / `override` / `none` + details |
| GET / POST | `/api/v1/preflights` | recent runs / start one `{"site_id"}` |
| GET | `/api/v1/preflights/{id}` | run + resolved procedure + per-step verdicts |
| PUT | `/api/v1/preflights/{id}/steps/{step}` | save a step's answers, returns verdicts |
| POST | `/api/v1/preflights/{id}/complete` | validate and seal |
| POST | `/api/v1/preflights/{id}/void` | discard a draft / revoke a clearance |
| GET | `/api/v1/preflights/{id}/record` | the signed record (JSON) |
| POST | `/api/v1/override` | `{"site_id","operator_id","reason"}` |
| POST / GET | `/api/v1/blobs[/{id}]` | photo / signature upload (images, ≤ 8 MB) |

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
