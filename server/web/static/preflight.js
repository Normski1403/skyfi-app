// Pre-flight: renders configuration-driven procedures (server/config) and
// autosaves every answer. The server validates each save against the same
// config and returns its verdict, so there's no client-side copy of the rules.
'use strict';

const pf = { config: null, view: null, step: 0, data: {}, saveTimer: null, clearance: null };

async function pfApi(method, path, body) {
  try {
    const r = await fetch(`api/v1/${path}`, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    return r.ok && j.ok !== false ? { ok: true, data: j } : { ok: false, error: j.error || r.statusText };
  } catch (e) { return { ok: false, error: 'Server unreachable: ' + e.message }; }
}

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
};
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso) => new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// ── clearance (from the live stream) ─────────────────────────────────
function pfRenderClearance(c) {
  pf.clearance = c;
  const card = $('clrCard');
  card.dataset.state = c.state;
  if (c.state === 'cleared') {
    $('clrState').textContent = 'CLEARED FOR LAUNCH';
    $('clrDetail').textContent = `${c.site_name} · PiC ${c.by} · until ${fmtTime(c.expires_at)} · ceiling ${c.max_alt_m} m · seal ${c.seal_hash.slice(0, 12)}…`;
  } else if (c.state === 'override') {
    $('clrState').textContent = 'EMERGENCY OVERRIDE';
    $('clrDetail').textContent = `${c.site_name} · by ${c.by} until ${fmtTime(c.expires_at)} · "${c.reason}"`;
  } else {
    $('clrState').textContent = 'LAUNCH BLOCKED';
    $('clrDetail').textContent = 'No valid pre-flight. Complete one for this site, or use an emergency override.';
  }
  const chip = $('clrChip');
  chip.dataset.clr = c.state;
  chip.textContent = c.state === 'cleared' ? `CLEARED · ${fmtTime(c.expires_at)}` : c.state === 'override' ? 'OVERRIDE' : 'NO PRE-FLIGHT';
}

// Called by app.js on every snapshot.
window.pfOnState = (s) => {
  if (s.clearance && JSON.stringify(s.clearance) !== JSON.stringify(pf.clearance)) {
    pfRenderClearance(s.clearance);
    pfHistory();
  }
  const live = document.querySelector('[data-live-wx]');
  if (live) renderLiveWx(live);
};

// ── history ──────────────────────────────────────────────────────────
async function pfHistory() {
  const r = await pfApi('GET', 'preflights');
  if (!r.ok) return;
  $('pfHistory').replaceChildren(...(r.data.length ? r.data.map((run) => el('li', {},
    el('span', { class: 'st', 'data-s': run.status }, run.status.toUpperCase()),
    el('span', {}, `${run.site_name} · ${fmtDate(run.completed_at || run.created_at)}`,
      run.pic_name ? ` · PiC ${run.pic_name}` : '',
      run.status === 'complete' && run.expires_at ? ` · until ${fmtDate(run.expires_at)}` : ''),
    run.status === 'draft' ? el('button', { onclick: () => pfOpen(run.id) }, 'Resume')
      : run.status === 'complete' ? el('a', { href: `api/v1/preflights/${run.id}/record` }, 'Sealed record')
      : el('span'),
  )) : [el('li', {}, el('span'), el('span', { class: 'sub' }, 'None yet'), el('span'))]));
}

// ── start / override dialogs ─────────────────────────────────────────
$('pfStartBtn').onclick = async () => {
  const drafts = (await pfApi('GET', 'preflights')).data?.filter((r) => r.status === 'draft') || [];
  $('siteList').replaceChildren(...pf.config.sites.map((s) => {
    const draft = drafts.find((d) => d.site_id === s.id);
    return el('button', {
      onclick: async () => {
        $('startDlg').close();
        if (draft) return pfOpen(draft.id);
        const r = await pfApi('POST', 'preflights', { site_id: s.id });
        if (r.ok) pfShow(r.data, 0); else alert(r.error);
      },
    }, el('strong', {}, s.name, draft ? ' · resume draft' : ''),
      el('small', {}, `${s.procedure_title} · ${s.step_count} steps`),
      el('small', {}, `Ceiling ${s.rules.max_alt_m} m · land at wind ${s.rules.wind_land_ms} / gust ${s.rules.gust_land_ms} m/s · crew ≥ ${s.rules.min_crew} · valid ${s.rules.validity_h} h${s.radius_m ? ` · geofence ${s.radius_m} m` : ''}`));
  }));
  $('startDlg').showModal();
};

$('pfOverrideBtn').onclick = () => {
  $('ovSite').replaceChildren(...pf.config.sites.filter((s) => s.rules.allow_override).map((s) => el('option', { value: s.id }, s.name)));
  const today = new Date().toISOString().slice(0, 10);
  $('ovOp').replaceChildren(...pf.config.operators.filter((o) => o.roles.includes('pic')).map((o) =>
    el('option', { value: o.id, disabled: !o.cert_expires || o.cert_expires < today },
      `${o.name}${o.cert_expires < today ? ' (certificate expired)' : ''}`)));
  $('ovErr').textContent = '';
  $('overrideDlg').showModal();
};
$('ovGo').onclick = async () => {
  const r = await pfApi('POST', 'override', { site_id: $('ovSite').value, operator_id: $('ovOp').value, reason: $('ovReason').value });
  if (!r.ok) { $('ovErr').textContent = r.error; return; }
  $('overrideDlg').close();
  $('ovReason').value = '';
  pfRenderClearance(r.data);
};

// ── wizard ───────────────────────────────────────────────────────────
async function pfOpen(id) {
  const r = await pfApi('GET', `preflights/${id}`);
  if (!r.ok) return alert(r.error);
  const v = r.data;
  // Resume at the first incomplete step
  const first = v.steps.findIndex((s) => !s.complete);
  pfShow(v, first < 0 ? v.steps.length - 1 : first);
}

function pfShow(view, step) {
  pf.view = view;
  pf.data = structuredClone(view.run.data || {});
  pf.step = step;
  $('wizard').hidden = false;
  $('wizard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  renderWizard();
}
$('wzClose').onclick = () => { $('wizard').hidden = true; pf.view = null; pfHistory(); };

function renderWizard() {
  const v = pf.view, proc = v.procedure, sealed = v.run.status !== 'draft';
  const done = v.steps.filter((s) => s.complete).length;
  $('wzEyebrow').textContent = `${proc.title} v${proc.version}${sealed ? ' · ' + v.run.status.toUpperCase() : ''}`;
  $('wzSite').textContent = `${v.site.name} · ${done}/${v.steps.length} complete`;
  $('wzProgress').style.width = `${(done / v.steps.length) * 100}%`;

  $('wzSteps').replaceChildren(...proc.steps.map((st, i) => {
    const s = v.steps[i];
    const touched = pf.data[st.id] && Object.keys(pf.data[st.id]).length;
    const glyph = s.complete ? 'done' : touched && s.errors.length ? 'error' : '';
    return el('li', {}, el('button', { 'aria-current': i === pf.step ? 'step' : false, onclick: () => { pf.step = i; renderWizard(); } },
      el('span', { class: 'glyph', 'data-s': glyph }, s.complete ? '✓' : String(i + 1)), st.short));
  }));

  const st = proc.steps[pf.step], status = v.steps[pf.step];
  const box = $('wzStep');
  // Native replaceChildren() turns null into the text "null": drop absent parts.
  box.replaceChildren(...[
    el('div', { class: 'label' }, st.kind === 'auto' ? 'Automated · review' : st.kind === 'review' ? 'Review · acknowledge' : 'Field input'),
    el('h3', {}, st.title),
    st.intro ? el('div', { class: 'callout', 'data-tone': st.intro.tone }, st.intro.text) : null,
    ...st.fields.map((f) => renderField(st, f, sealed)),
    status.errors.length && !sealed ? el('ul', { class: 'errs' }, status.errors.map((e) => el('li', {}, e))) : null,
    renderNav(sealed),
  ].filter((x) => x != null));
}

function renderNav(sealed) {
  const v = pf.view, last = pf.step === v.procedure.steps.length - 1;
  const back = el('button', { class: 'btn secondary', disabled: pf.step === 0, onclick: () => { pf.step--; renderWizard(); } }, 'Back');
  if (sealed) {
    return el('div', {}, el('div', { class: 'sealed' },
      el('div', { class: 'big' }, v.run.status === 'complete' ? 'SEALED' : v.run.status.toUpperCase()),
      v.run.expires_at ? el('div', {}, `Valid until ${fmtDate(v.run.expires_at)} · ceiling ${v.run.max_alt_m} m · target ${v.run.target_alt_m} m`) : null,
      el('div', { class: 'hash' }, `SHA-256 ${v.run.seal_hash}`),
      el('div', { class: 'sub' }, `Signed by this ground station · cloud sync: ${v.run.sync_status}`)),
      el('div', { class: 'wz-nav' }, back,
        el('a', { class: 'btn secondary', href: `api/v1/preflights/${v.run.id}/record` }, 'Download record'),
        el('button', { class: 'btn secondary', disabled: last, onclick: () => { pf.step++; renderWizard(); } }, 'Next')));
  }
  const next = last
    ? el('button', { class: 'btn primary', disabled: !v.ready, onclick: sealRun }, v.ready ? 'Seal pre-flight' : 'Complete all steps to seal')
    : el('button', { class: 'btn primary', onclick: () => { pf.step++; renderWizard(); } }, v.steps[pf.step].complete ? 'Next' : 'Next (incomplete)');
  return el('div', { class: 'wz-nav' }, back,
    el('button', { class: 'btn danger-ghost small', onclick: voidRun }, 'Discard'), next);
}

async function sealRun() {
  await flushSave();
  const r = await pfApi('POST', `preflights/${pf.view.run.id}/complete`);
  if (!r.ok) return alert(r.error);
  pf.view = r.data;
  renderWizard();
  pfHistory();
}
async function voidRun() {
  if (!confirm('Discard this pre-flight draft?')) return;
  await pfApi('POST', `preflights/${pf.view.run.id}/void`);
  $('wizard').hidden = true;
  pfHistory();
}

// ── autosave ─────────────────────────────────────────────────────────
function setVal(stepId, fieldId, value, rerender = true) {
  pf.data[stepId] = { ...(pf.data[stepId] || {}), [fieldId]: value };
  $('wzSaved').textContent = 'Saving…';
  clearTimeout(pf.saveTimer);
  pf.saveTimer = setTimeout(() => save(stepId), 400);
  if (rerender) renderWizard();
}
async function save(stepId) {
  pf.saveTimer = null;
  const r = await pfApi('PUT', `preflights/${pf.view.run.id}/steps/${stepId}`, pf.data[stepId] || {});
  if (!r.ok) { $('wzSaved').textContent = 'Not saved: ' + r.error; return; }
  pf.view = r.data;
  $('wzSaved').textContent = 'Saved ✓';
  // Don't rebuild the step under someone typing (it would drop focus).
  const a = document.activeElement;
  if (!(a && $('wzStep').contains(a) && ['text', 'tel', 'number'].includes(a.type))) renderWizard();
}
async function flushSave() {
  if (pf.saveTimer) { clearTimeout(pf.saveTimer); await save(pf.view.procedure.steps[pf.step].id); }
}

// ── field renderers ──────────────────────────────────────────────────
function renderField(st, f, ro) {
  const val = pf.data[st.id]?.[f.id];
  const set = (v, rerender) => setVal(st.id, f.id, v, rerender);
  const wrap = (...kids) => el('div', { class: 'fld' },
    f.type !== 'info' ? el('span', { class: f.required ? 'fld-label req' : 'fld-label' }, f.label) : null,
    f.help ? el('span', { class: 'help' }, f.help) : null, ...kids);
  const opt = (type, checked, onchange, label, ...tags) =>
    el('label', { class: 'opt' }, el('input', { type, checked, disabled: ro, onchange }), el('span', {}, label), ...tags);

  switch (f.type) {
    case 'info':
      return el('div', { class: 'callout' }, el('strong', {}, f.label), el('div', {}, f.text));
    case 'ack':
      return wrap(opt('checkbox', !!val, (e) => set(e.target.checked), 'Confirmed'));
    case 'checklist':
      return wrap(el('div', { class: 'tiles-opt' }, f.items.map((it) =>
        opt('checkbox', !!val?.[it.id], (e) => set({ ...(val || {}), [it.id]: e.target.checked }), it.label))));
    case 'choice':
      return wrap(el('div', { class: 'tiles-opt' }, f.options.map((o) =>
        opt('radio', val === o.value, () => set(o.value), o.label,
          o.blocks ? el('span', { class: 'tag block' }, 'BLOCKS LAUNCH') : null,
          o.max_alt_m ? el('span', { class: 'tag ceil' }, `≤ ${o.max_alt_m} m`) : null))));
    case 'text': case 'tel':
      return wrap(el('input', { type: f.type, value: val ?? '', disabled: ro, inputmode: f.type === 'tel' ? 'tel' : null,
        oninput: (e) => set(e.target.value, false) }));
    case 'number': {
      const n = val ?? f.min, out = el('output', {}, `${n} ${f.unit || ''}`);
      return wrap(el('div', { class: 'numrow' },
        el('input', { type: 'range', min: f.min, max: f.max, step: f.step || 1, value: n, disabled: ro,
          oninput: (e) => { out.textContent = `${e.target.value} ${f.unit || ''}`; set(Number(e.target.value), false); },
          onchange: () => renderWizard() }), out));
    }
    case 'location': return wrap(renderLocation(pf.view.site, val, set, ro));
    case 'live_weather': {
      const box = el('div', { 'data-live-wx': '' });
      renderLiveWx(box);
      return wrap(box, opt('checkbox', !!val, (e) => set(e.target.checked || null), 'Readings checked'));
    }
    case 'photo': return wrap(renderPhotos(f, val || [], set, ro));
    case 'crew': return wrap(renderCrew(f, val || {}, set, ro));
    case 'signature': return wrap(renderSignature(val, set, ro));
  }
  return wrap(el('span', { class: 'sub' }, `Unsupported field type ${f.type}`));
}

function renderLocation(site, val, set, ro) {
  const lat = el('input', { type: 'number', step: 'any', placeholder: 'Latitude', value: val?.lat ?? '', disabled: ro });
  const lon = el('input', { type: 'number', step: 'any', placeholder: 'Longitude', value: val?.lon ?? '', disabled: ro });
  const msg = el('span', { class: 'help' }, site.lat != null ? `Must be within ${site.radius_m} m of ${site.lat}, ${site.lon}.` : 'No geofence for this site.');
  const commit = () => { if (lat.value && lon.value) set({ lat: Number(lat.value), lon: Number(lon.value), source: 'manual' }); };
  lat.onchange = commit; lon.onchange = commit;
  const gps = el('button', { class: 'btn secondary', disabled: ro, onclick: () => {
    if (!navigator.geolocation || !window.isSecureContext) {
      msg.textContent = 'Device GPS needs a secure (https) connection; enter the position manually.'; return;
    }
    msg.textContent = 'Getting position…';
    navigator.geolocation.getCurrentPosition(
      (p) => set({ lat: p.coords.latitude, lon: p.coords.longitude, acc_m: p.coords.accuracy, source: 'gps' }),
      (e) => { msg.textContent = 'GPS failed: ' + e.message; }, { enableHighAccuracy: true, timeout: 15000 });
  } }, 'Use GPS');
  return [el('div', { class: 'locrow' }, lat, lon, gps), msg];
}

function renderLiveWx(box) {
  const s = state, site = pf.view?.site;
  if (!s || !site) return;
  const w = s.weather, fresh = s.weather_age_s >= 0 && s.weather_age_s <= 30;
  const cell = (label, v, limit) => el('div', { 'data-ok': v == null ? null : String(v < limit) },
    el('span', { class: 'label' }, label), el('b', {}, v == null ? '--' : `${v.toFixed(1)} m/s`), el('span', { class: 'sub' }, `limit ${limit}`));
  box.replaceChildren(el('div', { class: 'live-wx' },
    cell('Wind', fresh ? w.wind : null, site.rules.wind_land_ms),
    cell('Gust', fresh ? w.gust : null, site.rules.gust_land_ms),
    el('div', { 'data-ok': String(fresh) }, el('span', { class: 'label' }, 'Reading age'),
      el('b', {}, s.weather_age_s < 0 ? 'none' : `${Math.round(s.weather_age_s)} s`), el('span', { class: 'sub' }, w.source || ''))));
}

async function downscale(file, max = 1600) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = el('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
}
async function uploadBlob(blob) {
  const r = await fetch('api/v1/blobs', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j.id;
}

function renderPhotos(f, ids, set, ro) {
  const input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, hidden: true,
    onchange: async (e) => {
      $('wzSaved').textContent = 'Uploading…';
      const out = [...ids];
      for (const file of e.target.files) {
        try { out.push(await uploadBlob(await downscale(file))); } catch (err) { alert('Upload failed: ' + err.message); }
      }
      set(out.slice(0, f.max || 6));
    } });
  return [
    el('div', { class: 'thumbs' }, ids.map((id) => el('figure', {},
      el('img', { src: `api/v1/blobs/${id}`, alt: 'Site photo' }),
      ro ? null : el('button', { 'aria-label': 'Remove', onclick: () => set(ids.filter((x) => x !== id)) }, '×')))),
    ro ? null : el('button', { class: 'btn secondary', onclick: () => input.click() }, ids.length ? 'Add more photos' : 'Take / choose photos'),
    input,
  ];
}

function renderCrew(f, val, set, ro) {
  const members = val.members || [], today = new Date().toISOString().slice(0, 10);
  return [
    el('span', { class: 'help' }, `${members.length} selected · at least ${f.min} required · one pilot in command`),
    ...pf.view.operators.map((o) => {
      const isPic = o.roles.includes('pic'), expired = isPic && (!o.cert_expires || o.cert_expires < today);
      const inCrew = members.includes(o.id);
      return el('div', { class: 'crew-row' },
        el('input', { type: 'checkbox', checked: inCrew, disabled: ro, 'aria-label': `${o.name} present`,
          onchange: (e) => {
            const m = e.target.checked ? [...members, o.id] : members.filter((x) => x !== o.id);
            set({ members: m, pic: m.includes(val.pic) ? val.pic : null });
          } }),
        el('span', {}, o.name, el('small', { class: expired ? 'exp' : '' },
          o.roles.join(', ') + (o.cert ? ` · ${o.cert} · ${expired ? 'EXPIRED' : 'valid to'} ${o.cert_expires}` : ''))),
        isPic ? el('label', {}, el('input', { type: 'radio', name: 'pic', checked: val.pic === o.id, disabled: ro || expired,
          onchange: () => set({ members: inCrew ? members : [...members, o.id], pic: o.id }) }), 'PiC') : el('span'));
    }),
  ];
}

function renderSignature(val, set, ro) {
  if (val?.blob) {
    return [el('img', { class: 'sig-img', src: `api/v1/blobs/${val.blob}`, alt: 'Signature' }),
      ro ? null : el('button', { class: 'btn secondary small', onclick: () => set(null) }, 'Sign again')];
  }
  const c = el('canvas', { class: 'sigpad' });
  let drawing = false, inked = false, ctx;
  const pos = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
  requestAnimationFrame(() => {
    c.width = c.clientWidth * 2; c.height = c.clientHeight * 2;
    ctx = c.getContext('2d'); ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.strokeStyle = '#141618';
  });
  c.onpointerdown = (e) => { drawing = true; inked = true; c.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); };
  c.onpointermove = (e) => { if (drawing) { ctx.lineTo(...pos(e)); ctx.stroke(); } };
  c.onpointerup = () => { drawing = false; };
  return [c, el('div', { class: 'wz-nav' },
    el('button', { class: 'btn secondary small', onclick: () => { ctx.clearRect(0, 0, c.width, c.height); inked = false; } }, 'Clear'),
    el('button', { class: 'btn primary small', onclick: () => {
      if (!inked) return alert('Sign in the box first');
      c.toBlob(async (b) => { try { set({ blob: await uploadBlob(b), signed_at: new Date().toISOString() }); } catch (e) { alert(e.message); } }, 'image/png');
    } }, 'Save signature'))];
}

// ── init ─────────────────────────────────────────────────────────────
document.querySelectorAll('[data-goto]').forEach((b) => { b.onclick = () => showTab(b.dataset.goto); });
(async () => {
  const r = await pfApi('GET', 'preflight/config');
  if (!r.ok) { $('clrState').textContent = 'PRE-FLIGHT UNAVAILABLE'; $('clrDetail').textContent = r.error; return; }
  pf.config = r.data;
  const c = await pfApi('GET', 'preflight/clearance');
  if (c.ok) pfRenderClearance(c.data);
  pfHistory();
})();
