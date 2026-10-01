# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Sky-Fi Virtual Mast Wizard — a mobile-first web app that guides an operator through a safety and regulatory pre-flight checklist before deploying a tethered comms drone (4G/WiFi payload) into a disaster zone. The UX prototype was built with Claude Design and exported as a handoff bundle; the task is to productionise it as a real deployable app.

The prototype files live in `project/` and `Sky-Fi Virtual Mast Wizard.html`. The chat transcripts in `chats/` record the original design intent. `DEPLOYMENT-ARCHITECTURE.md` is the authoritative plan for the production system.

## Target architecture

The device that runs this is a **Raspberry Pi acting as a WiFi access point** at a field site with no internet. The operator's phone connects to the Pi's SSID and opens the wizard in a browser — fully offline, no cloud dependency at runtime.

```
operator's phone/tablet  →  Raspberry Pi (WiFi AP)  →  drone autopilot (MAVLink/tether)
                                    ↕ opportunistic sync
                              ops centre (cloud)
```

The Pi serves:
- A built static SPA (`dist/`) embedded in a Go binary
- A small local API (sessions, sealing, packages, sync queue)
- SQLite in WAL mode for crash-safe persistence

The ops centre (cloud) handles:
- Briefing bundle generation (Python — rich geo/aviation data ecosystem)
- 7-year audit log store
- Fleet dashboard, OTA ruleset updates

## Phased build plan

**Phase 0 (current):** Productionise the frontend — Vite + TypeScript build, vendor React locally (no CDN), PWA + service worker, IndexedDB autosave + session resume, real signature capture, typed schema + client-side validation. Output: `dist/` serveable directly from a Pi.

**Phase 1:** Go single-binary device server — embeds `dist/`, exposes REST API, SQLite persistence, real Ed25519 cryptographic sealing, captive portal, offline map tiles (PMTiles + MapLibre GL JS).

**Phase 2:** Cloud briefing-bundle pipeline (Python), signed bundle verification on device, durable outbound sync queue, Litestream WAL backup.

**Phase 3:** MAVLink drone integration (geofence, handoff, live telemetry), hardware key (ATECC608B/TPM), mTLS, LUKS disk encryption.

**Phase 4:** Fleet ops-centre dashboard, RAUC/Mender OTA, per-mission step config delivered via signed briefing bundles.

## Prototype structure (`project/src/`)

The prototype is plain JSX executed by `@babel/standalone` in the browser — no build step. The source files are:

- `wizard-app.jsx` — `App` shell, `ALL_STEPS` array, `STEP_VALIDATORS` map, `LaunchHandoff` component
- `wizard-steps-input.jsx` — field-input steps (Location, Photo, Hazards, Crew, Contact, Parameters, Signature, Risk)
- `wizard-steps-review.jsx` — pre-filled/auto-populated review steps (Weather, Airspace, Regulatory)
- `wizard-components.jsx` — shared primitives (Card, Callout, DataRow, StatusPill, etc.)
- `wizard.css` — CSS custom properties + all layout/component styles (design tokens via `--vf-*` and `--sf-*` variables)
- `wizard-print.jsx` / `wizard-print.css` — print view

### Key data model

`ALL_STEPS` is a data-driven array — this is the seam for per-mission step configuration via briefing bundles. Each step has: `id`, `short` (rail label), `title`, `type` (`input` | `review-auto` | `review-mix` | `review-prefilled`), `Comp` (component getter), `canSkipPrefill`.

`STEP_VALIDATORS` maps step id → `(stepData) => boolean`. These validators must be shared with the backend (Go) in the production build — single source of truth for safety-critical form completion.

Per-step state lives in `allData[stepId]` keyed by step id. `__prefilled: true` flags data that arrived from a briefing bundle and needs operator review/acknowledgment rather than fresh entry.

### Design tokens

`design-tokens.css` and `--vf-*` CSS variables encode the Vodafone brand palette. The `data-theme` attribute on the root switches light/dark. Do not hardcode colours; use the token variables.

## Ground-station server (`server/`)

`skyfid` (Go) runs on the Pi at `4our.local` as systemd unit `skyfid`. Deploy with `deploy/deploy.sh` (cross-compiles on the laptop; Go lives in `~/.local/go`). **No Node on the Pi**: the web app in `server/web/static` is plain HTML/CSS/JS, embedded in the binary. The Presto panel protocol is `contracts/presto-link.md`; change it together with `../skyfiscreen` in the same push. All LAND requests (web, panel, auto) go through `core.Station.Land`.

## Development environment

Node.js is managed via **nvm** — use `nvm install` / `nvm use` inside `app/` to activate Node 22 LTS (pinned in `app/.nvmrc`). This applies on both the development laptop and the Raspberry Pi. Do not assume a system Node install exists.

The Pi target is ARM64 (Raspberry Pi 4/CM4 or Pi 5). Cross-compilation targets for the Go device binary: `GOOS=linux GOARCH=arm64`.

## What NOT to do

- Do not serve from a CDN in production — there is no internet at the field site. All dependencies must be vendored/bundled.
- Do not use SSR — the Pi serves a static SPA; the phone renders it. Keep the device server thin.
- Do not use nginx on the Pi — the Go binary's own `net/http` (or Caddy if mTLS is needed) is the right choice for a constrained field device.
- Do not trust client-only validation for safety-critical fields — the sealed package must be validated server-side against the shared schema.
