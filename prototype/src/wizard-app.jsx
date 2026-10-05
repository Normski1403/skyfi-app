/* ────────────────────────────────────────────────────────────
   Sky-Fi Deployment Wizard — App shell
   Mobile-first, tablet-responsive.
   - Phone:  full-bleed step; top progress; sticky bottom Back/Next;
             drawer for step list.
   - Tablet: persistent left rail showing all steps with status.
──────────────────────────────────────────────────────────── */

const ALL_STEPS = [
  { id: 'location',   short: 'Location',      title: 'Confirm launch location',     type: 'input',    Comp: () => LocationStep,   canSkipPrefill: false },
  { id: 'weather',    short: 'Weather',       title: 'Environmental conditions',     type: 'review-auto', Comp: () => WeatherStep,  canSkipPrefill: false },
  { id: 'airspace',   short: 'Airspace',      title: 'Airspace clearance',          type: 'review-mix',  Comp: () => AirspaceStep, canSkipPrefill: false },
  { id: 'regulatory', short: 'Compliance',    title: 'Regulatory compliance',       type: 'review-prefilled', Comp: () => RegulatoryStep, canSkipPrefill: false },
  { id: 'approvals',  short: 'Approvals',     title: 'Deployment approvals',        type: 'review-mix',  Comp: () => ApprovalsStep, canSkipPrefill: false },
  { id: 'photo',      short: 'Site photos',   title: 'Launch site photographs',     type: 'input',    Comp: () => PhotoStep,      canSkipPrefill: true },
  { id: 'hazards',    short: 'Hazards',       title: 'On-site hazard assessment',   type: 'input',    Comp: () => HazardsStep,    canSkipPrefill: true },
  { id: 'crew',       short: 'Crew',          title: 'Operating crew',              type: 'input',    Comp: () => CrewStep,       canSkipPrefill: true },
  { id: 'contact',    short: 'Emergency',     title: 'Emergency contact',           type: 'input',    Comp: () => ContactStep,    canSkipPrefill: true },
  { id: 'parameters', short: 'Parameters',    title: 'Flight parameters',           type: 'input',    Comp: () => ParametersStep, canSkipPrefill: true },
  { id: 'signature',  short: 'Sign-off',      title: 'Operator sign-off',           type: 'input',    Comp: () => SignatureStep,  canSkipPrefill: false },
  { id: 'risk',       short: 'Risk',          title: 'Risk acceptance',             type: 'input',    Comp: () => RiskStep,       canSkipPrefill: false },
];

const STEP_VALIDATORS = {
  location:   (d) => !!d.pin && !!d.coords,
  weather:    (d) => !!d.agreed,
  airspace:   (d) => d.checks && d.checks.notam && d.checks.ctr && d.checks.mil && d.checks.emcomm,
  regulatory: (d) => !!d.acknowledged,
  approvals:  (d) => {
    if (d.country === 'GB') return !!(d.gb && d.gb.operatorId && d.gb.soraConfirmed);
    if (d.country === 'JM') return !!(d.jm && d.jm.confirmed);
    if (d.country === 'TR') return !!(d.tr && d.tr.confirmed);
    return false;
  },
  photo:      (d) => !!d.photo,
  hazards:    (d) => ['people','power','structures','water','fuel'].every(k => d.hazards && d.hazards[k]),
  crew:       (d) => (d.crew || []).length >= 2 && !!d.lead,
  contact:    (d) => d.contact && d.contact.name && d.contact.phone && d.contact.relation,
  parameters: (d) => (d.altitude != null) && (d.tether >= (d.altitude || 0)),
  signature:  (d) => !!d.signed,
  risk:       (d) => !!d.accepted,
};

const App = () => {
  const tweakDefaults = /*EDITMODE-BEGIN*/{
    "theme": "light",
    "stepCount": 12,
    "prefilledMode": "mixed"
  }/*EDITMODE-END*/;
  const [tweaks, setTweak] = useTweaks(tweakDefaults);

  // Step set adjusts based on the count tweak
  const activeSteps = React.useMemo(() => {
    const n = Math.min(Math.max(tweaks.stepCount || 12, 4), ALL_STEPS.length);
    // Keep first 3 (location, weather, airspace), last 3 (parameters, signature, risk)
    // when reducing — drop from the middle
    if (n === ALL_STEPS.length) return ALL_STEPS;
    const keepStart = ['location', 'weather', 'airspace'];
    const keepEnd   = ['parameters', 'signature', 'risk'];
    const middle = ALL_STEPS.filter(s => !keepStart.includes(s.id) && !keepEnd.includes(s.id));
    const middleNeed = Math.max(0, n - keepStart.length - keepEnd.length);
    const out = [
      ...ALL_STEPS.filter(s => keepStart.includes(s.id)),
      ...middle.slice(0, middleNeed),
      ...ALL_STEPS.filter(s => keepEnd.includes(s.id)),
    ];
    return out;
  }, [tweaks.stepCount]);

  const [stepIndex, setStepIndex] = React.useState(0);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [launched, setLaunched] = React.useState(false);

  // Per-step data store, keyed by step id
  const [allData, setAllData] = React.useState({});

  // Build initial prefill state when toggled
  React.useEffect(() => {
    const mode = tweaks.prefilledMode;
    const next = {};
    activeSteps.forEach((s, i) => {
      const isPrefilled = (
        mode === 'all' ? true :
        mode === 'none' ? false :
        // mixed: review-type steps + first 4 input steps prefilled
        s.type !== 'input' || ['photo','crew','contact','parameters'].includes(s.id)
      );
      next[s.id] = { __prefilled: isPrefilled, ...((allData[s.id] && allData[s.id].__prefilled === isPrefilled) ? allData[s.id] : {}) };
    });
    setAllData(next);
    setStepIndex(0);
    setLaunched(false);
  }, [tweaks.prefilledMode, tweaks.stepCount]);

  React.useEffect(() => {
    document.documentElement.dataset.theme = tweaks.theme;
  }, [tweaks.theme]);

  // Clamp the step index when activeSteps changes
  React.useEffect(() => {
    if (stepIndex >= activeSteps.length) setStepIndex(activeSteps.length - 1);
  }, [activeSteps.length]);

  const step = activeSteps[stepIndex];
  const stepData = allData[step?.id] || {};
  const setStepData = React.useCallback((updater) => {
    setAllData(prev => {
      const cur = prev[step.id] || {};
      const next = typeof updater === 'function' ? updater(cur) : { ...cur, ...updater };
      return { ...prev, [step.id]: { ...next, __prefilled: cur.__prefilled } };
    });
  }, [step?.id]);

  const stepStatus = (s) => {
    const d = allData[s.id] || {};
    const v = STEP_VALIDATORS[s.id];
    if (v && v(d)) return 'complete';
    if (d.__prefilled) return 'review';
    return 'pending';
  };

  const allComplete = activeSteps.every(s => stepStatus(s) === 'complete');
  const canAdvance = STEP_VALIDATORS[step?.id] ? STEP_VALIDATORS[step.id](stepData) : true;

  const goNext = () => {
    if (stepIndex === activeSteps.length - 1) {
      setLaunched(true);
    } else {
      setStepIndex(stepIndex + 1);
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.querySelector('.wz-scroll')?.scrollTo({ top: 0 });
    }
  };
  const goBack = () => {
    if (stepIndex > 0) {
      setStepIndex(stepIndex - 1);
      document.querySelector('.wz-scroll')?.scrollTo({ top: 0 });
    }
  };

  if (launched) {
    return <LaunchHandoff steps={activeSteps} data={allData} onReset={() => { setLaunched(false); setStepIndex(0); }} />;
  }

  const StepComp = step.Comp();
  const completedCount = activeSteps.filter(s => stepStatus(s) === 'complete').length;
  const pctComplete = Math.round(completedCount / activeSteps.length * 100);

  return (
    <div className="wz-app" data-theme={tweaks.theme}>
      {/* Left rail (tablet+) */}
      <aside className="wz-rail">
        <RailHeader pkg="P-2026-051611" pctComplete={pctComplete} />
        <ol className="wz-rail-list">
          {activeSteps.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className={"wz-rail-item" + (i === stepIndex ? " wz-rail-item--active" : "")}
                onClick={() => setStepIndex(i)}
                aria-current={i === stepIndex ? 'step' : undefined}
              >
                <StepStatusGlyph index={i} status={stepStatus(s)} active={i === stepIndex} />
                <span className="wz-rail-text">
                  <span className="wz-rail-name">{s.short}</span>
                  <span className="wz-rail-meta">{stepLabelForStatus(stepStatus(s), s.type)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <footer className="wz-rail-footer">
          <div className="wz-rail-footer-row">
            <span>Auto-save</span>
            <code>00:14 ago</code>
          </div>
          <div className="wz-rail-footer-row">
            <span>Reviewer</span>
            <code>Ops centre · Ankara</code>
          </div>
        </footer>
      </aside>

      {/* Drawer (phone) */}
      {drawerOpen && (
        <div className="wz-drawer" onClick={() => setDrawerOpen(false)}>
          <div className="wz-drawer-panel" onClick={e => e.stopPropagation()}>
            <header className="wz-drawer-header">
              <span>Wizard steps</span>
              <button type="button" onClick={() => setDrawerOpen(false)} className="wz-iconbtn" aria-label="Close">×</button>
            </header>
            <ol className="wz-rail-list">
              {activeSteps.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={"wz-rail-item" + (i === stepIndex ? " wz-rail-item--active" : "")}
                    onClick={() => { setStepIndex(i); setDrawerOpen(false); }}
                  >
                    <StepStatusGlyph index={i} status={stepStatus(s)} active={i === stepIndex} />
                    <span className="wz-rail-text">
                      <span className="wz-rail-name">{s.short}</span>
                      <span className="wz-rail-meta">{stepLabelForStatus(stepStatus(s), s.type)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {/* Main column */}
      <main className="wz-main">
        <header className="wz-topbar">
          <div className="wz-topbar-left">
            <button className="wz-iconbtn wz-topbar-menu" type="button" onClick={() => setDrawerOpen(true)} aria-label="Open step list">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <div className="wz-topbar-title">
              <div className="wz-topbar-eyebrow">
                <SkyFiMark />
                <span>Sky-Fi · Virtual mast wizard</span>
              </div>
            </div>
          </div>
          <div className="wz-topbar-right">
            <span className="wz-topbar-pkg">
              <span className="wz-topbar-pkg-label">Package</span>
              <code>P-2026-051611</code>
            </span>
            <StatusPill status="info" label={`${completedCount}/${activeSteps.length} READY`} />
          </div>
        </header>

        {/* Progress strip */}
        <div className="wz-progress">
          <div className="wz-progress-bar">
            <div className="wz-progress-fill" style={{ width: pctComplete + '%' }}/>
          </div>
          <div className="wz-progress-meta">
            <span>Step <strong>{stepIndex + 1}</strong> of <strong>{activeSteps.length}</strong></span>
            <span className="wz-progress-spacer">·</span>
            <span>{step.short}</span>
          </div>
        </div>

        <div className="wz-scroll">
          {/* Step header card */}
          <header className="wz-stephead">
            <div className="wz-stephead-row">
              <div className="wz-stephead-num">
                <span className="wz-stephead-num-current">{String(stepIndex + 1).padStart(2, '0')}</span>
                <span className="wz-stephead-num-total">/ {String(activeSteps.length).padStart(2, '0')}</span>
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
                status={
                  stepStatus(step) === 'complete' ? 'ok' :
                  stepStatus(step) === 'review' ? 'info' : 'pending'
                }
                label={stepLabelForStatus(stepStatus(step), step.type)}
              />
            </div>
          </header>

          <div className="wz-step-content">
            <StepComp
              data={stepData}
              setData={setStepData}
              prefilled={!!stepData.__prefilled}
              key={step.id + ':' + (stepData.__prefilled ? 'p' : 'f')}
            />
          </div>

          <div className="wz-step-spacer" aria-hidden="true"></div>
        </div>

        {/* Sticky footer */}
        <footer className="wz-footer">
          <button type="button" className="wz-btn wz-btn--ghost" onClick={goBack} disabled={stepIndex === 0}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          <div className="wz-footer-state">
            {!canAdvance && (
              <span className="wz-footer-hint">
                <span className="wz-footer-hint-dot"></span>
                {stepData.__prefilled ? 'Acknowledge to continue' : 'Complete required fields'}
              </span>
            )}
            {canAdvance && stepData.__prefilled && (
              <span className="wz-footer-hint wz-footer-hint--ok">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                Ready · confirm to continue
              </span>
            )}
          </div>
          <button
            type="button"
            className="wz-btn wz-btn--primary"
            onClick={goNext}
            disabled={!canAdvance}
          >
            {stepIndex === activeSteps.length - 1 ? 'Seal & hand off' :
             stepData.__prefilled ? 'Agree & continue' : 'Continue'}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </footer>
      </main>

      {/* Tweaks panel (mounted; visible only when host activates edit mode) */}
      <WizardTweaksPanel tweaks={tweaks} setTweak={setTweak} />
    </div>
  );
};

const stepLabelForStatus = (status, type) => {
  if (status === 'complete') return 'COMPLETE';
  if (status === 'review') return type === 'review-prefilled' ? 'PRE-FILLED' : type === 'review-auto' ? 'AUTO' : 'READY TO REVIEW';
  return 'PENDING';
};

// Step status glyph (circle in the rail)
const StepStatusGlyph = ({ index, status, active }) => {
  return (
    <span className={"wz-rail-glyph wz-rail-glyph--" + status + (active ? " wz-rail-glyph--active" : "")}>
      {status === 'complete' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      ) : status === 'review' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>
      ) : (
        <span>{String(index + 1).padStart(2, '0')}</span>
      )}
    </span>
  );
};

const SkyFiMark = () => (
  <svg width="22" height="22" viewBox="0 0 96 96" fill="none" aria-hidden="true">
    <rect width="96" height="96" rx="22" fill="var(--vf-red)"/>
    <g transform="translate(16 16)" stroke="white" fill="white">
      <g fill="none" strokeWidth="5" strokeLinecap="round">
        <line x1="32" y1="32" x2="14" y2="14"/>
        <line x1="32" y1="32" x2="50" y2="14"/>
        <line x1="32" y1="32" x2="14" y2="50"/>
        <line x1="32" y1="32" x2="50" y2="50"/>
        <circle cx="13" cy="13" r="10"/>
        <circle cx="51" cy="13" r="10"/>
        <circle cx="13" cy="51" r="10"/>
        <circle cx="51" cy="51" r="10"/>
      </g>
      <rect x="24" y="24" width="16" height="16" rx="5"/>
    </g>
  </svg>
);

const RailHeader = ({ pkg, pctComplete }) => (
  <header className="wz-rail-header">
    <div className="wz-rail-eyebrow">
      <SkyFiMark/>
      <span>Sky-Fi</span>
    </div>
    <div className="wz-rail-title">Deployment wizard</div>
    <div className="wz-rail-pkg">
      <span>Package</span>
      <code>{pkg}</code>
    </div>
    <div className="wz-rail-progress">
      <div className="wz-rail-progress-bar"><div className="wz-rail-progress-fill" style={{ width: pctComplete + '%' }}/></div>
      <span className="wz-rail-progress-pct">{pctComplete}%</span>
    </div>
  </header>
);

/* ── LAUNCH HANDOFF ──────────────────────────────────────────
   Confirmation, sealing, telemetry monitor, hand-off animation.
──────────────────────────────────────────────────────────── */
const LaunchHandoff = ({ steps, data, onReset }) => {
  const [phase, setPhase] = React.useState('sealing'); // sealing → sealed → handoff → monitoring
  const [hash, setHash] = React.useState('');
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    if (phase === 'sealing') {
      const t = setTimeout(() => {
        setHash('sha256:7e3b4f8a1c92d0e6f102…');
        setPhase('sealed');
      }, 1600);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const handOff = () => {
    setPhase('handoff');
    setTimeout(() => setPhase('monitoring'), 2400);
  };

  React.useEffect(() => {
    if (phase === 'monitoring') {
      let p = 0;
      const i = setInterval(() => { p = Math.min(100, p + 3); setProgress(p); if (p >= 100) clearInterval(i); }, 60);
      return () => clearInterval(i);
    }
  }, [phase]);

  const altitude = data.parameters?.altitude ?? 95;
  const tether   = data.parameters?.tether   ?? 100;
  const windowM  = data.parameters?.windowMin ?? 45;
  const coords   = data.location?.coords;

  return (
    <div className="wz-handoff">
      <header className="wz-topbar wz-topbar--handoff">
        <div className="wz-topbar-left">
          <SkyFiMark/>
          <span className="wz-topbar-eyebrow">Sky-Fi · Virtual mast wizard</span>
        </div>
        <div className="wz-topbar-right">
          <StatusPill
            status={phase === 'monitoring' ? 'ok' : phase === 'handoff' ? 'info' : 'info'}
            label={phase === 'sealing' ? 'SEALING' : phase === 'sealed' ? 'SEALED' : phase === 'handoff' ? 'HANDING OFF' : 'MONITORING'}
          />
        </div>
      </header>

      <div className="wz-handoff-body">
        {/* Centerpiece */}
        <div className="wz-handoff-hero" data-phase={phase}>
          <div className="wz-handoff-seal">
            <svg viewBox="0 0 120 120" className="wz-handoff-seal-svg">
              <circle cx="60" cy="60" r="56" fill="none" stroke="var(--vf-red)" strokeWidth="2" strokeDasharray="2 4" opacity="0.6"/>
              <circle cx="60" cy="60" r="46" fill="var(--vf-red)" />
              {phase === 'sealing' ? (
                <g transform="translate(60 60)">
                  <circle r="20" fill="none" stroke="white" strokeWidth="3" strokeDasharray="40 100" opacity="0.6">
                    <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1.2s" repeatCount="indefinite"/>
                  </circle>
                </g>
              ) : (
                <g transform="translate(60 60)" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none">
                  <polyline points="-16 0 -4 12 18 -10"/>
                </g>
              )}
            </svg>
            {(phase === 'handoff' || phase === 'monitoring') && (
              <div className="wz-handoff-pulse"></div>
            )}
          </div>

          <h1 className="wz-handoff-title">
            {phase === 'sealing'    && 'Sealing flight package…'}
            {phase === 'sealed'     && 'Flight package sealed'}
            {phase === 'handoff'    && 'Handing off to flight control…'}
            {phase === 'monitoring' && 'Drone control system has the package'}
          </h1>
          <p className="wz-handoff-sub">
            {phase === 'sealing'    && 'Hashing wizard data, signatures, and acknowledgments. Do not navigate away.'}
            {phase === 'sealed'     && 'Cryptographically sealed and signed by the pilot in command. Ready for hand-off.'}
            {phase === 'handoff'    && 'Transferring package over secure channel to the launch authority.'}
            {phase === 'monitoring' && 'Telemetry stream is live. Flight logs are being recorded to the foundation operations centre.'}
          </p>
        </div>

        {/* Summary */}
        <div className="wz-handoff-summary">
          <Card eyebrow="FLIGHT PACKAGE" title="P-2026-051611" headerRight={<StatusPill status={phase === 'sealing' ? 'info' : 'ok'} label={phase === 'sealing' ? 'COMPUTING' : 'SEALED'} />}>
            <div className="wz-data-grid wz-data-grid--cols2">
              <DataRow label="Launch site" value={coords ? `${coords.lat}°N ${coords.lng}°E` : 'Antakya — Sector 4'} />
              <DataRow label="Sealed at" value="2026-05-16T08:47Z" />
              <DataRow label="Target altitude" value={altitude} unit="m AGL" />
              <DataRow label="Tether length" value={tether} unit="m" />
              <DataRow label="Flight window" value={windowM} unit="min" />
              <DataRow label="Steps signed" value={steps.length} />
              <DataRow label="Hash" value={hash || '…'} />
              <DataRow label="Pilot in command" value="Aydın Demir" />
            </div>
          </Card>

          {(phase === 'sealed' || phase === 'sealing') && (
            <button type="button" className="wz-btn wz-btn--primary wz-btn--xl" onClick={handOff} disabled={phase === 'sealing'}>
              {phase === 'sealing' ? 'Sealing…' : 'Hand off to flight control'}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
            </button>
          )}

          {phase === 'monitoring' && (
            <>
              <Card eyebrow="MONITORING" title="Live telemetry · pre-launch" headerRight={<StatusPill status="ok" label="ARMED"/>}>
                <div className="wz-telemetry">
                  <div className="wz-telemetry-row">
                    <span>Pre-flight stream</span>
                    <div className="wz-telemetry-bar"><div className="wz-telemetry-fill" style={{ width: progress + '%' }}></div></div>
                    <code>{progress}%</code>
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

              <div className="wz-handoff-actions">
                <button type="button" className="wz-btn wz-btn--primary wz-btn--xl">
                  Open mission monitor
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
                </button>
                <button type="button" className="wz-btn wz-btn--ghost" onClick={onReset}>
                  Start a new package
                </button>
              </div>

              <Callout tone="info" title="What happens next">
                The drone control system will run its own pre-flight verification, then prompt the PiC to authorise launch. Flight logs, telemetry, and the sealed package are stored at the foundation operations centre for the duration of the mission and 7 years thereafter.
              </Callout>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const Spark = ({ seed = 1, ok }) => {
  const pts = React.useMemo(() => {
    const r = (i) => (Math.sin(seed * 13.7 + i * 1.31) + 1) * 0.5;
    return Array.from({ length: 32 }).map((_, i) => 4 + r(i) * 14).map((v, i) => `${i * (100/31)},${20 - v}`).join(' ');
  }, [seed]);
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={ok ? 'var(--sf-signal-green)' : 'var(--sf-sky-blue)'} strokeWidth="1.4"/>
    </svg>
  );
};

/* ── TWEAKS PANEL ──────────────────────────────────────────── */
const WizardTweaksPanel = ({ tweaks, setTweak }) => (
  <TweaksPanel>
    <TweakSection label="Theme">
      <TweakRadio
        label="Mode"
        value={tweaks.theme}
        onChange={v => setTweak('theme', v)}
        options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
      />
    </TweakSection>

    <TweakSection label="Flow">
      <TweakSlider
        label="Steps"
        value={tweaks.stepCount}
        onChange={v => setTweak('stepCount', v)}
        min={6} max={12} step={1}
        unit=" steps"
      />
      <TweakSelect
        label="Pre-filled"
        value={tweaks.prefilledMode}
        onChange={v => setTweak('prefilledMode', v)}
        options={[
          { value: 'mixed', label: 'Mixed (realistic)' },
          { value: 'all',   label: 'All pre-filled (review)' },
          { value: 'none',  label: 'Fresh — nothing pre-filled' },
        ]}
      />
    </TweakSection>
  </TweaksPanel>
);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
