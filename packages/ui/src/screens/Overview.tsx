import type { Analysis } from "../analysis.js";
import { Callout, Icon, TypePill, plural, typeLabel } from "../components.js";

export interface OverviewProps {
  analysis: Analysis;
  excluded: ReadonlySet<string>;
  open: string | null;
  onOpen: (name: string | null) => void;
  onToggleExclude: (name: string) => void;
}

/** §1 + §4: what Tavolio found, explained in plain language. Nothing to configure. */
export function Overview({ analysis, excluded, open, onOpen, onToggleExclude }: OverviewProps) {
  const { profiles, table } = analysis;
  const used = profiles.filter((p) => p.role === "feature" && !excluded.has(p.name)).length;
  const notes = profiles.filter((p) => p.role === "ignore" || p.reason !== "Ready to use.").length;
  return (
    <div className="tv-screen">
      <h1>Here's your data</h1>
      <p className="tv-sub">Tavolio figured out what each column contains.</p>
      <div className="tv-stats">
        <div className="tv-stat">
          <b>{table.rows.length.toLocaleString("en-US")}</b>
          <span>rows</span>
        </div>
        <div className="tv-stat">
          <b>{profiles.length}</b>
          <span>columns</span>
        </div>
        <div className="tv-stat">
          <b>{used}</b>
          <span>usable</span>
        </div>
      </div>

      <h2>Columns</h2>
      <ul className="tv-cols">
        {profiles.map((p) => {
          const off = excluded.has(p.name);
          const ignored = p.role === "ignore" || off;
          const isOpen = open === p.name;
          const note = off ? "You turned this column off." : p.reason === "Ready to use." ? null : p.reason;
          return (
            <li key={p.name} className="tv-col" data-open={isOpen} data-ignored={ignored}>
              <button className="tv-col-row" aria-expanded={isOpen} onClick={() => onOpen(isOpen ? null : p.name)}>
                <span className={`tv-status ${ignored ? "tv-status-skip" : "tv-status-ok"}`} aria-label={ignored ? "Not used" : "Used"}>
                  {ignored ? <Icon.dash /> : <Icon.check />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="tv-col-name" style={{ display: "block" }}>
                    {p.name}
                  </span>
                  {note && <span className="tv-col-note">{note}</span>}
                </span>
                <TypePill type={p.type} />
              </button>
              {isOpen && (
                <div className="tv-col-detail">
                  <dl className="tv-dl">
                    <dt>Type</dt>
                    <dd>{typeLabel(p.type)}</dd>
                    <dt>Unique values</dt>
                    <dd>{p.uniqueCount.toLocaleString("en-US")}</dd>
                    <dt>Missing</dt>
                    <dd>{p.missingRate === 0 ? "None" : `${(p.missingRate * 100).toFixed(p.missingRate < 0.1 ? 1 : 0)}%`}</dd>
                    {p.examples.length > 0 && (
                      <>
                        <dt>Examples</dt>
                        <dd>{p.examples.join(", ")}</dd>
                      </>
                    )}
                  </dl>
                  {p.role === "feature" && (
                    <button className="tv-link" onClick={() => onToggleExclude(p.name)}>
                      {off ? "Use this column" : "Don't use this column"}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {notes === 0 ? (
        <Callout>Everything looks good.</Callout>
      ) : (
        <Callout>
          {plural(notes, "column")} {notes === 1 ? "needs" : "need"} special handling. Tavolio takes care of it, so there's
          nothing for you to do.
        </Callout>
      )}
    </div>
  );
}
