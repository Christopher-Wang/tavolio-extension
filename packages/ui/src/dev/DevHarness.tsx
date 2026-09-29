import { useEffect, useMemo, useReducer } from "react";
import { TavolioApp } from "../App.js";
import { DevBridge, columnLetter } from "./devBridge.js";
import { sampleLeads } from "./sampleData.js";

const harnessCss = /* css */ `
.dh { display: flex; height: 100vh; font: 12px/1.3 system-ui, sans-serif; background: #fff; color: #202124; }
.dh-sheet { flex: 1; min-width: 0; display: flex; flex-direction: column; border-right: 1px solid #dadce0; }
.dh-bar { padding: 8px 12px; border-bottom: 1px solid #dadce0; color: #5f6368; display: flex; gap: 12px; align-items: center; }
.dh-bar b { color: #202124; }
.dh-grid { flex: 1; overflow: auto; }
.dh table { border-collapse: separate; border-spacing: 0; }
.dh th, .dh td { border-right: 1px solid #e2e3e3; border-bottom: 1px solid #e2e3e3; padding: 3px 6px; white-space: nowrap; max-width: 160px; overflow: hidden; text-overflow: ellipsis; height: 21px; }
.dh th { position: sticky; top: 0; background: #f8f9fa; color: #5f6368; font-weight: 500; cursor: pointer; z-index: 1; }
.dh th:first-child, .dh td:first-child { position: sticky; left: 0; background: #f8f9fa; color: #5f6368; text-align: center; min-width: 40px; z-index: 2; }
.dh td { cursor: cell; min-width: 70px; }
.dh td[data-sel="true"] { background: #e8f0fe; }
.dh td[data-cell="true"] { outline: 2px solid #1a73e8; outline-offset: -2px; }
.dh td[data-note="true"] { background-image: linear-gradient(225deg, #0b7a5c 5px, transparent 5px); }
.dh-tabs { display: flex; gap: 2px; padding: 4px 8px; border-top: 1px solid #dadce0; background: #f8f9fa; }
.dh-tabs button { border: 0; background: none; padding: 5px 12px; border-radius: 4px; cursor: pointer; font: inherit; color: #5f6368; }
.dh-tabs button[data-on="true"] { background: #e8f0fe; color: #1a73e8; font-weight: 600; }
.dh-side { width: 300px; flex-shrink: 0; }
`;

/**
 * Browser playground: a mock spreadsheet on the left and the real Tavolio
 * UI on the right at Sheets' 300px sidebar width. Clicking cells and column
 * headers fires the same events a real host would.
 */
export function DevHarness() {
  const bridge = useMemo(() => new DevBridge(sampleLeads()), []);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => bridge.subscribeView(rerender), [bridge]);

  const g = bridge.grid();
  const width = Math.max(...g.map((r) => r.length)) + 2;
  const height = g.length + 5;
  const { cell, selection, active, notes } = bridge.state;
  const inSel = (r: number, c: number) =>
    !!selection && r >= selection.top && r <= selection.bottom && c >= selection.left && c <= selection.right;

  return (
    <div className="dh">
      <style>{harnessCss}</style>
      <div className="dh-sheet">
        <div className="dh-bar">
          <b>Playground</b>
          <span>Click any cell, then use the sidebar. Click a column letter to select a column.</span>
        </div>
        <div className="dh-grid">
          <table>
            <thead>
              <tr>
                <th />
                {Array.from({ length: width }, (_, i) => (
                  <th key={i} onClick={() => bridge.clickColumnHeader(i + 1)}>
                    {columnLetter(i + 1)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: height }, (_, r) => (
                <tr key={r}>
                  <td>{r + 1}</td>
                  {Array.from({ length: width }, (_, c) => {
                    const v = g[r]?.[c];
                    const note = notes.get(`${active}!${r + 1}:${c + 1}`);
                    return (
                      <td
                        key={c}
                        title={note}
                        data-note={!!note}
                        data-sel={inSel(r + 1, c + 1)}
                        data-cell={cell.row === r + 1 && cell.column === c + 1}
                        style={{ fontWeight: r === 0 && v !== "" && v !== undefined ? 600 : undefined }}
                        onClick={() => bridge.clickCell(r + 1, c + 1)}
                      >
                        {v === undefined ? "" : String(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dh-tabs">
          {[...bridge.state.sheets.keys()].map((name) => (
            <button key={name} data-on={name === active} onClick={() => bridge.switchSheet(name)}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="dh-side">
        <TavolioApp host={bridge} theme="auto" />
      </div>
    </div>
  );
}
