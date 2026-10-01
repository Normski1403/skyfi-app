# Sky-Fi Virtual Mast Wizard

A mobile-first pre-flight wizard that guides an operator through safety and regulatory checks before deploying a tethered comms drone (4G/WiFi payload) into a disaster zone. Designed to run fully offline on a Raspberry Pi acting as a field WiFi access point, with the operator's phone or tablet as the display device.

## Origin

The UX was designed using [Claude Design](https://claude.ai/design) and exported as a prototype handoff. The original prototype files live in `prototype/` alongside the Claude Design chat transcripts in `chats/`. These are the design reference — the production app is built in `app/`.

## Field topology

```
operator's phone/tablet
        │ WiFi (joins Pi's own SSID)
        ▼
Raspberry Pi (ground station)
  • WiFi access point (hostapd)
  • Captive portal → wizard opens automatically
  • Serves static SPA + local REST API
  • SQLite persistence (crash-safe, offline)
  • Cryptographic sealing of flight packages
        │ tether data line        │ opportunistic bearer
        ▼                         ▼
drone autopilot (MAVLink)    ops centre (cloud)
                              briefing bundles ↓ / packages + logs ↑
```

The device serves; the phone renders. The Pi has near-zero compute load from the frontend.

## Ground-station server (running now)

`server/` is the Go daemon that runs on the Pi (`4our.local`). It serves a live ground-station
web app, talks to the Presto panel over USB, simulates the drone and auto-lands in bad weather.
See [`server/README.md`](server/README.md) and the panel protocol in
[`contracts/presto-link.md`](contracts/presto-link.md). Deploy with `deploy/deploy.sh`.

## Prerequisites

Node.js is managed via [nvm](https://github.com/nvm-sh/nvm) — this works the same on a laptop and on a Raspberry Pi (ARM64).

```bash
# Install nvm (if not already installed)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# Restart your shell, then install and use the pinned version
cd app
nvm install   # reads .nvmrc → installs Node 22 LTS
nvm use       # activates it for this shell session
```

To activate automatically when entering the `app/` directory, add this to your `~/.bashrc` or `~/.zshrc`:

```bash
# Auto-switch Node version when entering a directory with .nvmrc
cdnvm() { cd "$@" && [ -f .nvmrc ] && nvm use; }
alias cd=cdnvm
```

## Running the prototype

The prototype requires no build step — open the standalone bundle directly:

```bash
# In a browser
open prototype/Sky-Fi\ Virtual\ Mast\ Wizard.standalone.html

# Or serve the prototype source over HTTP (required for some browser APIs)
cd prototype
python3 -m http.server 8080
# then open http://localhost:8080/Sky-Fi%20Virtual%20Mast%20Wizard.html
```

To serve from a Raspberry Pi on its local network:

```bash
python3 -m http.server 8080 --bind 0.0.0.0
# operator opens http://<pi-ip>:8080/ from their phone
```

## Running the production app (Phase 0+)

```bash
cd app
npm install
npm run dev          # development server with HMR
npm run build        # production build → app/dist/
npm run preview      # preview the production build locally
```

The `app/dist/` output is a fully static bundle — copy it to any web server or embed it in the Go device binary.

## Architecture decisions

See [`DEPLOYMENT-ARCHITECTURE.md`](DEPLOYMENT-ARCHITECTURE.md) for the full rationale. Key decisions:

| Concern | Choice | Why |
|---|---|---|
| Frontend build | Vite + React + TypeScript | Replaces in-browser Babel transpile; produces vendored static bundle |
| Device server | Go single binary | Embeds `dist/`, tiny RAM footprint, single static binary cross-compiles to ARM |
| Persistence | SQLite (WAL mode) | Embedded, crash-safe, zero-overhead on a Pi |
| Crypto sealing | Ed25519 (Go stdlib / Rust crate) | Operator + device counter-signature on the sealed flight package |
| Offline maps | PMTiles + MapLibre GL JS | Single-file tile archive, no tile server process |
| Cloud pipeline | Python | Rich aviation/geo data ecosystem for briefing-bundle generation |
| Sync | Durable outbound queue (SQLite) + Litestream | Never blocks the wizard; streams WAL to object storage opportunistically |

## Roadmap

| Phase | Scope |
|---|---|
| **0** | Vite + TS build, vendor React, PWA + service worker, IndexedDB autosave, real signature capture, typed schema |
| **1** | Go device server: embedded SPA, REST API, SQLite, crypto sealing, captive portal, offline map tiles |
| **2** | Cloud briefing-bundle pipeline (Python); signed bundle install on device; opportunistic sync queue |
| **3** | MAVLink drone integration (geofence, handoff, live telemetry); hardware keys; mTLS; LUKS |
| **4** | Ops-centre fleet dashboard; 7-year audit store; RAUC/Mender OTA; per-mission step config |

## Repository layout

```
server/       Go ground-station daemon (skyfid) + embedded web app
contracts/    Presto <-> Pi serial protocol (shared with zimchaa/skyfiscreen)
deploy/       systemd unit + deploy script for the Pi
app/          Production app (Vite + React + TypeScript) — Phase 0+
prototype/    Claude Design prototype (read-only reference)
  src/          Wizard JSX source components
  assets/       SVG logos and marks
  fonts/        Vodafone brand fonts
  chats/ *      Design chat transcripts (* kept at repo root)
chats/        Claude Design conversation transcripts (design intent)
DEPLOYMENT-ARCHITECTURE.md  Full deployment design and rationale
CLAUDE.md     Guidance for Claude Code
```
