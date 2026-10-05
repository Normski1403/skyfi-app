/* ────────────────────────────────────────────────────────────
   Sky-Fi Deployment Wizard — Shared UI primitives
   Used by step components. Technical-leaning: clear labels,
   monospaced data values, explicit field IDs, visible validation.
──────────────────────────────────────────────────────────── */

// ── Field wrapper: label, ref-code, helper, error, value
const Field = ({ id, label, helper, error, status, required, children, valuePlayback }) => {
  return (
    <div className="wz-field" data-status={status || 'empty'}>
      <div className="wz-field-header">
        <label htmlFor={id} className="wz-field-label">
          {label}
          {required && <span className="wz-field-required" aria-label="required">*</span>}
        </label>
        <code className="wz-field-ref">{id}</code>
      </div>
      {helper && <div className="wz-field-helper">{helper}</div>}
      {valuePlayback && (
        <div className="wz-field-playback">
          <span className="wz-field-playback-tag">RECORDED</span>
          <span className="wz-field-playback-value">{valuePlayback}</span>
        </div>
      )}
      <div className="wz-field-control">{children}</div>
      {error && <div className="wz-field-error" role="alert">{error}</div>}
    </div>
  );
};

// ── Data row (key/value, mono value) — used for read-only telemetry
const DataRow = ({ label, value, unit, status }) => (
  <div className="wz-data-row" data-status={status || 'ok'}>
    <span className="wz-data-label">{label}</span>
    <span className="wz-data-value">
      <span className="wz-data-number">{value}</span>
      {unit && <span className="wz-data-unit">{unit}</span>}
    </span>
  </div>
);

// ── Status pill
const StatusPill = ({ status, label }) => {
  // status: ok | warn | error | info | pending | prefilled | locked
  return (
    <span className="wz-pill" data-status={status}>
      <span className="wz-pill-dot" aria-hidden="true"></span>
      {label || status.toUpperCase()}
    </span>
  );
};

// ── Section card
const Card = ({ title, eyebrow, headerRight, children, tight, dataSource }) => (
  <section className={"wz-card" + (tight ? " wz-card--tight" : "")}>
    {(title || eyebrow || headerRight) && (
      <header className="wz-card-header">
        <div>
          {eyebrow && <div className="wz-card-eyebrow">{eyebrow}</div>}
          {title && <h3 className="wz-card-title">{title}</h3>}
        </div>
        {headerRight}
      </header>
    )}
    {children}
    {dataSource && (
      <footer className="wz-card-footer">
        <span className="wz-card-footer-label">Source</span>
        <code className="wz-card-footer-value">{dataSource}</code>
      </footer>
    )}
  </section>
);

// ── Inline help / callout banner
const Callout = ({ tone, title, children, icon }) => (
  <div className="wz-callout" data-tone={tone || 'info'}>
    <div className="wz-callout-icon" aria-hidden="true">{icon || (tone === 'warn' ? '!' : tone === 'error' ? '×' : 'i')}</div>
    <div className="wz-callout-body">
      {title && <div className="wz-callout-title">{title}</div>}
      <div className="wz-callout-text">{children}</div>
    </div>
  </div>
);

// ── Choice tile — used for radio / multi-select option lists
const ChoiceTile = ({ checked, multi, label, sub, value, onChange, severity, disabled }) => (
  <label className={"wz-choice" + (checked ? " wz-choice--checked" : "") + (disabled ? " wz-choice--disabled" : "")} data-severity={severity}>
    <input
      type={multi ? "checkbox" : "radio"}
      checked={!!checked}
      onChange={() => !disabled && onChange(value)}
      disabled={disabled}
      className="wz-choice-input"
    />
    <span className="wz-choice-mark" aria-hidden="true"></span>
    <span className="wz-choice-body">
      <span className="wz-choice-label">{label}</span>
      {sub && <span className="wz-choice-sub">{sub}</span>}
    </span>
  </label>
);

// ── Text input
const TextInput = React.forwardRef(({ id, value, onChange, placeholder, type='text', inputMode, maxLength, prefix, suffix }, ref) => (
  <div className="wz-input-wrap">
    {prefix && <span className="wz-input-prefix">{prefix}</span>}
    <input
      ref={ref}
      id={id}
      type={type}
      inputMode={inputMode}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className="wz-input"
    />
    {suffix && <span className="wz-input-suffix">{suffix}</span>}
  </div>
));

// ── Select (dropdown) — used when the option list is long or open-ended
const Select = ({ id, value, onChange, options, placeholder }) => (
  <div className="wz-select-wrap">
    <select id={id} value={value || ''} onChange={e => onChange(e.target.value)} className="wz-select">
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

// ── Stepped value indicator (used by sliders)
const NumberDisplay = ({ value, unit, size='lg' }) => (
  <div className={"wz-numdisplay wz-numdisplay--" + size}>
    <span className="wz-numdisplay-value">{value}</span>
    {unit && <span className="wz-numdisplay-unit">{unit}</span>}
  </div>
);

// ── Slider with tick + range labels
const RangeSlider = ({ id, min, max, step, value, onChange, marks }) => {
  const pct = (v) => ((v - min) / (max - min)) * 100;
  return (
    <div className="wz-slider">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="wz-slider-input"
        style={{ '--pct': pct(value) + '%' }}
      />
      <div className="wz-slider-scale">
        <span className="wz-slider-tick wz-slider-tick--min">{min}</span>
        {marks && marks.map((m, i) => (
          <span key={i} className="wz-slider-tick wz-slider-mark" style={{ left: pct(m) + '%' }}>{m}</span>
        ))}
        <span className="wz-slider-tick wz-slider-tick--max">{max}</span>
      </div>
    </div>
  );
};

Object.assign(window, {
  Field, DataRow, StatusPill, Card, Callout, ChoiceTile, TextInput, Select, NumberDisplay, RangeSlider,
});
