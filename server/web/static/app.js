// Sky-Fi ground-station web app. Mirrors the Presto panel: same tiles, tabs,
// trends and LAND. Live state from /api/v1/stream, history from /api/v1/history.
'use strict';
const $ = (id) => document.getElementById(id);
const SEV = { ok: 'ok', degraded: 'warn', fault: 'danger' };

// Same metrics, order and formats as the panel (skyfiscreen/ui/ui_panel.cpp).
// tile: shown on DASH; span: smallest y range drawn, so noise stays flat.
const METRICS = [
  { k: 'wind',   name: 'WIND',     unit: 'm/s',  dp: 1, span: 2,  group: 'weather', tile: true },
  { k: 'gust',   name: 'GUST',     unit: 'm/s',  dp: 1, span: 2,  group: 'weather', tile: true },
  { k: 'rain',   name: 'RAIN',     unit: 'mm/h', dp: 1, span: 1,  group: 'weather', tile: true },
  { k: 'temp',   name: 'TEMP',     unit: '°C',   dp: 1, span: 2,  group: 'weather', tile: true },
  { k: 'hum',    name: 'HUMIDITY', unit: '%',    dp: 0, span: 5,  group: 'weather', tile: true },
  { k: 'pres',   name: 'PRESSURE', unit: 'hPa',  dp: 0, span: 2,  group: 'weather', tile: true },
  { k: 'lux',    name: 'LIGHT',    unit: 'lux',  dp: 0, span: 10, group: 'weather', tile: true },
  { k: 'batt',   name: 'BATTERY',  unit: '%',    dp: 0, span: 10, group: 'drone',   tile: true },
  { k: 'tether', name: 'TETHER',   unit: 'kg',   dp: 1, span: 2,  group: 'drone',   tile: true },
  { k: 'alt',    name: 'ALTITUDE', unit: 'm',    dp: 0, span: 10, group: 'drone',   tile: false },
];
const SPARK_N = 60, HIST_N = 720;   // 5 min / 1 h at 5 s

let state = null;
const hist = Object.fromEntries(METRICS.map((m) => [m.k, []]));
let lastSeq = 0;

async function post(path, body) {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok || j.ok === false || j.accepted === false) alert(j.error || 'Request failed');
    return j;
  } catch (e) { alert('Server unreachable: ' + e.message); }
}

const fmt = (m, v) => (v == null ? '--' : `${Number(v).toFixed(m.dp)} ${m.unit}`);

// Live value + severity for a metric, from a snapshot.
function current(s, m) {
  const p = s.policy, d = s.drone, w = s.weather, fresh = s.weather_age_s >= 0 && s.weather_age_s < 30;
  const lvl = (v, warn, bad) => (v == null ? '' : v >= bad ? 'danger' : v >= warn ? 'warn' : 'ok');
  switch (m.k) {
    case 'wind':   return [fresh ? w.wind : null, lvl(w.wind, p.wind_warn, p.wind_land)];
    case 'gust':   return [fresh ? w.gust : null, lvl(w.gust, p.gust_warn, p.gust_land)];
    case 'rain':   return [fresh ? w.rain_rate : null, lvl(w.rain_rate, 4, 10)];
    case 'temp':   return [fresh ? w.temp : null, 'ok'];
    case 'hum':    return [fresh ? w.hum : null, 'ok'];
    case 'pres':   return [fresh ? w.pres : null, 'ok'];
    case 'lux':    return [fresh ? w.lux : null, 'ok'];
    case 'batt':   return [d.batt, d.batt <= p.batt_land ? 'danger' : d.batt <= p.batt_warn ? 'warn' : 'ok'];
    case 'tether': return [d.tether, lvl(d.tether, 16, 20)];
    case 'alt':    return [d.alt, 'ok'];
  }
}

// ── SVG line charts (gaps where there's no data) ─────────────────────
function scale(vals, span) {
  const xs = vals.filter((v) => v != null);
  if (!xs.length) return null;
  let lo = Math.min(...xs), hi = Math.max(...xs);
  if (hi - lo < span) { const mid = (lo + hi) / 2; lo = mid - span / 2; hi = lo + span; }
  const pad = (hi - lo) * 0.1;
  return { lo, hi, plo: lo - pad, phi: hi + pad };
}
function linePath(vals, n, w, h, sc) {
  let d = '', pen = false;
  const off = n - vals.length;   // right-align: newest sample at the right edge
  vals.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    const x = ((off + i) / (n - 1)) * w;
    const y = h - ((v - sc.plo) / (sc.phi - sc.plo)) * h;
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  });
  return d;
}

// ── DASH ─────────────────────────────────────────────────────────────
const tiles = {};
for (const m of METRICS.filter((m) => m.tile)) {
  const el = document.createElement('button');
  el.className = 'tile';
  el.innerHTML = `<div class="name"></div><div class="val">--</div>
    <svg viewBox="0 0 100 28" preserveAspectRatio="none"><path class="spark"/></svg>`;
  el.querySelector('.name').textContent = m.name;
  el.onclick = () => { selectMetric(m.k); showTab('trends'); };   // tap a tile -> its trend
  $('tiles').append(el);
  tiles[m.k] = el;
}
function renderTiles() {
  for (const m of METRICS.filter((m) => m.tile)) {
    const [v, sev] = current(state, m);
    const el = tiles[m.k];
    el.querySelector('.val').textContent = fmt(m, v);
    el.dataset.sev = v == null ? '' : sev;
  }
}
function renderSparks() {
  for (const m of METRICS.filter((m) => m.tile)) {
    const vals = hist[m.k].slice(-SPARK_N), sc = scale(vals, m.span);
    tiles[m.k].querySelector('path').setAttribute('d', sc ? linePath(vals, SPARK_N, 100, 28, sc) : '');
  }
}

// ── TRENDS: metric list with live values (same layout as the panel) ──
let trendMetric = 'wind';

function buildPicker() {
  $('picker').replaceChildren(...METRICS.map((m) => {
    const b = document.createElement('button');
    b.dataset.k = m.k;
    b.innerHTML = '<span class="n"></span><span class="val"></span>';
    b.querySelector('.n').textContent = m.name;
    b.onclick = () => selectMetric(m.k);
    return b;
  }));
  markPicker();
}
function markPicker() {
  document.querySelectorAll('#picker [data-k]').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.k === trendMetric);
    if (state) b.querySelector('.val').textContent = fmt(METRICS.find((x) => x.k === b.dataset.k), current(state, METRICS.find((x) => x.k === b.dataset.k))[0]);
  });
}
function selectMetric(k) {
  trendMetric = k;
  markPicker();
  renderTrend();
}
function renderTrend() {
  const m = METRICS.find((x) => x.k === trendMetric);
  const vals = hist[m.k].slice(-HIST_N), sc = scale(vals, m.span);
  $('trendName').textContent = m.name;
  $('trendNow').textContent = state ? fmt(m, current(state, m)[0]) : '';
  const W = 600, H = 220;
  let svg = '';
  for (let i = 1; i < 4; i++) svg += `<line class="grid-line" x1="0" x2="${W}" y1="${(H * i) / 4}" y2="${(H * i) / 4}"/>`;
  for (let i = 1; i < 6; i++) svg += `<line class="grid-line" y1="0" y2="${H}" x1="${(W * i) / 6}" x2="${(W * i) / 6}"/>`;
  if (sc) {
    const d = linePath(vals, HIST_N, W, H, sc);
    svg += `<path class="trend-line" d="${d}"/>`;
    $('trendMax').textContent = `max ${fmt(m, sc.hi)}`;
    $('trendMin').textContent = `min ${fmt(m, sc.lo)}`;
  } else {
    $('trendMax').textContent = '';
    $('trendMin').textContent = 'no data yet';
  }
  $('trendChart').innerHTML = svg;
}

// ── STATION ──────────────────────────────────────────────────────────
function ring(id, frac, color) {
  const el = $(id);
  el.style.strokeDashoffset = 314.16 * (1 - Math.max(0, Math.min(1, frac)));
  el.style.stroke = color;
}
function renderStation() {
  const s = state, p = s.policy, d = s.drone;
  $('droneState').textContent = d.state;
  $('droneState').dataset.s = d.state;
  $('topAlert').textContent = s.alerts[0] ? s.alerts[0].msg : 'No alerts';
  $('autoChip').textContent = p.auto_land ? 'AUTO-LAND ARMED' : 'AUTO-LAND OFF';
  $('autoChip').toggleAttribute('data-on', p.auto_land);
  $('autoChip').toggleAttribute('data-off', !p.auto_land);

  const top = Math.max(d.target_alt * 1.25, 10);
  $('alt').textContent = d.alt.toFixed(0);
  $('altFill').style.height = `${Math.min(100, (d.alt / top) * 100)}%`;
  $('altTarget').style.bottom = `${(d.target_alt / top) * 100}%`;
  $('altTgt').textContent = `target ${d.target_alt.toFixed(0)} m`;

  const bc = d.batt <= p.batt_land ? 'var(--danger)' : d.batt <= p.batt_warn ? 'var(--warn)' : 'var(--ok)';
  $('batt').textContent = Math.round(d.batt);
  ring('battArc', d.batt / 100, bc);
  $('power').textContent = d.power === 'battery' ? 'ON BATTERY' : 'tether power';
  const tc = d.tether >= 20 ? 'var(--danger)' : d.tether >= 16 ? 'var(--warn)' : 'var(--aqua)';
  $('tether').textContent = d.tether ? d.tether.toFixed(1) : '0';
  ring('tetherArc', d.tether / 25, tc);

  $('launchBtn').disabled = d.state !== 'grounded';
  $('autoToggle').checked = p.auto_land;
  $('autoTxt').textContent = p.auto_land
    ? `Lands on wind ≥ ${p.wind_land} m/s for 10 s, gust ≥ ${p.gust_land} m/s, or battery ≤ ${p.batt_land}%.`
    : 'DISARMED: weather and battery only raise alerts.';
  $('alerts').replaceChildren(...s.alerts.map((a) => {
    const li = document.createElement('li'); li.dataset.l = a.level; li.textContent = a.msg; return li;
  }));

  const pn = s.panel;
  $('host').textContent = s.host;
  $('ips').textContent = s.ips.join(', ') || 'no network';
  $('uptime').textContent = `${Math.floor(s.uptime_s / 3600)}h ${Math.floor(s.uptime_s / 60) % 60}m`;
  $('panelState').textContent = !pn.connected ? 'disconnected' : pn.alive ? 'online (USB)' : 'silent';
  $('fw').textContent = pn.fw ? `${pn.fw} · proto v${pn.proto}` : '—';
  $('wxSrc').textContent = s.weather_age_s < 0 ? 'no data' : `${s.weather.source} · ${Math.round(s.weather_age_s)}s`;
  $('lastLog').textContent = pn.last_log || '';
}

// ── LOG ──────────────────────────────────────────────────────────────
function renderEvents() {
  $('events').replaceChildren(...state.events.map((e) => {
    const li = document.createElement('li'); li.dataset.k = e.kind;
    li.innerHTML = '<time></time><span class="src"></span><span class="msg"></span>';
    li.children[0].textContent = new Date(e.time).toLocaleTimeString();
    li.children[1].textContent = e.source;
    li.children[2].textContent = e.msg;
    return li;
  }));
}

// ── header + render loop ─────────────────────────────────────────────
function render() {
  const s = state;
  $('hostline').textContent = `${s.host} · ${s.ips[0] || 'no network'}`;
  const landing = s.drone.state === 'descending';
  $('pill').textContent = landing ? 'LANDING' : s.sys === 'ok' ? 'SYSTEM OK' : s.sys === 'degraded' ? 'DEGRADED' : 'FAULT';
  $('pill').dataset.sev = landing ? 'danger' : SEV[s.sys];
  $('panelLink').toggleAttribute('data-on', s.panel.alive);
  renderTiles(); renderStation(); renderEvents(); markPicker();
  $('trendNow').textContent = fmt(METRICS.find((x) => x.k === trendMetric), current(s, METRICS.find((x) => x.k === trendMetric))[0]);
}

let lastMsg = 0;
function connect() {
  const es = new EventSource('api/v1/stream');
  es.onmessage = (e) => { state = JSON.parse(e.data); lastMsg = Date.now(); render(); };
}
setInterval(() => {
  if (Date.now() - lastMsg > 4000) { $('pill').textContent = 'OFFLINE'; $('pill').dataset.sev = 'danger'; $('panelLink').removeAttribute('data-on'); }
}, 1000);

async function pullHistory() {
  try {
    const j = await (await fetch(`api/v1/history?since=${lastSeq}`)).json();
    for (const smp of j.samples) {
      for (const m of METRICS) {
        const a = hist[m.k];
        a.push(smp.v[m.k] ?? null);
        if (a.length > HIST_N) a.shift();
      }
      lastSeq = smp.seq;
    }
    if (j.samples.length) { renderSparks(); renderTrend(); }
  } catch {}
}

// ── tabs ─────────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== `tab-${name}`; });
  try { localStorage.setItem('tab', name); } catch {}
  if (name === 'trends') renderTrend();
}
document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

// ── controls ─────────────────────────────────────────────────────────
$('launchBtn').onclick = () => post('api/v1/launch', {});
$('autoToggle').onchange = (e) => {
  if (!e.target.checked && !confirm('Disarm auto-land? The drone will stay up in bad weather.')) {
    e.target.checked = true; return;
  }
  post('api/v1/autoland', { enabled: e.target.checked });
};
document.querySelectorAll('[data-sim]').forEach((b) => { b.onclick = () => post('api/v1/sim', JSON.parse(b.dataset.sim)); });

// Hold-to-confirm LAND, same 1.5 s hold as the panel.
(() => {
  const btn = $('landBtn'), txt = btn.querySelector('.txt'), HOLD_MS = 1500;
  let timer = null;
  const reset = (label = 'SAFETY LAND NOW') => { btn.classList.remove('holding'); txt.textContent = label; };
  const start = (e) => {
    if (btn.disabled || timer) return;
    e.preventDefault();
    btn.classList.add('holding');
    txt.textContent = 'KEEP HOLDING...';
    timer = setTimeout(async () => {
      timer = null;
      btn.classList.remove('holding');
      btn.disabled = true;
      txt.textContent = 'SENDING LAND CMD...';
      if (navigator.vibrate) navigator.vibrate(80);
      const j = await post('api/v1/land', { confirm: true, source: 'web', reason: 'operator LAND (web)' });
      txt.textContent = j && j.accepted ? 'LAND ACCEPTED' : 'LAND CMD FAILED';
      setTimeout(() => { btn.disabled = false; reset(); }, 4000);
    }, HOLD_MS);
  };
  const cancel = () => { if (!timer) return; clearTimeout(timer); timer = null; reset(); };
  btn.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, cancel));
  btn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) start(e); });
  btn.addEventListener('keyup', cancel);
})();

let initialTab = 'dash';
try { initialTab = localStorage.getItem('tab') || 'dash'; } catch {}
buildPicker();
showTab(initialTab);
connect();
pullHistory();
setInterval(pullHistory, 5000);
