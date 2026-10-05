/* ────────────────────────────────────────────────────────────
   Sky-Fi Wizard — Review-type steps
   Pre-populated by the backend; operator confirms with
   "Agree and continue". Each step exposes both the data and
   the source/timestamp so the technician can audit it.
──────────────────────────────────────────────────────────── */

/* ── 1. Location ───────────────────────────────────────────── */
const LocationStep = ({ data, setData, prefilled }) => {
  const wrap = React.useRef(null);
  const [pin, setPin] = React.useState(data.pin || (prefilled ? { x: 0.62, y: 0.41 } : null));
  const [coords, setCoords] = React.useState(data.coords || (prefilled ? { lat: 36.1408, lng: 36.1219 } : null));
  const [zone, setZone] = React.useState(data.zone || (prefilled ? 'Antakya — Sector 4' : ''));

  React.useEffect(() => { setData({ pin, coords, zone }); }, [pin, coords, zone]);

  const handleTap = (e) => {
    const rect = wrap.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const newPin = { x: Math.max(0.02, Math.min(0.98, x)), y: Math.max(0.02, Math.min(0.98, y)) };
    setPin(newPin);
    // Synthesize coordinates from pin position
    const lat = (36.10 + newPin.y * 0.08).toFixed(4);
    const lng = (36.08 + newPin.x * 0.10).toFixed(4);
    setCoords({ lat: Number(lat), lng: Number(lng) });
    setZone('Custom pin — Sector ' + Math.ceil(newPin.x * 6));
  };

  const useGPS = () => {
    setPin({ x: 0.50, y: 0.55 });
    setCoords({ lat: 36.1440, lng: 36.1280 });
    setZone('GPS lock — Sector 3');
  };

  return (
    <div className="wz-step-body">
      <Callout tone={prefilled ? 'ok' : 'info'} title={prefilled ? 'Pin pre-set by dispatch' : 'Tap the map to set your launch point'}>
        {prefilled
          ? 'This site was selected by Sector Lead during Operation briefing. Verify it matches what you see on the ground, then continue.'
          : 'Drop a pin within 200 m of your physical launch site. Sky-Fi will use it to query airspace, regulatory, and weather services.'}
      </Callout>

      <Field
        id="LOC-001"
        label="Launch site"
        helper="Tap the terrain below or use GPS. Coordinates are sent to airspace authorities."
        status={pin ? 'ok' : 'empty'}
        required
      >
        <div className="wz-map" ref={wrap} onClick={handleTap} role="button" aria-label="Map. Tap to set launch pin.">
          {/* Stylised terrain map (svg) */}
          <svg className="wz-map-svg" viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M40 0H0V40" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="1"/>
              </pattern>
              <pattern id="gridMajor" width="200" height="200" patternUnits="userSpaceOnUse">
                <path d="M200 0H0V200" fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="600" height="400" fill="#EDE6D8"/>
            {/* land mass / river */}
            <path d="M0 280 C 80 260 140 310 220 290 S 360 250 460 280 S 580 320 600 300 L 600 400 L 0 400 Z" fill="#C5D6A8" opacity="0.55"/>
            <path d="M0 250 C 100 220 200 270 300 240 S 500 200 600 230" fill="none" stroke="#79A3C7" strokeWidth="6" opacity="0.5"/>
            <path d="M0 250 C 100 220 200 270 300 240 S 500 200 600 230" fill="none" stroke="#79A3C7" strokeWidth="2"/>
            {/* Road grid */}
            <path d="M0 150 L600 150 M0 320 L600 320 M180 0 L180 400 M420 0 L420 400" stroke="rgba(60,60,60,0.4)" strokeWidth="1.5"/>
            <rect width="600" height="400" fill="url(#grid)"/>
            <rect width="600" height="400" fill="url(#gridMajor)"/>
            {/* Restricted zone */}
            <circle cx="120" cy="100" r="70" fill="#E60000" opacity="0.08" stroke="#E60000" strokeDasharray="6 4" strokeWidth="1.5"/>
            <text x="120" y="105" textAnchor="middle" fontSize="11" fontWeight="700" fill="#B30000" letterSpacing="0.1em">NO-FLY</text>
            {/* Settlements (label markers) */}
            {[
              { x: 200, y: 230, label: 'AID HUB' },
              { x: 380, y: 180, label: 'CLINIC' },
              { x: 460, y: 310, label: 'BASE' },
            ].map((s, i) => (
              <g key={i}>
                <rect x={s.x - 18} y={s.y - 7} width="36" height="14" fill="rgba(255,255,255,0.85)" rx="2"/>
                <text x={s.x} y={s.y + 3} textAnchor="middle" fontSize="9" fontWeight="700" fill="#1A1A1A" letterSpacing="0.06em">{s.label}</text>
              </g>
            ))}
          </svg>

          {/* Crosshair grid overlay */}
          <div className="wz-map-crosshair">
            <span></span><span></span>
          </div>

          {pin && (
            <div className="wz-map-pin" style={{ left: (pin.x * 100) + '%', top: (pin.y * 100) + '%' }}>
              <span className="wz-map-pin-ring"></span>
              <span className="wz-map-pin-dot"></span>
            </div>
          )}

          <div className="wz-map-overlay-top">
            <code className="wz-map-coord">
              {coords ? `${coords.lat}°N  ${coords.lng}°E` : 'Tap to drop pin'}
            </code>
            <span className="wz-map-scale">200 m</span>
          </div>
        </div>
      </Field>

      <div className="wz-row-actions">
        <button type="button" className="wz-btn wz-btn--ghost" onClick={useGPS}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
          Use device GPS
        </button>
        <button type="button" className="wz-btn wz-btn--ghost" onClick={() => { setPin(null); setCoords(null); setZone(''); }}>
          Clear pin
        </button>
      </div>

      <div className="wz-data-grid">
        <DataRow label="Latitude" value={coords ? coords.lat.toFixed(4) : '—'} unit="°N" />
        <DataRow label="Longitude" value={coords ? coords.lng.toFixed(4) : '—'} unit="°E" />
        <DataRow label="Sector" value={zone || '—'} status={zone ? 'ok' : 'pending'} />
        <DataRow label="Distance to NFZ" value={pin ? '1.4' : '—'} unit="km" status="ok" />
      </div>
    </div>
  );
};

/* ── 2. Weather (auto-populated, review) ───────────────────── */
const WeatherStep = ({ data, setData, prefilled }) => {
  // Always auto-populated. "prefilled" toggles whether the data is fresh
  // or has been recorded earlier and is being played back.
  const fetched = data.fetched ?? true;
  const ts = data.timestamp || '2026-05-16T08:42Z';

  React.useEffect(() => { setData({ fetched: true, timestamp: ts, agreed: data.agreed || false }); }, []);
  const setAgreed = (v) => setData({ fetched: true, timestamp: ts, agreed: v });

  return (
    <div className="wz-step-body">
      <Callout tone="info" title="Auto-populated from MET feed">
        Polled from <code>met.skyfi.cloud/v2/forecast</code> 4 minutes ago. Tap any field to view source data.
      </Callout>

      <Card eyebrow="CURRENT CONDITIONS" title="Antakya, Hatay — surface station ANT-04" dataSource="MET-EU · GFS · WMO 17370">
        <div className="wz-data-grid wz-data-grid--cols2">
          <DataRow label="Wind speed" value="14" unit="km/h" status="ok" />
          <DataRow label="Wind gust" value="22" unit="km/h" status="ok" />
          <DataRow label="Wind direction" value="218" unit="° SW" />
          <DataRow label="Visibility" value="9.2" unit="km" status="ok" />
          <DataRow label="Cloud base" value="1,400" unit="m AGL" />
          <DataRow label="Precipitation" value="0.0" unit="mm/h" status="ok" />
          <DataRow label="Air temperature" value="18.4" unit="°C" />
          <DataRow label="Humidity" value="62" unit="%" />
          <DataRow label="Pressure (QNH)" value="1019" unit="hPa" />
          <DataRow label="Lightning risk" value="None" status="ok" />
        </div>
      </Card>

      <Card eyebrow="6-HOUR OUTLOOK" title="Acceptable for tethered operations" tight>
        <div className="wz-forecast">
          {[
            { t: '09:00', w: 14, g: 22, ok: true },
            { t: '11:00', w: 16, g: 24, ok: true },
            { t: '13:00', w: 19, g: 27, ok: true },
            { t: '15:00', w: 23, g: 31, ok: true },
            { t: '17:00', w: 26, g: 34, ok: false },
            { t: '19:00', w: 22, g: 29, ok: true },
          ].map((f, i) => (
            <div key={i} className="wz-forecast-cell" data-ok={f.ok}>
              <div className="wz-forecast-time">{f.t}</div>
              <div className="wz-forecast-bar">
                <span style={{ height: (f.w / 40 * 100) + '%' }}></span>
              </div>
              <div className="wz-forecast-val">{f.w}</div>
              <div className="wz-forecast-gust">g{f.g}</div>
            </div>
          ))}
        </div>
        <div className="wz-legend">
          <span><span className="wz-legend-swatch" style={{ background: 'var(--sf-sky-blue)' }}></span> Sustained wind (km/h)</span>
          <span><span className="wz-legend-swatch" style={{ background: 'var(--vf-amber)' }}></span> Gust forecast</span>
          <span className="wz-legend-note">Operational limit: 35 km/h sustained</span>
        </div>
      </Card>

      <Callout tone="warn" title="Caution window 16:30–17:30">
        Forecast gusts exceed 30 km/h. Plan to recover the drone before this window unless on-site readings stay below threshold.
      </Callout>

      <Field id="WX-AGREE" label="Operator acknowledgment" required status={data.agreed ? 'ok' : 'empty'}>
        <ChoiceTile
          multi
          checked={data.agreed}
          onChange={() => setAgreed(!data.agreed)}
          label="I have reviewed the current and forecast conditions"
          sub="Required to proceed. Recorded with timestamp in flight log."
        />
      </Field>
    </div>
  );
};

/* ── 3. Airspace clearance (auto + manual) ─────────────────── */
const AirspaceStep = ({ data, setData, prefilled }) => {
  const checks = data.checks || {
    notam: false, ctr: false, mil: false, emcomm: false,
  };
  const update = (key, val) => setData({ ...data, checks: { ...checks, [key]: val } });

  const notams = [
    { id: 'A0421/26', label: 'Civil aviation reroute — TFR 5 km north', status: 'cleared', detail: 'Outside operating envelope. Continuous monitoring active.' },
    { id: 'M2118/26', label: 'Military exercise area — 14 km east', status: 'cleared', detail: 'No overlap with tethered op radius.' },
    { id: 'L0042/26', label: 'Local UAV restriction — Hatay province', status: 'waived', detail: 'Waiver E-2026-118 issued by DGCA at 06:11Z. Valid 72h.' },
  ];

  return (
    <div className="wz-step-body">
      <Callout tone="ok" title="Automated checks complete">
        Sky-Fi queried 4 authoritative sources at 08:38Z. 3 NOTAMs found — all resolved. Continue to confirm manual acknowledgments.
      </Callout>

      <Card eyebrow="AUTOMATED LOOKUP" title="Airspace authorities" dataSource="ICAO · EUROCONTROL · DGCA-TR · local AIM">
        <div className="wz-auth-list">
          {[
            { name: 'ICAO airspace class', value: 'Class G (uncontrolled) below 150 m AGL', ok: true },
            { name: 'Controlled airspace boundary', value: 'CTR Hatay — 18.4 km, no infringement', ok: true },
            { name: 'Emergency NOTAM waiver', value: 'E-2026-118 active until 18 May 06:00Z', ok: true },
            { name: 'Mode-S squawk reservation', value: '7741 (assigned)', ok: true },
          ].map((row, i) => (
            <div key={i} className="wz-auth-row">
              <div className="wz-auth-name">{row.name}</div>
              <div className="wz-auth-value">{row.value}</div>
              <StatusPill status="ok" label="VERIFIED" />
            </div>
          ))}
        </div>
      </Card>

      <Card eyebrow="ACTIVE NOTAMS IN RADIUS" title="3 found within 25 km · all resolved">
        <ul className="wz-notam-list">
          {notams.map(n => (
            <li key={n.id} className="wz-notam">
              <header>
                <code className="wz-notam-id">{n.id}</code>
                <StatusPill status={n.status === 'cleared' ? 'ok' : 'info'} label={n.status === 'cleared' ? 'CLEARED' : 'WAIVED'} />
              </header>
              <div className="wz-notam-label">{n.label}</div>
              <div className="wz-notam-detail">{n.detail}</div>
            </li>
          ))}
        </ul>
      </Card>

      <Card eyebrow="MANUAL CONFIRMATIONS" title="Required by §4.2 of operations manual">
        <div className="wz-check-list">
          {[
            { key: 'notam', label: 'I have read all 3 active NOTAMs', sub: 'Cross-checked against ICAO flight info circular.' },
            { key: 'ctr', label: 'No controlled airspace within tether radius', sub: 'Confirmed via overlay on map step.' },
            { key: 'mil', label: 'No conflicting military activity', sub: 'Coordinated via Foundation liaison desk.' },
            { key: 'emcomm', label: 'Emergency comms freq monitored on 121.5 MHz', sub: 'Required when ATS surveillance is unavailable.' },
          ].map(c => (
            <ChoiceTile
              key={c.key}
              multi
              checked={!!checks[c.key]}
              onChange={() => update(c.key, !checks[c.key])}
              label={c.label}
              sub={c.sub}
            />
          ))}
        </div>
      </Card>
    </div>
  );
};

/* ── 4. Regulatory compliance (prefilled review) ───────────── */
const RegulatoryStep = ({ data, setData, prefilled }) => {
  const items = [
    { id: 'REG-01', label: 'Operator certificate', detail: 'OC-VFF-2024-118 · expires 2027-03', source: 'DGCA-TR', state: 'verified' },
    { id: 'REG-02', label: 'Insurance — third party liability', detail: '€2M · policy VF-2025-8812', source: 'AON Aviation', state: 'verified' },
    { id: 'REG-03', label: 'Type certificate (drone)', detail: 'TC-EU-22-K (class C2, tethered)', source: 'EASA', state: 'verified' },
    { id: 'REG-04', label: 'Tether equipment inspection', detail: 'Last inspection 2026-04-22 (24 days ago)', source: 'Sky-Fi maintenance', state: 'verified' },
    { id: 'REG-05', label: 'Emergency response liaison', detail: 'AFAD field officer — confirmed at 07:48', source: 'AFAD', state: 'verified' },
    { id: 'REG-06', label: 'Data protection notice — host MNO', detail: 'Turkcell roaming agreement signed', source: 'Vodafone Foundation legal', state: 'verified' },
    { id: 'REG-07', label: 'Spectrum licence — emergency 4G', detail: 'Band 28 / 700 MHz · waiver active', source: 'BTK', state: 'verified' },
    { id: 'REG-08', label: 'Acoustic limit — local ordinance', detail: '< 75 dB(A) at 30 m · last measured 71 dB', source: 'Sky-Fi telemetry', state: 'attention' },
  ];

  const [expanded, setExpanded] = React.useState(null);
  const acknowledged = data.acknowledged || false;

  return (
    <div className="wz-step-body">
      <Callout tone="ok" title="7 of 8 verified · 1 advisory">
        All mandatory compliance items have been satisfied. One advisory item requires your awareness but does not block launch.
      </Callout>

      <Card eyebrow="COMPLIANCE PACKAGE" title="Pre-validated by dispatch" dataSource="package #P-2026-051611 · sealed 08:14Z">
        <ul className="wz-reg-list">
          {items.map(it => {
            const open = expanded === it.id;
            return (
              <li key={it.id} className="wz-reg" data-state={it.state}>
                <button type="button" className="wz-reg-row" onClick={() => setExpanded(open ? null : it.id)} aria-expanded={open}>
                  <span className="wz-reg-checkmark" aria-hidden="true">
                    {it.state === 'verified' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12" y2="16"/></svg>
                    )}
                  </span>
                  <span className="wz-reg-body">
                    <code className="wz-reg-id">{it.id}</code>
                    <span className="wz-reg-label">{it.label}</span>
                    <span className="wz-reg-detail">{it.detail}</span>
                  </span>
                  <span className="wz-reg-chev" data-open={open} aria-hidden="true">›</span>
                </button>
                {open && (
                  <div className="wz-reg-expand">
                    <DataRow label="Source authority" value={it.source} />
                    <DataRow label="Reference" value={it.id} />
                    <DataRow label="Verification path" value={"package/" + it.id + ".sig"} />
                    {it.state === 'attention' && (
                      <Callout tone="warn" title="Operator awareness required">
                        Acoustic readings are within limit but trending up. Monitor in flight; reduce throttle if &gt; 73 dB.
                      </Callout>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Field id="REG-ACK" label="Compliance acknowledgment" required status={acknowledged ? 'ok' : 'empty'}>
        <ChoiceTile
          multi
          checked={acknowledged}
          onChange={() => setData({ ...data, acknowledged: !acknowledged })}
          label="I have reviewed all 8 items and accept responsibility under §4.2"
          sub="A cryptographic acknowledgment will be written to the flight log."
        />
      </Field>
    </div>
  );
};

/* ── 5. Approvals (country-specific authority sign-off) ────── */
// Add new deployment countries/partners here — the dropdown scales without
// layout changes, unlike a tile list.
const APPROVAL_COUNTRIES = [
  { value: 'TR', label: 'Turkey' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'JM', label: 'Jamaica' },
];

const ApprovalsStep = ({ data, setData, prefilled }) => {
  const country = data.country || 'TR';

  // Resolve the country from the Step 1 launch pin as soon as this step is
  // reached — operator can still override via the field below.
  React.useEffect(() => { if (!data.country) setData({ ...data, country: 'TR' }); }, []);

  const selectCountry = (code) => setData({ ...data, country: code });
  const set = (section, patch) => setData({ ...data, [section]: { ...(data[section] || {}), ...patch } });

  return (
    <div className="wz-step-body">
      <Callout tone="info" title="Country of operation">
        Sky-Fi resolves the country from the launch coordinates set in Step 1, which determines which national airspace authority must sign off. Change it below if that's wrong.
      </Callout>

      <Field id="APR-COUNTRY" label="Country of operation" required status={country ? 'ok' : 'empty'} helper="Detected from the launch coordinates set in Step 1 — change it if that's wrong.">
        <Select id="APR-COUNTRY" value={country} onChange={selectCountry} options={APPROVAL_COUNTRIES} />
      </Field>

      {country === 'TR' && (
        <Card eyebrow="TURKEY · DGCA (SHGM)" title="Airspace authority confirmation" tight>
          <div className="wz-check-list">
            <ChoiceTile
              multi
              checked={!!data.tr?.confirmed}
              onChange={() => set('tr', { confirmed: !data.tr?.confirmed })}
              label={<>Confirmation received from <code>turkish@caa.com</code></>}
            />
          </div>
        </Card>
      )}

      {country === 'GB' && (
        <Card eyebrow="UNITED KINGDOM · UK CAA" title="Operator credentials" tight>
          <Field id="APR-GB-OPID" label="Operator ID" helper="As registered with the UK CAA." required status={data.gb?.operatorId ? 'ok' : 'empty'}>
            <TextInput id="APR-GB-OPID" value={data.gb?.operatorId} onChange={v => set('gb', { operatorId: v })} placeholder="e.g. GBR-OP-XXXXXXXX" />
          </Field>
          <div className="wz-check-list">
            <ChoiceTile
              multi
              checked={!!data.gb?.soraConfirmed}
              onChange={() => set('gb', { soraConfirmed: !data.gb?.soraConfirmed })}
              label="I have a valid SORA or confirmation from the CAA"
            />
          </div>
        </Card>
      )}

      {country === 'JM' && (
        <Card eyebrow="JAMAICA · JCAA" title="Airspace authority confirmation" tight>
          <div className="wz-check-list">
            <ChoiceTile
              multi
              checked={!!data.jm?.confirmed}
              onChange={() => set('jm', { confirmed: !data.jm?.confirmed })}
              label={<>Confirmation has been sought from <code>uavrequests@jcaa.gov.jm</code></>}
            />
          </div>
        </Card>
      )}
    </div>
  );
};

Object.assign(window, { LocationStep, WeatherStep, AirspaceStep, RegulatoryStep, ApprovalsStep });
