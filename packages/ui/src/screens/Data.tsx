import type { ColumnType } from "@tavolio/table";
import { columnStats, completeness, type Analysis } from "../analysis.js";
import { Callout, Icon, TypePill, pct, plural } from "../components.js";

/** What a user can treat a column as. "identifier" and "ignore" both take it out of the model. */
export type TypeChoice = ColumnType | "identifier" | "ignore";

const CHOICES: Array<{ value: TypeChoice; label: string }> = [
  { value: "numeric", label: "Number" },
  { value: "categorical", label: "Category" },
  { value: "ordinal", label: "Ordinal" },
  { value: "boolean", label: "Yes / No" },
  { value: "datetime", label: "Date" },
  { value: "text", label: "Text" },
  { value: "identifier", label: "Identifier" },
  { value: "ignore", label: "Ignore" },
];

export interface DataProps {
  analysis: Analysis;
  excluded: ReadonlySet<string>;
  open: string | null;
  onOpen: (name: string | null) => void;
  onChoose: (name: string, choice: TypeChoice) => void;
}

const missing = (r: number) => (r === 0 ? "0% missing" : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}% missing`);

/** What Tavolio understood about the table: read it, trust it, correct it. */
export function Data({ analysis, excluded, open, onOpen, onChoose }: DataProps) {
  const { profiles, table } = analysis;
  const notes = profiles.filter((p) => p.role === "ignore" && !excluded.has(p.name));
  const high = profiles.filter((p) => p.missingRate >= 0.3);
  return (
    <div className="tv-screen">
      <h1>Data</h1>
      <p className="tv-sub">
        {plural(table.rows.length, "row")} · {plural(profiles.length, "column")}
        <br />
        {(completeness(analysis) * 100).toFixed(1)}% complete
      </p>

      <ul className="tv-cols">
        {profiles.map((p) => {
          const off = excluded.has(p.name) || p.role === "ignore";
          const isOpen = open === p.name;
          const stats = isOpen ? columnStats(analysis, p.name) : null;
          const summary = `${plural(p.uniqueCount, "unique value")} · ${missing(p.missingRate)}`;
          const current: TypeChoice = excluded.has(p.name) ? "ignore" : p.role === "ignore" ? "identifier" : p.type;
          return (
            <li key={p.name} className="tv-col" data-open={isOpen} data-ignored={off}>
              <button className="tv-col-row" aria-expanded={isOpen} onClick={() => onOpen(isOpen ? null : p.name)}>
                <span className={`tv-status ${off ? "tv-status-skip" : "tv-status-ok"}`} aria-label={off ? "Not used" : "Used"}>
                  {off ? <Icon.dash /> : <Icon.check />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="tv-col-name" style={{ display: "block" }}>
                    {p.name}
                  </span>
                  <span className="tv-col-note">{summary}</span>
                </span>
                {off ? <span className="tv-pill">Not used</span> : <TypePill type={p.type} />}
              </button>
              {isOpen && (
                <div className="tv-col-detail">
                  <dl className="tv-dl">
                    {stats?.lines.map(([k, v]) => (
                      <Row key={k} k={k} v={v} />
                    ))}
                    {stats?.top.map((t) => (
                      <Row key={t.value} k={t.value} v={pct(t.share)} />
                    ))}
                    <Row k="Missing" v={p.missingRate === 0 ? "None" : pct(p.missingRate)} />
                    {p.examples.length > 0 && <Row k="Examples" v={p.examples.join(", ")} />}
                  </dl>
                  {p.reason !== "Ready to use." && <p className="tv-small">{p.reason}</p>}
                  <label className="tv-small" htmlFor={`tv-type-${p.name}`}>
                    Treat this column as
                  </label>
                  <div className="tv-select-wrap tv-select-sm">
                    <select
                      id={`tv-type-${p.name}`}
                      className="tv-select"
                      value={current}
                      onChange={(e) => onChoose(p.name, e.target.value as TypeChoice)}
                    >
                      {CHOICES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <Icon.down />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {high.slice(0, 2).map((p) => (
        <Callout key={p.name} tone="warn">
          <b>High missingness</b>
          <br />
          {p.name} is {pct(p.missingRate)} missing.
        </Callout>
      ))}
      {notes.slice(0, 2).map((p) => (
        <Callout key={p.name}>
          <b>{p.name}</b> won't be used for prediction. {p.reason}
        </Callout>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
