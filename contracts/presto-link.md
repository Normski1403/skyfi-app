# Presto ↔ Pi link — protocol v1

The single source of truth for messages between the **Presto panel**
(`zimchaa/skyfiscreen`) and the **ground-station server** (`server/` in this repo).
Any change here needs a matching change in the firmware, in the same push.

## Transport

- USB CDC serial (the Presto's `stdio_usb`), seen on the Pi as
  `/dev/serial/by-id/usb-Raspberry_Pi_Pico_*-if00`. Baud is ignored by CDC.
- **One JSON object per line**, `\n` terminated, UTF-8, **max 512 bytes** per line.
- Every message has a type field `"t"`. Unknown types and unknown fields are ignored
  (forward compatibility: add fields freely, never change the meaning of one).
- Any line **not starting with `{`** is a debug log. The server records it and does
  not treat it as protocol. Firmware `printf` debug output can stay as it is.
- The Presto's WiFi/REST client (`/api/v1/*`) remains as a **fallback link**.
  LAND works over whichever link is up.

## Presto → Pi

| `t` | When | Fields |
|---|---|---|
| `hello` | on boot and whenever the host (re)opens the port | `fw` (string), `proto` (int, = 1) |
| `wx` | each sensor read, ~1 Hz | any of: `wind` m/s, `gust` m/s, `dir` deg (−1 = unknown), `rain` mm, `rain_rate` mm/h, `temp` °C, `hum` %RH, `pres` hPa, `lux` |
| `land` | LAND NOW confirmed on the panel | `id` (string, unique per press), `reason` (optional) |
| `hb` | optional keepalive, if no other message for 2 s | — |

## Pi → Presto

| `t` | When | Fields |
|---|---|---|
| `status` | 1 Hz, and right after any state change | `sys` (`ok`\|`degraded`\|`fault`), `drone` (`grounded`\|`ascending`\|`airborne`\|`descending`), `batt` %, `alt` m, `tgt` target altitude m, `tether` kg, `power` (`tether`\|`battery`), `auto` (`armed`\|`off`), `ip`, `host`, `msg` (≤ 40 chars, the top alert or `""`) |
| `ack` | reply to `land` | `id` (echoed), `ok` (bool), `cmd` (server command id), `err` (if not ok) |
| `wifi` | after `hello` | `ssid`, `pw`, `qr` (WiFi-join QR payload) |

## Semantics

- **LAND is idempotent.** A `land` with an `id` the server has already seen is
  re-acked without issuing a second command. The panel may retry until acked.
- A panel `land` goes through **exactly the same command path** as the web
  app's LAND button and auto-land (`source` = `presto-usb`, `web`, `presto-wifi`
  or `auto`).
- **Link health.** The server treats the panel as offline if no line has arrived for
  5 s. The panel should treat the server as offline if no `status` has arrived for
  5 s, and show LINK LOST.
- **Legacy.** Until firmware speaks v1, the server also parses the debug lines
  `sensor_hub: wind <m/s> m/s (gust <m/s>) dir <deg> ... rain <mm>mm ...` and
  `sensor_hub: light <lux> lux` as weather.

## Example session

```
→ {"t":"hello","fw":"skyfiscreen 0.4.0","proto":1}
← {"t":"wifi","ssid":"SkyFi-Ground","pw":"skyfi-field-1234","qr":"WIFI:T:WPA;S:SkyFi-Ground;P:skyfi-field-1234;;"}
→ {"t":"wx","wind":4.1,"gust":6.3,"dir":225,"rain":0.0,"lux":812}
← {"t":"status","sys":"ok","drone":"airborne","batt":96,"alt":50.0,"tgt":50.0,"tether":12.1,"power":"tether","auto":"armed","ip":"192.168.1.145","host":"4our","msg":""}
→ {"t":"land","id":"p-17"}
← {"t":"ack","id":"p-17","ok":true,"cmd":"c-0042"}
```
