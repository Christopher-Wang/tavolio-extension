/**
 * One design language for every host. Plain CSS in a string so each host
 * bundle (Apps Script single-file HTML, Office task pane) needs no CSS
 * pipeline. Designed at 300px (Sheets sidebar) and reflows wider (Excel).
 */
export const css = /* css */ `
.tv {
  --bg: #ffffff;
  --surface: #f6f6f3;
  --surface-2: #efeeea;
  --border: #e4e2dc;
  --text: #1d1c1a;
  --muted: #6d6a63;
  --faint: #9a968d;
  --accent: #0b7a5c;
  --accent-hover: #09684e;
  --accent-soft: #e5f2ec;
  --accent-text: #ffffff;
  --warn: #9a5b00;
  --warn-soft: #fbf1df;
  --danger: #b3261e;
  --danger-soft: #fbe9e7;
  --radius: 8px;
  --shadow: 0 1px 2px rgba(20, 18, 14, 0.06), 0 2px 8px rgba(20, 18, 14, 0.04);
  --ease: cubic-bezier(0.2, 0.7, 0.2, 1);

  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--text);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .tv[data-theme="auto"] {
    --bg: #1b1b19; --surface: #242421; --surface-2: #2d2d29; --border: #393832;
    --text: #ecebe6; --muted: #a9a59b; --faint: #7b776e;
    --accent: #3fb68b; --accent-hover: #52c79b; --accent-soft: #1f3a2f; --accent-text: #0d1a14;
    --warn: #e0a64a; --warn-soft: #3a2f1c; --danger: #f08a80; --danger-soft: #3d2320;
    --shadow: none;
  }
}
.tv *, .tv *::before, .tv *::after { box-sizing: border-box; }
/* :where() keeps this reset at zero specificity so .tv-btn-primary etc. win. */
.tv :where(button) { font: inherit; color: inherit; }
.tv :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

/* ---- Frame ---------------------------------------------------------- */
.tv-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tv-brand { display: flex; align-items: center; gap: 6px; font-weight: 650; letter-spacing: -0.01em; }
.tv-logo { width: 18px; height: 18px; border-radius: 5px; background: var(--accent); display: grid; place-items: center; }
.tv-logo svg { width: 12px; height: 12px; }
.tv-chip {
  margin-left: auto; display: inline-flex; align-items: center; gap: 4px;
  max-width: 60%; padding: 2px 4px 2px 8px; border-radius: 999px;
  background: var(--surface); color: var(--muted); font-size: 12px;
  border: 1px solid var(--border);
}
.tv-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tv-icon-btn {
  display: inline-grid; place-items: center; width: 22px; height: 22px;
  border: 0; border-radius: 999px; background: transparent; color: var(--muted); cursor: pointer;
}
.tv-icon-btn:hover { background: var(--surface-2); color: var(--text); }
.tv-icon-btn svg { width: 14px; height: 14px; }

.tv-main { flex: 1; overflow-y: auto; padding: 16px 14px 20px; min-height: 0; }
.tv-footer {
  flex-shrink: 0; padding: 12px 14px; border-top: 1px solid var(--border);
  background: var(--bg); display: flex; flex-direction: column; gap: 8px;
}
.tv-screen { animation: tv-in 220ms var(--ease); }
@keyframes tv-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .tv-screen, .tv-flash { animation: none !important; } }

/* ---- Type ----------------------------------------------------------- */
.tv h1 { font-size: 17px; line-height: 1.3; font-weight: 650; letter-spacing: -0.015em; margin: 0 0 4px; }
.tv h2 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 20px 0 8px; }
.tv p { margin: 0 0 8px; }
.tv-sub { color: var(--muted); }
.tv-small { font-size: 12px; color: var(--muted); }
.tv-back {
  display: inline-flex; align-items: center; gap: 4px; margin: -4px 0 10px -6px; padding: 2px 6px;
  border: 0; background: none; color: var(--muted); cursor: pointer; border-radius: 6px; font-size: 12px;
}
.tv-back:hover { color: var(--text); background: var(--surface); }
.tv-back svg { width: 12px; height: 12px; }

/* ---- Buttons -------------------------------------------------------- */
.tv-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 36px; padding: 0 14px; border-radius: var(--radius); cursor: pointer;
  font-weight: 600; border: 1px solid var(--border); background: var(--bg);
  transition: background 120ms, border-color 120ms, transform 80ms;
}
.tv-btn:hover { background: var(--surface); }
.tv-btn:active { transform: scale(0.985); }
.tv-btn:disabled { opacity: 0.5; cursor: default; transform: none; }
.tv-btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
.tv-btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.tv-btn-block { width: 100%; }
.tv-link { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font-weight: 550; }
.tv-link:hover { text-decoration: underline; }

/* ---- Stat row ------------------------------------------------------- */
.tv-stats { display: flex; gap: 6px; margin: 10px 0 2px; }
.tv-stat { flex: 1; padding: 8px 10px; border-radius: var(--radius); background: var(--surface); }
.tv-stat b { display: block; font-size: 16px; font-weight: 650; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.tv-stat span { font-size: 11px; color: var(--muted); }

/* ---- Column list ---------------------------------------------------- */
.tv-cols { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.tv-col + .tv-col { border-top: 1px solid var(--border); }
.tv-col-row {
  display: grid; grid-template-columns: 16px 1fr auto; align-items: start; gap: 8px;
  width: 100%; padding: 8px 10px; border: 0; background: none; text-align: left; cursor: pointer;
}
.tv-col-row:hover { background: var(--surface); }
.tv-col[data-open="true"] .tv-col-row { background: var(--surface); }
.tv-col-name { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tv-col[data-ignored="true"] .tv-col-name { color: var(--muted); }
.tv-col-note { display: block; font-size: 12px; color: var(--muted); font-weight: 400; margin-top: 1px; white-space: normal; }
.tv-status { width: 16px; height: 16px; margin-top: 1px; display: grid; place-items: center; }
.tv-status svg { width: 14px; height: 14px; }
.tv-status-ok { color: var(--accent); }
.tv-status-skip { color: var(--faint); }
.tv-pill {
  display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 550;
  background: var(--surface-2); color: var(--muted); white-space: nowrap;
}
.tv-pill-number { background: #e8effc; color: #2956a8; }
.tv-pill-category { background: #fbf0dc; color: #8a5a00; }
.tv-pill-date { background: #f1e8fb; color: #6b3fa0; }
@media (prefers-color-scheme: dark) {
  .tv[data-theme="auto"] .tv-pill-number { background: #22304a; color: #9dbbf0; }
  .tv[data-theme="auto"] .tv-pill-category { background: #3a2f1c; color: #e8bf72; }
  .tv[data-theme="auto"] .tv-pill-date { background: #33264a; color: #c7a6ee; }
}
.tv-col-detail { padding: 2px 10px 12px 34px; background: var(--surface); }
.tv-dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 0 0 8px; font-size: 12px; }
.tv-dl dt { color: var(--muted); }
.tv-dl dd { margin: 0; overflow-wrap: anywhere; }

.tv-callout {
  display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; margin: 12px 0 0;
  border-radius: var(--radius); background: var(--accent-soft); font-size: 12px;
}
.tv-callout svg { width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px; color: var(--accent); }
.tv-callout-warn { background: var(--warn-soft); }
.tv-callout-warn svg { color: var(--warn); }
.tv-callout-danger { background: var(--danger-soft); }
.tv-callout-danger svg { color: var(--danger); }

/* ---- Target picker -------------------------------------------------- */
.tv-select-wrap { position: relative; }
.tv-select {
  width: 100%; height: 40px; padding: 0 32px 0 12px; appearance: none; -webkit-appearance: none;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg);
  font: inherit; font-weight: 600; color: var(--text); cursor: pointer;
}
.tv-select:hover { border-color: var(--faint); }
.tv-select-wrap svg { position: absolute; right: 10px; top: 13px; width: 14px; height: 14px; pointer-events: none; color: var(--muted); }
.tv-pick-hint { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; color: var(--muted); }
.tv-pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: tv-pulse 1.6s ease-in-out infinite; }
@keyframes tv-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
.tv-flash { animation: tv-flash 700ms var(--ease); }
@keyframes tv-flash { 0% { box-shadow: 0 0 0 0 var(--accent); } 100% { box-shadow: 0 0 0 6px transparent; } }

.tv-card { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; margin-top: 14px; box-shadow: var(--shadow); }
.tv-card-title { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.tv-card-big { font-size: 15px; font-weight: 650; margin-bottom: 6px; }
.tv-classes { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.tv-facts { list-style: none; padding: 0; margin: 10px 0 0; font-size: 12px; color: var(--muted); display: grid; gap: 3px; }
.tv-facts b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }

/* ---- Running -------------------------------------------------------- */
.tv-steps { list-style: none; margin: 16px 0; padding: 0; display: grid; gap: 12px; }
.tv-step { display: flex; align-items: center; gap: 10px; color: var(--faint); transition: color 200ms; }
.tv-step[data-state="active"] { color: var(--text); font-weight: 600; }
.tv-step[data-state="done"] { color: var(--muted); }
.tv-step-dot { width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--border); display: grid; place-items: center; flex-shrink: 0; }
.tv-step[data-state="done"] .tv-step-dot { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
.tv-step[data-state="done"] .tv-step-dot svg { width: 11px; height: 11px; }
.tv-step[data-state="active"] .tv-step-dot { border-color: var(--accent); border-top-color: transparent; animation: tv-spin 0.8s linear infinite; }
@keyframes tv-spin { to { transform: rotate(360deg); } }
.tv-privacy { display: flex; gap: 10px; padding: 12px; border-radius: var(--radius); background: var(--surface); font-size: 12px; }
.tv-privacy svg { width: 16px; height: 16px; flex-shrink: 0; color: var(--accent); margin-top: 1px; }
.tv-privacy b { display: block; font-size: 13px; margin-bottom: 1px; }

/* ---- Details -------------------------------------------------------- */
.tv-details { margin-top: 14px; border-top: 1px solid var(--border); padding-top: 10px; }
.tv-details summary { cursor: pointer; color: var(--muted); font-size: 12px; font-weight: 550; list-style: none; display: flex; align-items: center; gap: 4px; }
.tv-details summary::-webkit-details-marker { display: none; }
.tv-details summary svg { width: 12px; height: 12px; transition: transform 150ms; }
.tv-details[open] summary svg { transform: rotate(90deg); }
.tv-details[open] summary { margin-bottom: 8px; }

/* ---- Results -------------------------------------------------------- */
.tv-quality { font-size: 15px; line-height: 1.35; margin: 2px 0 12px; }
.tv-quality b { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.tv-bars { display: grid; gap: 8px; }
.tv-bar-row { display: grid; grid-template-columns: 64px 1fr 52px; align-items: center; gap: 8px; font-size: 12px; }
.tv-bar-row > span:last-child { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.tv-bar-label { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tv-bar-track { height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.tv-bar-fill { height: 100%; border-radius: 999px; background: var(--faint); transform-origin: left; animation: tv-grow 600ms var(--ease) both; }
.tv-bar-fill[data-strong="true"] { background: var(--accent); }
@keyframes tv-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.tv-signals .tv-bar-row { grid-template-columns: minmax(0, 1fr) 90px; }
.tv-signals .tv-bar-label { color: var(--text); }

.tv-options { display: grid; gap: 6px; margin: 0; padding: 0; border: 0; }
.tv-option {
  display: grid; grid-template-columns: 16px 1fr; gap: 8px; padding: 10px 12px; cursor: pointer;
  border: 1px solid var(--border); border-radius: var(--radius); transition: border-color 120ms, background 120ms;
}
.tv-option:hover { border-color: var(--faint); }
.tv-option:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
.tv-option:has(input:disabled) { opacity: 0.5; cursor: default; }
.tv-option input { margin: 2px 0 0; accent-color: var(--accent); }
.tv-option b { display: block; font-weight: 600; }
.tv-option span { font-size: 12px; color: var(--muted); }

.tv-preview { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 4px; }
.tv-preview td { padding: 5px 0; border-bottom: 1px solid var(--border); }
.tv-preview td:last-child { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
.tv-metrics { width: 100%; border-collapse: collapse; font-size: 12px; }
.tv-metrics td { padding: 4px 0; }
.tv-metrics td:last-child { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }

.tv-success { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: var(--radius); background: var(--accent-soft); font-size: 12px; }
.tv-success svg { width: 16px; height: 16px; color: var(--accent); flex-shrink: 0; }

/* ---- Empty / loading ------------------------------------------------ */
.tv-empty { text-align: center; padding: 32px 8px 8px; }
.tv-empty-art { width: 120px; margin: 0 auto 16px; color: var(--faint); }
.tv-skel { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--surface) 0%, var(--surface-2) 50%, var(--surface) 100%); background-size: 200% 100%; animation: tv-shimmer 1.2s linear infinite; margin-bottom: 10px; }
@keyframes tv-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.tv-counts { display: grid; gap: 6px; margin: 12px 0; }
`;
