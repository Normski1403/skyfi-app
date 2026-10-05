/* ────────────────────────────────────────────────────────────
   Sky-Fi Wizard — Print entry
   Renders every step + the launch handoff as separate pages
   with realistic pre-filled data so the PDF shows the full
   flow at a glance.
──────────────────────────────────────────────────────────── */

const PRINT_STEPS = [
  { id: 'location',   short: 'Location',   title: 'Confirm launch location',   type: 'input', Comp: () => LocationStep },
  { id: 'weather',    short: 'Weather',    title: 'Environmental conditions',  type: 'review-auto', Comp: () => WeatherStep },
  { id: 'airspace',   short: 'Airspace',   title: 'Airspace clearance',        type: 'review-mix', Comp: () => AirspaceStep },
  { id: 'regulatory', short: 'Compliance', title: 'Regulatory compliance',     type: 'review-prefilled', Comp: () => RegulatoryStep },
  { id: 'approvals',  short: 'Approvals',  title: 'Deployment approvals',      type: 'review-mix', Comp: () => ApprovalsStep },
  { id: 'photo',      short: 'Site photos',title: 'Launch site photographs',   type: 'input', Comp: () => PhotoStep },
  { id: 'hazards',    short: 'Hazards',    title: 'On-site hazard assessment', type: 'input', Comp: () => HazardsStep },
  { id: 'crew',       short: 'Crew',       title: 'Operating crew',            type: 'input', Comp: () => CrewStep },
  { id: 'contact',    short: 'Emergency',  title: 'Emergency contact',         type: 'input', Comp: () => ContactStep },
  { id: 'parameters', short: 'Parameters', title: 'Flight parameters',         type: 'input', Comp: () => ParametersStep },
  { id: 'signature',  short: 'Sign-off',   title: 'Operator sign-off',         type: 'input', Comp: () => SignatureStep },
  { id: 'risk',       short: 'Risk',       title: 'Risk acceptance',           type: 'input', Comp: () => RiskStep },
];

// Realistic pre-filled data for each step
const PRINT_DATA = {
  location:   { pin: { x: 0.62, y: 0.41 }, coords: { lat: 36.1408, lng: 36.1219 }, zone: 'Antakya — Sector 4', __prefilled: true },
  weather:    { fetched: true, timestamp: '2026-05-16T08:42Z', agreed: true, __prefilled: true },
  airspace:   { checks: { notam: true, ctr: true, mil: true, emcomm: true }, __prefilled: false },
  regulatory: { acknowledged: true, __prefilled: true },
  approvals:  { country: 'TR', tr: { confirmed: true }, __prefilled: true },
  photo:      { photo: { synthetic: true }, meta: { ts: '2026-05-16T08:39Z', heading: 218, count: 3 }, __prefilled: true },
  hazards:    { hazards: {
                  people: 'Beyond 50 m, marshalled',
                  power: 'None visible',
                  structures: 'None within 150 m',
                  water: 'None',
                  fuel: 'None within 30 m',
                }, __prefilled: false },
  crew:       { crew: ['lead', 'observer', 'rf', 'liaison'], lead: 'lead', __prefilled: true },
  contact:    { contact: {
                  name: 'Operations Centre — Ankara',
                  role: 'Foundation duty officer',
                  phone: '+90 312 555 0118',
                  altPhone: '+90 532 555 0034',
                  relation: 'dispatch',
                  confirmed: true,
                }, __prefilled: true },
  parameters: { altitude: 95, tether: 100, windowMin: 45, __prefilled: true },
  signature:  { signed: true, __prefilled: false },
  risk:       { accepted: true, __prefilled: false },
};

const PrintPage = ({ step, index, total, data }) => {
  const StepComp = step.Comp();
  const status = step.type === 'input' && !data.__prefilled ? 'fresh' : 'pre-filled';
  const pct = Math.round((index + 1) / total * 100);

  return (
    <section className="wz-print-page">
      <div className="wz-app" data-theme="light">
        <main className="wz-main">
          <header className="wz-topbar">
            <div className="wz-topbar-left">
              <SkyFiMark/>
              <div className="wz-topbar-title">
                <div className="wz-topbar-eyebrow">
                  <span>Sky-Fi · Virtual mast wizard</span>
                </div>
              </div>
            </div>
            <div className="wz-topbar-right">
              <span className="wz-topbar-pkg">
                <span className="wz-topbar-pkg-label">Package</span>
                <code>P-2026-051611</code>
              </span>
              <StatusPill status="info" label={`${index + 1}/${total} READY`} />
            </div>
          </header>

          <div className="wz-progress">
            <div className="wz-progress-bar">
              <div className="wz-progress-fill" style={{ width: pct + '%' }}/>
            </div>
            <div className="wz-progress-meta">
              <span>Step <strong>{index + 1}</strong> of <strong>{total}</strong></span>
              <span className="wz-progress-spacer">·</span>
              <span>{step.short}</span>
            </div>
          </div>

          <div className="wz-scroll">
            <header className="wz-stephead">
              <div className="wz-stephead-row">
                <div className="wz-stephead-num">
                  <span className="wz-stephead-num-current">{String(index + 1).padStart(2, '0')}</span>
                  <span className="wz-stephead-num-total">/ {String(total).padStart(2, '0')}</span>
                </div>
                <div className="wz-stephead-text">
                  <div className="wz-stephead-eyebrow">
                    {step.type === 'review-auto' ? 'Automated · review' :
                     step.type === 'review-prefilled' ? 'Pre-filled by dispatch · review' :
                     step.type === 'review-mix' ? 'Auto-checked · with manual confirms' :
                     'Field input required'}
                  </div>
                  <h1 className="wz-stephead-title">{step.title}</h1>
                </div>
                <StatusPill
                  status={status === 'pre-filled' ? 'info' : 'ok'}
                  label={status === 'pre-filled' ? 'PRE-FILLED' : 'COMPLETE'}
                />
              </div>
            </header>

            <div className="wz-step-content">
              <StepComp
                data={data}
                setData={() => {}}
                prefilled={!!data.__prefilled}
              />
            </div>
          </div>

          <footer className="wz-footer wz-footer--print">
            <button type="button" className="wz-btn wz-btn--ghost" disabled={index === 0}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
              Back
            </button>
            <div className="wz-footer-state">
              <span className="wz-footer-hint wz-footer-hint--ok">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                Ready · confirm to continue
              </span>
            </div>
            <button type="button" className="wz-btn wz-btn--primary">
              {index === total - 1 ? 'Seal & hand off' : data.__prefilled ? 'Agree & continue' : 'Continue'}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </footer>
        </main>
      </div>
      <footer className="wz-print-footer">
        <span>Sky-Fi · Virtual Mast Wizard — design review</span>
        <span>Step {index + 1} of {total + 1}</span>
      </footer>
    </section>
  );
};

// Static handoff page (uses the monitoring/sealed phase)
const PrintHandoffPage = ({ index, total }) => {
  return (
    <section className="wz-print-page">
      <div className="wz-handoff" data-theme="light">
        <header className="wz-topbar wz-topbar--handoff">
          <div className="wz-topbar-left">
            <SkyFiMark/>
            <span className="wz-topbar-eyebrow">Sky-Fi · Virtual mast wizard</span>
          </div>
          <div className="wz-topbar-right">
            <StatusPill status="ok" label="MONITORING" />
          </div>
        </header>
        <div className="wz-handoff-body">
          <div className="wz-handoff-hero">
            <div className="wz-handoff-seal">
              <svg viewBox="0 0 120 120" className="wz-handoff-seal-svg">
                <circle cx="60" cy="60" r="56" fill="none" stroke="var(--vf-red)" strokeWidth="2" strokeDasharray="2 4" opacity="0.6"/>
                <circle cx="60" cy="60" r="46" fill="var(--vf-red)" />
                <g transform="translate(60 60)" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none">
                  <polyline points="-16 0 -4 12 18 -10"/>
                </g>
              </svg>
            </div>
            <h1 className="wz-handoff-title">Drone control system has the package</h1>
            <p className="wz-handoff-sub">Telemetry stream is live. Flight logs are being recorded to the foundation operations centre.</p>
          </div>

          <div className="wz-handoff-summary">
            <Card eyebrow="FLIGHT PACKAGE" title="P-2026-051611" headerRight={<StatusPill status="ok" label="SEALED" />}>
              <div className="wz-data-grid wz-data-grid--cols2">
                <DataRow label="Launch site" value="36.1408°N 36.1219°E" />
                <DataRow label="Sealed at" value="2026-05-16T08:47Z" />
                <DataRow label="Target altitude" value={95} unit="m AGL" />
                <DataRow label="Tether length" value={100} unit="m" />
                <DataRow label="Flight window" value={45} unit="min" />
                <DataRow label="Steps signed" value={total} />
                <DataRow label="Hash" value="sha256:7e3b4f8a1c92d0e6f102…" />
                <DataRow label="Pilot in command" value="Aydın Demir" />
              </div>
            </Card>

            <Card eyebrow="MONITORING" title="Live telemetry · pre-launch" headerRight={<StatusPill status="ok" label="ARMED"/>}>
              <div className="wz-telemetry">
                <div className="wz-telemetry-row">
                  <span>Pre-flight stream</span>
                  <div className="wz-telemetry-bar"><div className="wz-telemetry-fill" style={{ width: '100%' }}></div></div>
                  <code>100%</code>
                </div>
                <div className="wz-telemetry-row">
                  <span>Tether tension</span>
                  <div className="wz-spark"><Spark seed={1}/></div>
                  <code>OK</code>
                </div>
                <div className="wz-telemetry-row">
                  <span>GPS lock</span>
                  <div className="wz-spark"><Spark seed={2}/></div>
                  <code>12 sat</code>
                </div>
                <div className="wz-telemetry-row">
                  <span>Link to ops centre</span>
                  <div className="wz-spark"><Spark seed={3} ok/></div>
                  <code>2.4 ms</code>
                </div>
              </div>
            </Card>

            <Card eyebrow="FLIGHT LOG" title="Recording started · stored to ops-centre" tight>
              <div className="wz-log">
                {[
                  { t: '08:47:03Z', tag: 'INFO',  msg: 'Package P-2026-051611 sealed and verified' },
                  { t: '08:47:04Z', tag: 'INFO',  msg: 'Handoff acknowledged by drone control system' },
                  { t: '08:47:05Z', tag: 'INFO',  msg: 'Telemetry stream opened on channel TM-A12' },
                  { t: '08:47:06Z', tag: 'INFO',  msg: 'Flight log persistence enabled (ops-centre + on-board)' },
                  { t: '08:47:07Z', tag: 'OK',    msg: 'Pre-flight self-check passed' },
                  { t: '08:47:08Z', tag: 'READY', msg: 'Awaiting launch command from PiC' },
                ].map((l, i) => (
                  <div key={i} className="wz-log-line">
                    <code>{l.t}</code>
                    <span className={"wz-log-tag wz-log-tag--" + l.tag.toLowerCase()}>{l.tag}</span>
                    <span>{l.msg}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>
      <footer className="wz-print-footer">
        <span>Sky-Fi · Virtual Mast Wizard — design review</span>
        <span>Step {index + 1} of {total + 1}</span>
      </footer>
    </section>
  );
};

const PrintCover = ({ total }) => (
  <section className="wz-print-page wz-print-cover">
    <div className="wz-print-cover-body">
      <div className="wz-print-cover-mark"><SkyFiMark/><span>Sky-Fi</span></div>
      <h1>Virtual Mast Wizard</h1>
      <p className="wz-print-cover-sub">
        Mobile-first deployment wizard for tethered communications drones.<br/>
        Design review · {total} steps · launch handoff
      </p>
      <div className="wz-print-cover-meta">
        <div><span>Package</span><code>P-2026-051611</code></div>
        <div><span>Operation</span><code>Hatay relief — phase 3</code></div>
        <div><span>Generated</span><code>2026-05-19</code></div>
        <div><span>Pilot in command</span><code>Aydın Demir</code></div>
      </div>
      <ol className="wz-print-cover-toc">
        {PRINT_STEPS.map((s, i) => (
          <li key={s.id}>
            <span className="wz-print-cover-toc-n">{String(i + 1).padStart(2, '0')}</span>
            <span className="wz-print-cover-toc-name">{s.short}</span>
            <span className="wz-print-cover-toc-type">
              {s.type === 'review-auto' ? 'Automated' :
               s.type === 'review-prefilled' ? 'Pre-filled' :
               s.type === 'review-mix' ? 'Auto + manual' : 'Field input'}
            </span>
          </li>
        ))}
        <li>
          <span className="wz-print-cover-toc-n">{String(total + 1).padStart(2, '0')}</span>
          <span className="wz-print-cover-toc-name">Launch handoff</span>
          <span className="wz-print-cover-toc-type">Telemetry &amp; flight log</span>
        </li>
      </ol>
    </div>
    <footer className="wz-print-footer">
      <span>Sky-Fi · Virtual Mast Wizard — design review</span>
      <span>Cover</span>
    </footer>
  </section>
);

const PrintApp = () => {
  const total = PRINT_STEPS.length;
  return (
    <>
      <PrintCover total={total} />
      {PRINT_STEPS.map((step, i) => (
        <PrintPage key={step.id} step={step} index={i} total={total} data={PRINT_DATA[step.id]} />
      ))}
      <PrintHandoffPage index={total} total={total} />
    </>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<PrintApp/>);

// Auto-print once fonts + Babel are settled
(async () => {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
  await new Promise(r => setTimeout(r, 800));
  window.print();
})();
