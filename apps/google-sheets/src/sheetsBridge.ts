import { HostError, type ActiveCell, type HostBridge, type SheetTable, type TableRef, type WritePlan, type WriteResult } from "@tavolio/ui";

/**
 * Google Sheets implementation of HostBridge. The ONLY file that knows about
 * google.script.run; the server half lives in appsscript/Code.gs.
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

function call<T>(fn: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    window.google!.script!.run!.withSuccessHandler((v) => resolve(v as T))
      .withFailureHandler(reject)
      [fn]!(...args);
  });
}

/** Sheets has no selection events for sidebars, so poll while someone is listening. */
const POLL_MS = 900;

export class SheetsBridge implements HostBridge {
  readonly kind = "sheets" as const;
  readonly selectionEvents = "polled" as const;

  async readTable(): Promise<SheetTable> {
    try {
      return await call<SheetTable>("tavolioReadTable");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("TAVOLIO_NO_TABLE")) {
        throw new HostError("no-table", "Click any cell inside your table, and Tavolio will find the rest.");
      }
      throw e;
    }
  }

  selectColumn(table: TableRef, offset: number): Promise<void> {
    return call("tavolioSelectColumn", table, offset);
  }

  watchActiveCell(cb: (cell: ActiveCell) => void): () => void {
    let stopped = false;
    let last: string | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const cell = await call<ActiveCell | null>("tavolioActiveCell");
        const key = cell ? `${cell.sheetName}:${cell.column}` : "";
        // The first reading is the baseline; only report moves after subscribing.
        if (!stopped && last !== null && key !== last && cell) cb(cell);
        last = key;
      } catch {
        // Transient Apps Script errors: keep polling.
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }

  write(plan: WritePlan): Promise<WriteResult> {
    return call<WriteResult>("tavolioWrite", plan);
  }
}
