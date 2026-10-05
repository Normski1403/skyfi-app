/* ────────────────────────────────────────────────────────────
   Sky-Fi Wizard — Active input steps
   Photo, hazards, crew, emergency contact, flight parameters
   (slider), finger signature, risk acceptance.
──────────────────────────────────────────────────────────── */

/* ── 6. Photo capture ──────────────────────────────────────── */
const PhotoStep = ({ data, setData, prefilled }) => {
  const fileRef = React.useRef(null);
  const [photo, setPhoto] = React.useState(data.photo || (prefilled ? { synthetic: true } : null));
  const [meta, setMeta] = React.useState(data.meta || (prefilled ? { ts: '2026-05-16T08:39Z', heading: 218, count: 4 } : null));

  React.useEffect(() => { setData({ photo, meta }); }, [photo, meta]);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto({ url: reader.result, name: f.name, size: f.size });
      setMeta({ ts: new Date().toISOString().slice(0, 16) + 'Z', heading: 218, count: 1 });
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="wz-step-body">
      <Callout tone="info" title="Capture 3 reference photos of the launch area">
        Required for the post-flight report. Photos are timestamped and geotagged automatically; metadata cannot be edited.
      </Callout>

      <Field id="PHT-001" label="Launch site reference photographs" helper="North-facing wide shot, ground surface, overhead obstructions." required status={photo ? 'ok' : 'empty'}>
        <div className="wz-photo-grid">
          <div className="wz-photo-slot wz-photo-slot--filled">
            {photo?.url ? (
              <img src={photo.url} alt="" className="wz-photo-img"/>
            ) : (
              <SyntheticSitePhoto angle="wide" />
            )}
            <span className="wz-photo-tag">1 · WIDE NORTH</span>
          </div>
          <div className="wz-photo-slot wz-photo-slot--filled">
            <SyntheticSitePhoto angle="ground" />
            <span className="wz-photo-tag">2 · GROUND</span>
          </div>
          <div className="wz-photo-slot wz-photo-slot--filled">
            <SyntheticSitePhoto angle="overhead" />
            <span className="wz-photo-tag">3 · OVERHEAD</span>
          </div>
          <button type="button" className="wz-photo-slot wz-photo-slot--add" onClick={() => fileRef.current?.click()}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M9 6l1.5-2h3L15 6"/></svg>
            <span>Add photo</span>
            <span className="wz-photo-slot-sub">Camera or library</span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} hidden/>
        </div>
      </Field>

      <Card eyebrow="EMBEDDED METADATA" title="Will be sealed into flight log" tight>
        <div className="wz-data-grid wz-data-grid--cols2">
          <DataRow label="Timestamp" value={meta?.ts || '—'} />
          <DataRow label="Heading captured" value={meta?.heading != null ? meta.heading : '—'} unit="°" />
          <DataRow label="Frames recorded" value={meta?.count || (photo ? 3 : 0)} />
          <DataRow label="GPS imprint" value="locked" status="ok" />
        </div>
      </Card>
    </div>
  );
};

// Synthetic 'site' tile that stands in for a real photo — better than emoji or icon-of-camera
const SyntheticSitePhoto = ({ angle }) => {
  const variants = {
    wide:     { bg: 'linear-gradient(180deg, #B7C8D9 0%, #B7C8D9 55%, #C8B891 55%, #A89773 100%)', label: 'WIDE-N' },
    ground:   { bg: 'linear-gradient(180deg, #A89773 0%, #8C7A56 100%)', label: 'GROUND' },
    overhead: { bg: 'linear-gradient(180deg, #C8D2DC 0%, #9FB1C4 100%)', label: 'OVHD' },
  };
  const v = variants[angle] || variants.wide;
  return (
    <div className="wz-photo-synthetic" style={{ background: v.bg }}>
      <svg className="wz-photo-synthetic-svg" viewBox="0 0 100 80" preserveAspectRatio="none">
        {angle === 'wide' && (<>
          <path d="M0 50 L20 42 L35 48 L55 38 L75 44 L100 40 L100 55 L0 55 Z" fill="rgba(0,0,0,0.18)"/>
          <rect x="60" y="25" width="3" height="20" fill="rgba(0,0,0,0.4)"/>
          <rect x="58" y="28" width="7" height="2" fill="rgba(0,0,0,0.4)"/>
        </>)}
        {angle === 'ground' && (<>
          <circle cx="20" cy="60" r="4" fill="rgba(0,0,0,0.18)"/>
          <circle cx="55" cy="68" r="6" fill="rgba(0,0,0,0.15)"/>
          <circle cx="78" cy="55" r="3" fill="rgba(0,0,0,0.18)"/>
        </>)}
        {angle === 'overhead' && (<>
          <line x1="0" y1="40" x2="100" y2="38" stroke="rgba(0,0,0,0.35)" strokeWidth="0.8"/>
          <line x1="0" y1="42" x2="100" y2="40" stroke="rgba(0,0,0,0.35)" strokeWidth="0.8"/>
        </>)}
      </svg>
      <span className="wz-photo-synthetic-tag">SAMPLE · {v.label}</span>
    </div>
  );
};

/* ── 7. Hazards ────────────────────────────────────────────── */
const HazardsStep = ({ data, setData, prefilled }) => {
  const hazards = data.hazards || {};
  const update = (key, val) => setData({ ...data, hazards: { ...hazards, [key]: val } });

  const items = [
    { key: 'people',     label: 'People nearby', sub: 'Are uninvolved persons within tether radius (50 m)?',
      options: ['None present', 'Beyond 50 m, marshalled', 'Within 50 m — controlled'], block: 2 },
    { key: 'power',      label: 'Overhead power lines', sub: 'Within 80 m horizontal or 50 m vertical of operations zone',
      options: ['None visible', 'Present — distance verified > 80 m'], block: 1 },
    { key: 'structures', label: 'Tall structures / antennas', sub: 'Above planned flight ceiling',
      options: ['None within 150 m', 'Present — flight ceiling reduced'], block: null },
    { key: 'water',      label: 'Water bodies under flight path', sub: 'Open water, pools, flooded zones',
      options: ['None', 'Present — emergency floatation rigged'], block: null },
    { key: 'fuel',       label: 'Flammable material on site', sub: 'Fuel, gas cylinders, accelerants',
      options: ['None within 30 m', 'Present — distance > 30 m verified'], block: null },
  ];

  return (
    <div className="wz-step-body">
      <Callout tone="warn" title="On-the-ground assessment required">
        These cannot be auto-populated. Walk the launch area, then record what you observe. Selecting a high-risk option below will block launch.
      </Callout>

      {items.map(item => {
        const selected = hazards[item.key];
        const idx = item.options.indexOf(selected);
        const isBlocking = item.block != null && idx === item.block;
        return (
          <Field
            key={item.key}
            id={'HAZ-' + item.key.toUpperCase()}
            label={item.label}
            helper={item.sub}
            required
            status={selected ? (isBlocking ? 'warn' : 'ok') : 'empty'}
            error={isBlocking ? 'High-risk condition — must be resolved before launch.' : null}
          >
            <div className="wz-radio-list">
              {item.options.map((opt, i) => (
                <ChoiceTile
                  key={i}
                  checked={selected === opt}
                  onChange={() => update(item.key, opt)}
                  label={opt}
                  value={opt}
                  severity={item.block === i ? 'high' : null}
                />
              ))}
            </div>
          </Field>
        );
      })}

      <Card eyebrow="DERIVED" title="Calculated safety envelope" tight>
        <div className="wz-data-grid wz-data-grid--cols2">
          <DataRow label="Max altitude" value={hazards.structures ? '80' : '120'} unit="m AGL" status="ok" />
          <DataRow label="Min standoff" value="50" unit="m" />
          <DataRow label="Risk score" value={Object.values(hazards).filter(Boolean).length ? '2' : '—'} unit="/ 10" status="ok"/>
          <DataRow label="Items flagged" value={items.filter((it, i) => hazards[it.key] && it.options.indexOf(hazards[it.key]) === it.block).length} />
        </div>
      </Card>
    </div>
  );
};

/* ── 8. Crew ───────────────────────────────────────────────── */
const CrewStep = ({ data, setData, prefilled }) => {
  const crew = data.crew || (prefilled ? ['lead', 'observer', 'rf', 'liaison'] : []);
  const lead = data.lead || (prefilled ? 'lead' : null);
  const toggle = (key) => {
    const next = crew.includes(key) ? crew.filter(k => k !== key) : [...crew, key];
    setData({ ...data, crew: next, lead: next.includes(lead) ? lead : (next[0] || null) });
  };

  const roles = [
    { key: 'lead',     name: 'Aydın Demir',       role: 'Pilot in command',         cert: 'VFF-PiC-2024-118', avail: true },
    { key: 'observer', name: 'Mira Souza',         role: 'Visual observer',          cert: 'VO-EASA-721',      avail: true },
    { key: 'rf',       name: 'Jonas Pereira',      role: 'RF / payload engineer',    cert: 'RF-IV-2025-09',    avail: true },
    { key: 'liaison',  name: 'Kemal Yıldız',       role: 'AFAD liaison',             cert: 'AFAD-LO-228',      avail: true },
    { key: 'medic',    name: 'Dr. Elif Korkmaz',  role: 'Field medic',              cert: 'TR-EMT-A',         avail: false },
    { key: 'spare',    name: '— vacant —',         role: 'Spare PiC',                cert: '',                 avail: true },
  ];

  return (
    <div className="wz-step-body">
      <Callout tone="info" title={"Roster pulled from manifest M-2026-051611"}>
        Select all personnel physically present at the launch site. Minimum: 1 PiC, 1 visual observer. Pilot in command is identified separately.
      </Callout>

      <Field id="CRW-ROSTER" label="Personnel present" required status={crew.length >= 2 ? 'ok' : 'empty'} helper={crew.length + ' selected · minimum 2 required'}>
        <div className="wz-crew-list">
          {roles.map(r => (
            <label
              key={r.key}
              className={"wz-crew" + (crew.includes(r.key) ? " wz-crew--checked" : "") + (!r.avail ? " wz-crew--disabled" : "")}
            >
              <input
                type="checkbox"
                checked={crew.includes(r.key)}
                onChange={() => r.avail && toggle(r.key)}
                disabled={!r.avail}
                className="wz-choice-input"
              />
              <span className="wz-choice-mark" aria-hidden="true"></span>
              <span className="wz-crew-avatar" aria-hidden="true">{r.name.split(' ').map(p=>p[0]).slice(0,2).join('').replace('—','-')}</span>
              <span className="wz-crew-body">
                <span className="wz-crew-name">{r.name}</span>
                <span className="wz-crew-role">{r.role}</span>
                {r.cert && <code className="wz-crew-cert">{r.cert}</code>}
              </span>
              {!r.avail && <span className="wz-crew-status">OFF-ROSTER</span>}
            </label>
          ))}
        </div>
      </Field>

      <Field id="CRW-PIC" label="Pilot in command" helper="Final authority for the flight. Must hold an active PiC certificate." required status={lead ? 'ok' : 'empty'}>
        <div className="wz-radio-list">
          {roles.filter(r => crew.includes(r.key)).map(r => (
            <ChoiceTile
              key={r.key}
              checked={lead === r.key}
              onChange={() => setData({ ...data, crew, lead: r.key })}
              label={r.name}
              sub={r.cert + (r.role.includes('Pilot') ? ' — certified PiC' : ' — observer (overrides require dispatch approval)')}
            />
          ))}
          {crew.length === 0 && <div className="wz-empty">Select at least one crew member above.</div>}
        </div>
      </Field>
    </div>
  );
};

/* ── 9. Emergency contact ──────────────────────────────────── */
const ContactStep = ({ data, setData, prefilled }) => {
  const c = data.contact || (prefilled ? {
    name: 'Operations Centre — Ankara',
    role: 'Foundation duty officer',
    phone: '+90 312 555 0118',
    altPhone: '+90 532 555 0034',
    relation: 'dispatch',
    confirmed: true,
  } : { name: '', role: '', phone: '', altPhone: '', relation: '', confirmed: false });
  const update = (k, v) => setData({ ...data, contact: { ...c, [k]: v } });
  const valid = c.name && c.phone && c.relation;

  return (
    <div className="wz-step-body">
      <Callout tone="info" title="Who do we call if the flight is lost?">
        Must be reachable for the entire flight window. Sky-Fi will SMS this number when the drone leaves the ground and when it lands.
      </Callout>

      <Field id="EC-NAME" label="Primary contact" helper="Full name or call-sign of an individual / desk." required status={c.name ? 'ok' : 'empty'}>
        <TextInput id="EC-NAME" value={c.name} onChange={v => update('name', v)} placeholder="e.g. Foundation Operations — Ankara" />
      </Field>

      <Field id="EC-ROLE" label="Role / organisation">
        <TextInput id="EC-ROLE" value={c.role} onChange={v => update('role', v)} placeholder="Duty officer, dispatcher, …" />
      </Field>

      <div className="wz-row-2">
        <Field id="EC-PHONE" label="Primary phone" required status={c.phone ? 'ok' : 'empty'}>
          <TextInput id="EC-PHONE" type="tel" inputMode="tel" value={c.phone} onChange={v => update('phone', v)} placeholder="+90 …" prefix={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.91.36 1.79.7 2.62a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.46-1.27a2 2 0 0 1 2.11-.45c.83.34 1.71.57 2.62.7A2 2 0 0 1 22 16.92z"/></svg>}/>
        </Field>
        <Field id="EC-ALT" label="Secondary phone">
          <TextInput id="EC-ALT" type="tel" inputMode="tel" value={c.altPhone} onChange={v => update('altPhone', v)} placeholder="Optional" />
        </Field>
      </div>

      <Field id="EC-REL" label="Relationship to operation" required status={c.relation ? 'ok' : 'empty'} helper="Used to route automated callouts.">
        <div className="wz-radio-list wz-radio-list--inline">
          {[
            { v: 'dispatch', l: 'Dispatch / duty desk' },
            { v: 'sponsor', l: 'Operation sponsor' },
            { v: 'family',  l: 'Crew next of kin' },
            { v: 'liaison', l: 'Local emergency liaison' },
          ].map(o => (
            <ChoiceTile key={o.v} checked={c.relation === o.v} onChange={() => update('relation', o.v)} label={o.l}/>
          ))}
        </div>
      </Field>

      <Card eyebrow="WHEN WE'LL CONTACT THEM" tight>
        <ul className="wz-trigger-list">
          <li><span className="wz-trigger-dot" data-tone="info"/> Drone leaves the ground (SMS)</li>
          <li><span className="wz-trigger-dot" data-tone="info"/> Drone returns to home (SMS)</li>
          <li><span className="wz-trigger-dot" data-tone="warn"/> Tether tension exceeds 80% (call + SMS)</li>
          <li><span className="wz-trigger-dot" data-tone="error"/> Emergency landing initiated (call until acknowledged)</li>
        </ul>
      </Card>
    </div>
  );
};

/* ── 10. Flight parameters (slider) ─────────────────────────── */
const ParametersStep = ({ data, setData, prefilled }) => {
  const altitude = data.altitude ?? (prefilled ? 95 : 80);
  const tether = data.tether ?? (prefilled ? 100 : 100);
  const windowMin = data.windowMin ?? (prefilled ? 45 : 30);

  const update = (k, v) => setData({ ...data, altitude, tether, windowMin, [k]: v });

  return (
    <div className="wz-step-body">
      <Callout tone="info" title="Operating envelope">
        Sky-Fi will not exceed these values. Reduce if hazards on the previous step are flagged. The tether length sets a hard ceiling regardless.
      </Callout>

      <Field id="FP-ALT" label="Target altitude" helper="Above ground level at launch point. Coverage area scales with altitude." required>
        <NumberDisplay value={altitude} unit="m AGL" />
        <RangeSlider id="FP-ALT" min={30} max={150} step={5} value={altitude} onChange={v => update('altitude', v)} marks={[60, 90, 120]} />
        <div className="wz-coverage-est">
          <DataRow label="Estimated coverage" value={(Math.PI * Math.pow(altitude * 0.012, 2)).toFixed(2)} unit="km²" />
          <DataRow label="LEO link margin" value={altitude < 80 ? '+3.1' : altitude < 120 ? '+5.4' : '+6.8'} unit="dB" status="ok" />
        </div>
      </Field>

      <Field id="FP-TETHER" label="Tether length deployed" helper="Physical hard limit. Pre-flight check confirms reel matches selection." required>
        <NumberDisplay value={tether} unit="m" />
        <RangeSlider id="FP-TETHER" min={50} max={150} step={10} value={tether} onChange={v => update('tether', v)} />
        {tether < altitude && (
          <div className="wz-field-error">Tether shorter than target altitude — increase tether or reduce altitude.</div>
        )}
      </Field>

      <Field id="FP-WINDOW" label="Planned flight window" helper="Sky-Fi will warn at 75% and force return at 100%." required>
        <NumberDisplay value={windowMin} unit="min" />
        <RangeSlider id="FP-WINDOW" min={30} max={180} step={15} value={windowMin} onChange={v => update('windowMin', v)} marks={[60, 90, 120, 150]} />
      </Field>
    </div>
  );
};

/* ── 11. Signature ─────────────────────────────────────────── */
const SignatureStep = ({ data, setData, prefilled }) => {
  const canvasRef = React.useRef(null);
  const [drawing, setDrawing] = React.useState(false);
  const [hasInk, setHasInk] = React.useState(!!data.signed || prefilled);
  const [lastPoint, setLastPoint] = React.useState(null);

  React.useEffect(() => {
    if (!canvasRef.current) return;
    const cnv = canvasRef.current;
    const ctx = cnv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = cnv.getBoundingClientRect();
    cnv.width = rect.width * dpr;
    cnv.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (prefilled) {
      // Synthetic signature stroke
      ctx.beginPath();
      ctx.moveTo(30, 80);
      ctx.bezierCurveTo(60, 30, 80, 90, 110, 60);
      ctx.bezierCurveTo(140, 30, 170, 90, 200, 60);
      ctx.bezierCurveTo(220, 50, 240, 70, 260, 55);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(50, 95);
      ctx.lineTo(180, 95);
      ctx.stroke();
    }
  }, [prefilled]);

  const pt = (e) => {
    const cnv = canvasRef.current;
    const rect = cnv.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };
  const start = (e) => { e.preventDefault(); setDrawing(true); const p = pt(e); setLastPoint(p); };
  const move = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const p = pt(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setLastPoint(p);
    if (!hasInk) { setHasInk(true); setData({ ...data, signed: true }); }
  };
  const end = () => { setDrawing(false); setLastPoint(null); };
  const clear = () => {
    const cnv = canvasRef.current;
    cnv.getContext('2d').clearRect(0, 0, cnv.width, cnv.height);
    setHasInk(false);
    setData({ ...data, signed: false });
  };

  const operator = 'Aydın Demir';
  const role = 'Pilot in command';
  const stamp = '2026-05-16T08:47Z';

  return (
    <div className="wz-step-body">
      <Callout tone="info" title="Operator sign-off">
        By signing, you accept responsibility under §4.2 of the operations manual. Your signature is hashed together with the wizard data and sealed into the flight log.
      </Callout>

      <Card eyebrow="SIGNING AS" title={operator} headerRight={<StatusPill status="info" label="PiC" />}>
        <div className="wz-data-grid wz-data-grid--cols2">
          <DataRow label="Role" value={role} />
          <DataRow label="Certificate" value="VFF-PiC-2024-118" />
          <DataRow label="Timestamp" value={stamp} />
          <DataRow label="Bound to" value="package #P-2026-051611" />
        </div>
      </Card>

      <Field id="SIG-001" label="Signature" helper="Sign with your finger or stylus inside the box below." required status={hasInk ? 'ok' : 'empty'}>
        <div className="wz-sig">
          <canvas
            ref={canvasRef}
            className="wz-sig-canvas"
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          />
          <div className="wz-sig-baseline" aria-hidden="true">
            <span className="wz-sig-x">×</span>
            <span className="wz-sig-line"></span>
            <span className="wz-sig-hint">Sign here</span>
          </div>
          <button type="button" className="wz-sig-clear" onClick={clear}>Clear</button>
        </div>
      </Field>

      <Card eyebrow="WHAT WILL BE SEALED" tight>
        <code className="wz-codeblock">
          {`{
  "wizard":  "P-2026-051611",
  "signed_at": "${stamp}",
  "signer":  { "name": "Aydın Demir", "cert": "VFF-PiC-2024-118" },
  "hash":    "sha256:7e3b…f102",
  "fields":  37
}`}
        </code>
      </Card>
    </div>
  );
};

/* ── 12. Risk acceptance ───────────────────────────────────── */
const RiskStep = ({ data, setData, prefilled, summary }) => {
  const accepted = data.accepted || false;
  const briefingShown = data.briefingShown || false;
  const update = (k, v) => setData({ ...data, [k]: v });

  return (
    <div className="wz-step-body">
      <Callout tone="warn" title="Final review before drone control hand-off">
        Read each statement carefully. Acknowledging here cannot be undone from the field — you can only abort the launch.
      </Callout>

      <Card eyebrow="DERIVED RISK SUMMARY" title="Composite score" headerRight={<StatusPill status="ok" label="LOW · 2.4 / 10" />}>
        <div className="wz-risk-bar">
          <div className="wz-risk-bar-fill" style={{ width: '24%' }}></div>
          <div className="wz-risk-bar-marks">
            <span style={{ left: '30%' }}>caution</span>
            <span style={{ left: '70%' }}>high</span>
          </div>
        </div>
        <div className="wz-data-grid wz-data-grid--cols2">
          <DataRow label="Weather risk" value="0.8" status="ok"/>
          <DataRow label="Airspace risk" value="0.4" status="ok"/>
          <DataRow label="Site hazards" value="0.6" status="ok"/>
          <DataRow label="Equipment" value="0.6" status="ok"/>
        </div>
      </Card>

      <div className="wz-statements">
        {[
          'I understand the drone is tethered and will not exceed the parameters above.',
          'I confirm the launch area is clear and crew are at safe standoff distances.',
          'I have a current means of communication with the operations centre.',
          'I will abort if any field reading exceeds its declared safe envelope.',
        ].map((s, i) => (
          <ChoiceTile
            key={i}
            multi
            checked={accepted && i < 4}
            onChange={() => {/* checked as a single unit below */}}
            label={s}
            disabled
          />
        ))}
      </div>

      <Field id="RISK-001" label="Combined acknowledgment" helper="Single action — covers all four statements above." required status={accepted ? 'ok' : 'empty'}>
        <ChoiceTile
          multi
          checked={accepted}
          onChange={() => update('accepted', !accepted)}
          label="I accept the risk profile and authorise launch"
          sub="A copy of this acknowledgment is sent to the duty officer and sealed into the flight log."
        />
      </Field>
    </div>
  );
};

Object.assign(window, {
  PhotoStep, HazardsStep, CrewStep, ContactStep, ParametersStep, SignatureStep, RiskStep,
});
