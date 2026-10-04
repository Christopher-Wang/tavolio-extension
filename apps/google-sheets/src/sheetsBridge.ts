import { HostError, NO_TABLE_MESSAGE, type ActiveCell, type HostBridge, type SheetTable, type TableRef, type WritePlan, type WriteResult } from "@tavolio/ui";

/**
 * Google Sheets implementation of HostBridge. The server half lives in
 * appsscript/Code.gs. The UI runs in the sidebar document (appsscript/Loader.html),
 * so calls go straight through google.script.run.
 */

type Runner = Record<string, (...args: unknown[]) => void> & {
  withSuccessHandler(fn: (v: unknown) => void): Runner;
  withFailureHandler(fn: (e: Error) => void): Runner;
};

declare global {
  interface Window {
    google?: { script?: { run?: Runner } };
  }
}

export function hasAppsScript(): boolean {
  return !!window.google?.script?.run;
}

export type Call = <T>(fn: string, ...args: unknown[]) => Promise<T>;

export const appsScriptCall: Call = <T>(fn: string, ...args: unknown[]) => {
  return new Promise<T>((resolve, reject) => {
    window.google!.script!.run!.withSuccessHandler((v) => resolve(v as T))
      .withFailureHandler(reject)
      [fn]!(...args);
  });
};

/**
 * Sheets has no selection events for sidebars, so poll while someone is listening. Each tick waits for the previous Apps Script
 * call, so the wait below comes on top of its round trip (the larger part); calls never overlap.
 */
const POLL_MS = 100;
/** While the sidebar is hidden (another tab, minimised) nobody is clicking rows to explain, so check rarely. */
const HIDDEN_POLL_MS = 2000;

export class SheetsBridge implements HostBridge {
  readonly kind = "sheets" as const;
  readonly selectionEvents = "polled" as const;

  constructor(private readonly call: Call = appsScriptCall) {}

  async readTable(): Promise<SheetTable> {
    try {
      return await this.call<SheetTable>("tavolioReadTable");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("TAVOLIO_NO_TABLE")) {
        throw new HostError("no-table", NO_TABLE_MESSAGE);
      }
      throw e;
    }
  }

  selectColumn(table: TableRef, offset: number): Promise<void> {
    return this.call("tavolioSelectColumn", table, offset);
  }

  readSelectedRows(table: TableRef): Promise<number[]> {
    return this.call<number[]>("tavolioSelectedRows", table);
  }

  watchActiveCell(cb: (cell: ActiveCell) => void): () => void {
    let stopped = false;
    let last: string | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let wait = POLL_MS;
      if (document.hidden) {
        // No call while hidden, and no baseline: the first reading after coming back isn't a click.
        last = null;
        wait = HIDDEN_POLL_MS;
      } else {
        try {
          const cell = await this.call<ActiveCell | null>("tavolioActiveCell");
          const key = cell ? `${cell.sheetName}:${cell.column}:${cell.row ?? ""}` : "";
          // The first reading is the baseline; only report moves after subscribing.
          if (!stopped && last !== null && key !== last && cell) cb(cell);
          last = key;
        } catch {
          // Transient Apps Script errors: keep polling.
        }
      }
      if (!stopped) timer = setTimeout(tick, wait);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }

  write(plan: WritePlan): Promise<WriteResult> {
    return this.call<WriteResult>("tavolioWrite", plan);
  }
}
