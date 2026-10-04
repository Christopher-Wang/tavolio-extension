import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tabpfnFrontend } from "@tavolio/models";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "..", "..", "fixtures", "tabpfn-frontend.json");

interface Case {
  name: string;
  rows: number;
  cols: number;
  nTrain: number;
  numBuckets: number;
  x: Array<number | string>;
  scaled: number[];
  nanInd: number[];
  ecdf: number[];
}

const decode = (v: number | string): number =>
  v === "NaN" ? NaN : v === "Infinity" ? Infinity : v === "-Infinity" ? -Infinity : (v as number);

/** Largest |got - want| / max(1, |want|) over all cells, and where it happens. */
function maxRelDiff(got: Float32Array, want: number[]): { diff: number; at: number } {
  let diff = 0;
  let at = -1;
  for (let i = 0; i < want.length; i++) {
    const d = Math.abs(got[i]! - want[i]!) / Math.max(1, Math.abs(want[i]!));
    if (!(d <= diff)) {
      diff = d;
      at = i;
    }
  }
  return { diff, at };
}

describe("TabPFN front-end (TypeScript port vs PyTorch reference)", () => {
  const cases = JSON.parse(readFileSync(fixturePath, "utf8")) as Case[];
  for (const c of cases) {
    it(`matches the reference on "${c.name}" (${c.rows}×${c.cols}, ${c.nTrain} train, ${c.numBuckets} buckets)`, () => {
      const out = tabpfnFrontend({ rows: c.rows, cols: c.cols, nTrain: c.nTrain, x: c.x.map(decode), numBuckets: c.numBuckets });
      const nan = maxRelDiff(out.nanInd, c.nanInd);
      assert.equal(nan.diff, 0, `nanInd differs at cell ${nan.at}`);
      const scaled = maxRelDiff(out.scaled, c.scaled);
      assert.ok(scaled.diff < 1e-5, `scaled max rel diff ${scaled.diff} at cell ${scaled.at}: got ${out.scaled[scaled.at]} want ${c.scaled[scaled.at]}`);
      const ecdf = maxRelDiff(out.ecdf, c.ecdf);
      assert.ok(ecdf.diff < 1e-5, `ecdf max diff ${ecdf.diff} at cell ${ecdf.at} (col ${ecdf.at % c.cols}): got ${out.ecdf[ecdf.at]} want ${c.ecdf[ecdf.at]}`);
    });
  }
});
