import { fromValues, type Table } from "@tavolio/table";

/**
 * Thin host boundary. The ONLY file that knows about google.script.run.
 * Everything else operates on the canonical Table.
 */

declare global {
  interface Window {
    google?: {
      script?: {
        run?: {
          withSuccessHandler<T>(fn: (v: T) => void): {
            withFailureHandler(fn: (e: Error) => void): {
              getSelectedTable(): void;
              writePredictions(payload: WritePayload): void;
            };
          };
        };
      };
    };
  }
}

export interface WritePayload {
  predictions: unknown[];
  header: string;
}

const DEV_TABLE: Table = fromValues(
  ["Age", "Plan", "Signup Date", "Churn"],
  [
    [34, "Basic", "2023-01-15", "No"],
    [45, "Pro", "2023-02-01", "No"],
    [23, "Basic", "2023-01-20", "Yes"],
    [51, "Enterprise", "2022-11-05", "No"],
  ],
);

function hasAppsScript(): boolean {
  return !!window.google?.script?.run;
}

/** Selected cells -> canonical Table. Falls back to sample data for browser dev. */
export function readSelection(): Promise<Table> {
  if (!hasAppsScript()) return Promise.resolve(DEV_TABLE);
  return new Promise((resolve, reject) => {
    window.google!.script!.run!.withSuccessHandler((values: unknown[][]) => {
      try {
        const [header, ...rows] = values;
        if (!header) throw new Error("Selection is empty");
        resolve(fromValues(header, rows));
      } catch (e) {
        reject(e);
      }
    })
      .withFailureHandler((e) => reject(e))
      .getSelectedTable();
  });
}

export function writePredictions(payload: WritePayload): Promise<void> {
  if (!hasAppsScript()) {
    console.log("[dev] writePredictions:", payload);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    window.google!.script!.run!.withSuccessHandler(() => resolve())
      .withFailureHandler((e) => reject(e))
      .writePredictions(payload);
  });
}
