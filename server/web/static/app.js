// Sky-Fi ground-station web app: renders /api/v1/stream snapshots, sends commands.
'use strict';
const $ = (id) => document.getElementById(id);
const SEV = { ok: 'ok', degraded: 'warn', fault: 'danger' };
let state = null;

async function post(path, body) {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok || j.ok === false || j.accepted === false) alert(j.error || 'Request failed');
    return j;
  } catch (e) { alert('Server unreachable: ' + e.message); }
}

// ── live stream ──────────────────────────────────────────────────────
function connect() {
  const es = new EventSource('api/v1/stream');
  es.onmessage = (e) => { state = JSON.parse(e.data); render(state); setLive(true); };
  es.onerror = () => { setLive(false); };   // EventSource retries by itself
}
function setLive(on) {
  $('live').textContent = on ? 'live' : 'offline';
  $('live').dataset.sev = on ? 'ok' : 'danger';
}
// Mark the link down if snapshots stop (they arrive at least 1 Hz).
let lastMsg = 0;
setInterval(() => { if (Date.now() - lastMsg > 4000) setLive(false); }, 1000);

// ── render ───────────────────────────────────────────────────────────
const fmt = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));
const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  return s < 60 ? `${Math.round(s)}s ago` : `${Math.round(s / 60)}m ago`;
};
const compass = (d) => d == null ? '—' : ['N','NE','E','SE','S','SW','W','NW'][Math.round(d / 45) % 8] + ` ${Math.round(d)}°`;

function render(s) {
  lastMsg = Date.now();
  const p = s.policy, d = s.drone, w = s.weather;

  $('hostline').textContent = `${s.host} · ${s.ips.join(', ') || 'no network'} · up ${Math.floor(s.uptime_s / 60)}m`;
  $('banner').dataset.sev = SEV[s.sys];
  $('sys').textContent = s.sys === 'ok' ? 'System OK' : s.sys;
  $('topAlert').textContent = s.alerts[0] ? s.alerts[0].msg : '';

  $('droneState').textContent = d.state;
  $('droneState').dataset.s = d.state;
  $('alt').textContent = fmt(d.alt);
  $('target').textContent = `target ${fmt(d.target_alt, 0)} m`;
  $('battTxt').textContent = `${Math.round(d.batt)}%`;
  $('battBar').style.width = `${d.batt}%`;
  $('battBar').style.background = d.batt <= p.batt_land ? 'var(--danger)' : d.batt <= p.batt_warn ? 'var(--warn)' : 'var(--ok)';
  $('tether').textContent = d.tether ? `${fmt(d.tether)} kg` : '—';
  $('power').textContent = d.power === 'battery' ? 'BATTERY (tether power lost)' : 'Tether';
  $('launchBtn').disabled = d.state !== 'grounded';
  $('landBtn').disabled = d.state === 'grounded';

  // Weather tiles (only fields the panel actually reports)
  const lvl = (v, warn, land) => v == null ? '' : v >= land ? 'danger' : v >= warn ? 'warn' : 'ok';
  const tiles = [
    ['Wind', fmt(w.wind), 'm/s', lvl(w.wind, p.wind_warn, p.wind_land)],
    ['Gust', fmt(w.gust), 'm/s', lvl(w.gust, p.gust_warn, p.gust_land)],
    ['Direction', compass(w.dir), '', ''],
    ['Rain', fmt(w.rain), 'mm', ''],
    w.rain_rate != null && ['Rain rate', fmt(w.rain_rate), 'mm/h', ''],
    w.temp != null && ['Temp', fmt(w.temp), '°C', ''],
    w.hum != null && ['Humidity', fmt(w.hum, 0), '%', ''],
    w.pres != null && ['Pressure', fmt(w.pres, 0), 'hPa', ''],
    w.lux != null && ['Light', fmt(w.lux, 0), 'lux', ''],
  ].filter(Boolean);
  $('wxTiles').replaceChildren(...tiles.map(([k, v, u, sev]) => {
    const el = document.createElement('div');
    el.className = 'tile'; el.dataset.sev = sev;
    el.innerHTML = `<div class="label"></div><span class="v"></span> <span class="u"></span>`;
    el.children[0].textContent = k; el.children[1].textContent = v; el.children[2].textContent = u;
    return el;
  }));
  $('wxSrc').textContent = s.weather_age_s < 0 ? 'no data yet'
    : `${w.source} · ${s.weather_age_s < 2 ? 'now' : Math.round(s.weather_age_s) + 's ago'}`;

  $('autoToggle').checked = p.auto_land;
  $('autoTxt').textContent = p.auto_land
    ? `Armed: lands on wind ≥ ${p.wind_land} m/s for 10s, gust ≥ ${p.gust_land} m/s, or battery ≤ ${p.batt_land}%.`
    : 'DISARMED. Weather and battery will only raise alerts.';
  $('alerts').replaceChildren(...s.alerts.map((a) => {
    const li = document.createElement('li'); li.dataset.l = a.level; li.textContent = a.msg; return li;
  }));

  const pn = s.panel;
  $('panelPill').textContent = !pn.connected ? 'disconnected' : pn.alive ? 'online' : 'silent';
  $('panelPill').dataset.sev = !pn.connected ? 'danger' : pn.alive ? 'ok' : 'warn';
  $('fw').textContent = pn.fw || (pn.connected ? 'pre-v1 (debug lines)' : '—');
  $('proto').textContent = pn.proto ? `v${pn.proto}` : pn.connected ? 'legacy' : '—';
  $('device').textContent = pn.device || '—';
  $('lastLog').textContent = pn.last_log || '';

  $('events').replaceChildren(...s.events.map((e) => {
    const li = document.createElement('li'); li.dataset.k = e.kind;
    li.innerHTML = '<time></time><span class="src"></span><span class="msg"></span>';
    li.children[0].textContent = new Date(e.time).toLocaleTimeString();
    li.children[1].textContent = e.source;
    li.children[2].textContent = e.msg;
    return li;
  }));
}

// ── controls ─────────────────────────────────────────────────────────
$('launchBtn').onclick = () => post('api/v1/launch', {});
$('autoToggle').onchange = (e) => {
  if (!e.target.checked && !confirm('Disarm auto-land? The drone will stay up in bad weather.')) {
    e.target.checked = true; return;
  }
  post('api/v1/autoland', { enabled: e.target.checked });
};
document.querySelectorAll('[data-sim]').forEach((b) => {
  b.onclick = () => post('api/v1/sim', JSON.parse(b.dataset.sim));
});

// Hold-to-confirm LAND, matching the panel's hold-to-confirm button.
(() => {
  const btn = $('landBtn'), HOLD_MS = 1200;
  let timer = null;
  const start = (e) => {
    if (btn.disabled) return;
    e.preventDefault();
    btn.classList.add('holding');
    timer = setTimeout(() => {
      timer = null;
      btn.classList.remove('holding');
      if (navigator.vibrate) navigator.vibrate(80);
      post('api/v1/land', { confirm: true, source: 'web', reason: 'operator LAND (web)' });
    }, HOLD_MS);
  };
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; btn.classList.remove('holding'); };
  btn.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, cancel));
  btn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !timer) start(e); });
  btn.addEventListener('keyup', cancel);
})();

connect();
