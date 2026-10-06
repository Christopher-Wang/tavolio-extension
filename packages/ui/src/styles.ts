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
  --down: #b8531f; /* a push that lowers the probability (waterfall); always paired with a minus sign */
  --danger-soft: #fbe9e7;
  --gutter: 8px; /* side padding of the header, body, footer and banner */
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
/* "dark" is forced by the host (Excel's Office theme); "auto" follows the OS. */
.tv[data-theme="dark"] {
    --bg: #1b1b19; --surface: #242421; --surface-2: #2d2d29; --border: #393832;
    --text: #ecebe6; --muted: #a9a59b; --faint: #7b776e;
    --accent: #3fb68b; --accent-hover: #52c79b; --accent-soft: #1f3a2f; --accent-text: #0d1a14;
    --warn: #e0a64a; --warn-soft: #3a2f1c; --danger: #f08a80; --danger-soft: #3d2320; --down: #e8956f;
    --shadow: none;
    color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  .tv[data-theme="auto"] {
    --bg: #1b1b19; --surface: #242421; --surface-2: #2d2d29; --border: #393832;
    --text: #ecebe6; --muted: #a9a59b; --faint: #7b776e;
    --accent: #3fb68b; --accent-hover: #52c79b; --accent-soft: #1f3a2f; --accent-text: #0d1a14;
    --warn: #e0a64a; --warn-soft: #3a2f1c; --danger: #f08a80; --danger-soft: #3d2320; --down: #e8956f;
    --shadow: none;
    color-scheme: dark;
  }
}
.tv *, .tv *::before, .tv *::after { box-sizing: border-box; }
/* :where() keeps this reset at zero specificity so .tv-btn-primary etc. win. */
.tv :where(button) { font: inherit; color: inherit; }
.tv :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

/* ---- Frame ---------------------------------------------------------- */
.tv-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px var(--gutter); border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tv-brand { display: flex; align-items: center; gap: 6px; font-weight: 650; letter-spacing: -0.01em; }
.tv-logo { width: 18px; height: 18px; border-radius: 5px; background: var(--accent); display: grid; place-items: center; }
.tv-logo svg { width: 12px; height: 12px; }
.tv-heading { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; }
.tv-heading h1 { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

.tv-main { flex: 1; overflow-y: auto; padding: 16px var(--gutter) 20px; min-height: 0; }
.tv-footer {
  flex-shrink: 0; padding: 12px var(--gutter); border-top: 1px solid var(--border);
  background: var(--bg); display: flex; flex-direction: column; gap: 8px;
}
.tv-screen { animation: tv-in 220ms var(--ease); }
@keyframes tv-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .tv-screen, .tv-flash, .tv-hist-bar, .tv-bar-fill, .tv-fade { animation: none !important; } .tv-dots i { animation: none !important; } }

/* ---- Tabs ----------------------------------------------------------- */
.tv-tabs { display: flex; gap: 2px; padding: 0 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.tv-tab {
  padding: 8px 10px; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px;
  background: none; cursor: pointer; color: var(--muted); font-weight: 550;
}
.tv-tab:hover:not(:disabled) { color: var(--text); }
.tv-reset { margin-left: auto; align-self: center; padding: 0 6px; color: var(--muted); font-size: 12px; }
.tv-reset:disabled { opacity: 0.5; cursor: default; }
.tv-tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
.tv-tab:disabled { opacity: 0.4; cursor: default; }
.tv-target-info { margin-top: 10px; display: grid; gap: 2px; animation: tv-in 220ms var(--ease); }
.tv-select-sm .tv-select { height: 32px; font-weight: 500; }
.tv-select-sm svg { top: 9px; }
.tv-select-sm { margin-top: 4px; }

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
.tv-more { justify-self: center; margin-top: -4px; font-size: 12px; }

/* ---- Stat row ------------------------------------------------------- */
.tv-stats { display: flex; gap: 6px; margin: 10px 0 2px; }
.tv-stat { flex: 1; padding: 8px 10px; border-radius: var(--radius); background: var(--surface); }
.tv-stat b { display: block; font-size: 16px; font-weight: 650; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.tv-stat span { font-size: 11px; color: var(--muted); }

/* ---- Column list ---------------------------------------------------- */
.tv-cols { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.tv-col + .tv-col { border-top: 1px solid var(--border); }
.tv-col-row {
  display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: start; gap: 8px;
  width: 100%; padding: 8px 10px; border: 0; background: none; text-align: left; cursor: pointer;
}
.tv-col-row:hover { background: var(--surface); }
.tv-col[data-open="true"] .tv-col-row { background: var(--surface); }
.tv-col-name { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tv-col[data-ignored="true"] .tv-col-name { color: var(--muted); }
.tv-col-note { display: block; font-size: 12px; color: var(--muted); font-weight: 400; margin-top: 1px; white-space: normal; }
.tv-status { width: 16px; height: 20px; margin-top: 0; display: grid; place-items: center; }
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
.tv[data-theme="dark"] .tv-pill-number { background: #22304a; color: #9dbbf0; }
.tv[data-theme="dark"] .tv-pill-category { background: #3a2f1c; color: #e8bf72; }
.tv[data-theme="dark"] .tv-pill-date { background: #33264a; color: #c7a6ee; }
@media (prefers-color-scheme: dark) {
  .tv[data-theme="auto"] .tv-pill-number { background: #22304a; color: #9dbbf0; }
  .tv[data-theme="auto"] .tv-pill-category { background: #3a2f1c; color: #e8bf72; }
  .tv[data-theme="auto"] .tv-pill-date { background: #33264a; color: #c7a6ee; }
}
.tv-col-detail { padding: 4px 10px 12px 34px; background: var(--surface); }
.tv-dl { display: grid; grid-template-columns: minmax(0, 45%) minmax(0, 1fr); gap: 4px 12px; margin: 0 0 10px; font-size: 12px; }
.tv-dl dt { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tv-dl dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.tv-types { margin-top: 10px; }
.tv-types .tv-bar-row { grid-template-columns: 64px 1fr 36px; }

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
.tv-privacy { margin-top: 14px; display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: var(--radius); background: var(--surface); font-size: 12px; }
.tv-privacy svg { width: 22px; height: 22px; flex-shrink: 0; color: var(--accent); }
.tv-privacy b { display: block; font-size: 13px; margin-bottom: 1px; }
.tv-engine { grid-template-columns: 1fr 1fr; gap: 8px; }
.tv-engine-stack { grid-template-columns: 1fr; }
.tv-engine-stack .tv-engine-card { grid-template-columns: auto 1fr; column-gap: 12px; row-gap: 2px; align-items: center; }
.tv-engine-stack .tv-engine-card svg { grid-row: 1 / span 2; }
.tv-engine-stack .tv-engine-card b, .tv-engine-stack .tv-engine-card span { grid-column: 2; }
.tv-engine-card {
  position: relative; display: grid; gap: 4px; align-content: start; padding: 12px; cursor: pointer; border-radius: var(--radius);
  border: 1px solid transparent; background: var(--surface); color: var(--muted); transition: border-color 120ms, background 120ms, color 120ms;
}
.tv-engine-card:hover { background: var(--surface-2); }
.tv-engine-card:has(input:checked) { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
.tv-engine-card:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.tv-engine-card input { position: absolute; opacity: 0; pointer-events: none; }
.tv-engine-card svg { width: 20px; height: 20px; }
.tv-engine-card:has(input:checked) svg { color: var(--accent); }
.tv-engine-card b { font-size: 13px; color: var(--text); }
.tv-engine-card span { font-size: 12px; line-height: 1.35; }
.tv-gpu { display: block; margin-top: 10px; }
.tv-key { display: flex; gap: 8px; margin-top: 10px; }
.tv-key .tv-input { flex: 1; min-width: 0; }
.tv-key-note { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 12px; color: var(--muted); }
.tv-key-note svg { width: 12px; height: 12px; flex-shrink: 0; color: var(--accent); }

/* ---- Details -------------------------------------------------------- */
.tv-details { margin-top: 12px; border-top: 1px solid var(--border); }
.tv-details + .tv-details { margin-top: 0; }
.tv-details summary { cursor: pointer; color: var(--muted); font-size: 12px; font-weight: 550; list-style: none; display: flex; align-items: center; gap: 4px; padding: 8px 0; }
.tv-details summary:hover { color: var(--text); }
.tv-details summary::-webkit-details-marker { display: none; }
.tv-details summary svg { width: 12px; height: 12px; transition: transform 150ms; }
.tv-details[open] > summary svg { transform: rotate(90deg); }
.tv-details[open] { padding-bottom: 8px; }
.tv-details[open] > :not(summary) { margin-left: 16px; }
.tv-details[open] > .tv-details { margin-left: 0; margin-top: 0; border-top: 0; }
.tv-details .tv-details[open] > :not(summary) { margin-left: 0; }
.tv-details > p:last-child { margin-bottom: 0; }

/* ---- Results -------------------------------------------------------- */
.tv-quality { font-size: 15px; line-height: 1.35; margin: 2px 0 12px; }
.tv-quality b { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.tv-bars { display: grid; gap: 8px; }
.tv-bar-row { display: grid; grid-template-columns: 64px 1fr 52px; align-items: center; gap: 8px; font-size: 12px; }
.tv-bar-row > span:last-of-type { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.tv-bar-label { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tv-bar-track { height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.tv-bar-fill { height: 100%; border-radius: 999px; background: var(--faint); transform-origin: left; animation: tv-grow 600ms var(--ease) both; }
.tv-bar-fill[data-strong="true"] { background: var(--accent); }
@keyframes tv-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.tv-signals .tv-bar-row { grid-template-columns: minmax(0, 1fr) 90px; }
.tv-signals .tv-bar-label { color: var(--text); }
.tv-signals[data-impact="true"] .tv-bar-row { grid-template-columns: minmax(0, 1fr) 72px 40px; }

/* ---- Why this prediction (waterfall) -------------------------------- */
@keyframes tv-fade { from { opacity: 0; } to { opacity: 1; } }
.tv-fade { animation: tv-fade 180ms var(--ease) both; }
.tv-why { position: relative; }
.tv-why-line { margin: 0 0 8px; font-size: 14px; }
.tv-wf { display: grid; gap: 6px; }
.tv-wf-row { display: grid; grid-template-columns: minmax(0, 1fr) 96px 38px; align-items: center; gap: 8px; font-size: 12px; }
.tv-wf-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.tv-why-body { position: relative; }
.tv-why-body > :not(.tv-dots) { transition: filter 160ms var(--ease), opacity 160ms var(--ease); }
.tv-why-body[data-busy="true"] > :not(.tv-dots) { filter: blur(4px); opacity: 0.55; pointer-events: none; }
.tv-dots { position: absolute; inset: 0; z-index: 1; display: flex; align-items: center; justify-content: center; gap: 6px; }
.tv-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: tv-hop 0.9s ease-in-out infinite; }
.tv-dots i:nth-child(2) { animation-delay: 0.15s; }
.tv-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes tv-hop { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-7px); } }
.tv-wf-row[tabindex] { cursor: default; border-radius: 4px; }
.tv-wf-fold { all: unset; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--accent); cursor: pointer; font-weight: 550; }
.tv-wf-fold:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.tv-wf-bar { transition: opacity 120ms var(--ease); }
.tv-wf-row[data-active="true"] .tv-wf-bar { opacity: 0.55; }
.tv-wf-group { position: relative; display: grid; gap: 6px; padding-left: 12px; }
.tv-wf-bracket { all: unset; box-sizing: border-box; position: absolute; left: 0; top: 0; bottom: 0; width: 7px; cursor: pointer; border: 2px solid var(--accent); border-right: 0; border-radius: 3px 0 0 3px; transition: opacity 120ms var(--ease); }
.tv-wf-bracket:hover { opacity: 0.35; }
.tv-wf-bracket:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tv-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.tv-wf-track { position: relative; overflow: hidden; height: 10px; border-radius: 4px; background: var(--surface-2); }
.tv-wf-bar { position: absolute; top: 1px; bottom: 1px; border-radius: 3px; background: var(--accent); }
.tv-wf-bar[data-dir="down"] { background: var(--down); }
.tv-wf-dot { position: absolute; top: 50%; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: var(--faint); box-shadow: 0 0 0 2px var(--bg); }
.tv-wf-dot[data-strong="true"] { background: var(--text); }
.tv-wf-num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }


.tv-hist { margin: 10px auto 0; width: 92%; }
.tv-hist-bars { display: flex; align-items: flex-end; gap: 2px; height: 44px; border-bottom: 1px solid var(--border); }
.tv-hist-col { flex: 1; height: 100%; display: flex; align-items: flex-end; cursor: default; }
.tv-hist-bar { display: block; width: 100%; min-height: 0; background: var(--accent); opacity: 0.85; border-radius: 2px 2px 0 0; transition: opacity 120ms, background 120ms; transform-origin: bottom; animation: tv-rise 600ms var(--ease) both; animation-delay: calc(var(--i, 0) * 20ms); }
@keyframes tv-rise { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.tv-hist-col[data-active="true"] .tv-hist-bar { opacity: 0.5; }
.tv-hist-col:focus-visible { outline-offset: 0; }
.tv-bar-row[data-active="true"] .tv-bar-fill { opacity: 0.55; }
.tv-bar-row[tabindex] { cursor: default; border-radius: 4px; }
.tv-tip {
  position: fixed; z-index: 10; max-width: 220px; padding: 6px 8px; border-radius: 6px; pointer-events: none;
  background: var(--text); color: var(--bg); font-size: 11px; line-height: 1.4; font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.2);
}
.tv-tip b { font-weight: 600; }
.tv-hist-axis { display: flex; justify-content: space-between; margin-top: 3px; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.tv-field { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.tv-input {
  height: 32px; min-width: 0; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg); color: var(--text); font: inherit;
}
.tv-input:hover { border-color: var(--faint); }
.tv-input[aria-invalid="true"] { border-color: var(--danger); }
.tv-input-num { width: 56px; text-align: right; font-variant-numeric: tabular-nums; }
.tv-error { color: var(--danger); }
.tv-selection-row { display: flex; align-items: center; gap: 10px; }
.tv-selection-row .tv-input { flex: 1; }
.tv-selection { display: grid; gap: 4px; margin-top: 8px; }
/* Inside a .tv-options grid the 6px row gap already separates it from the option above. */
.tv-options > .tv-selection, .tv-options > .tv-field { margin-top: 0; }
.tv-options { display: grid; gap: 6px; margin: 0; padding: 0; border: 0; }
.tv-option {
  display: grid; grid-template-columns: 16px 1fr; gap: 8px; padding: 10px 12px; cursor: pointer;
  border: 1px solid var(--border); border-radius: var(--radius); transition: border-color 120ms, background 120ms;
}
.tv-option:hover { border-color: var(--faint); }
.tv-option:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
.tv-option:has(input:disabled) { opacity: 0.5; cursor: default; }
.tv-option input { margin: 2px 0 0; accent-color: var(--accent); }
.tv-switch-row {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer;
  border: 1px solid var(--border); border-radius: var(--radius); transition: border-color 120ms;
}
.tv-switch-row:hover { border-color: var(--faint); }
.tv-switch-row:has(input:disabled) { opacity: 0.5; cursor: default; }
.tv-switch-row b { display: block; font-weight: 600; }
.tv-switch-row span { font-size: 12px; color: var(--muted); }
.tv-switch {
  appearance: none; -webkit-appearance: none; flex-shrink: 0; position: relative; margin: 0; cursor: pointer;
  width: 28px; height: 16px; border-radius: 8px; background: var(--border); transition: background 0.15s;
}
.tv-switch::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.25); transition: transform 0.15s;
}
.tv-switch:checked { background: var(--accent); }
.tv-switch:checked::after { transform: translateX(12px); }
.tv-option b { display: block; font-weight: 600; }
.tv-option span { font-size: 12px; color: var(--muted); }

.tv-metrics { width: calc(100% - 16px); border-collapse: collapse; font-size: 12px; }
.tv-metrics td { padding: 3px 0; }
.tv-metrics td:first-child { color: var(--muted); }
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
