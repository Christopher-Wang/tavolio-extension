import { HostError, type ActiveCell, type HostBridge, type SheetTable, type TableRef, type WritePlan, type WriteResult } from "@tavolio/ui";

/**
 * Google Sheets implementation of HostBridge. The server half lives in
 * appsscript/Code.gs. Calls go through a transport: google.script.run when the
 * UI is inlined in the sidebar, or postMessage when it is hosted in an iframe
 * (see iframeTransport.ts and appsscript/Shell.html).
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

/** Sheets has no selection events for sidebars, so poll while someone is listening. */
const POLL_MS = 900;

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
        throw new HostError("no-table", "Click any cell inside your table, and Tavolio will find the rest.");
      }
      throw e;
    }
  }

  selectColumn(table: TableRef, offset: number): Promise<void> {
    return this.call("tavolioSelectColumn", table, offset);
  }

  watchActiveCell(cb: (cell: ActiveCell) => void): () => void {
    let stopped = false;
    let last: string | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const cell = await this.call<ActiveCell | null>("tavolioActiveCell");
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
    return this.call<WriteResult>("tavolioWrite", plan);
  }
}
