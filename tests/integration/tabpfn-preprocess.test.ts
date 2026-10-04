import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applySchema, inferSchema, profileColumns } from "@tavolio/preprocessing";
import { fromValues, type ColumnSchema, type Table } from "@tavolio/table";
import { buildTabPfnInputs, encodeForTabPfn, parseDateMs, parseNumber, softClipColumn } from "@tavolio/models";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "..", "..", "fixtures", "tabpfn-preprocess.json"), "utf8")) as {
  modality: Array<{ rows: number; names: string[]; columns: Record<string, Array<number | null>>; modality: Record<string, string> }>;
  clip: Array<{ name: string; rows: number; cols: number; nTrain: number; x: Array<number | string>; clipped: Array<number | string> }>;
};
const num = (v: number | string | null) => (v === null || v === "NaN" ? NaN : (v as number));

/** Table with every column typed explicitly, so a test controls what the encoder sees rather than what inference guesses. */
function typed(header: string[], types: Array<ColumnSchema["type"]>, rows: unknown[][]): Table {
  return fromValues(header, rows, header.map((name, i) => ({ name, type: types[i]!, confidence: 1, nullable: true })));
}

describe("TabPFN preprocessing parity with the Python library", () => {
  for (const c of fixtures.modality) {
    it(`numeric columns are categorical / numerical / dropped exactly as detect_feature_modalities says (${c.rows} rows)`, () => {
      const rows = Array.from({ length: c.rows }, (_, r) => [...c.names.map((n) => c.columns[n]![r] ?? ""), r % 2]);
      const table = typed([...c.names, "y"], [...c.names.map(() => "numeric" as const), "numeric"], rows);
      const frame = encodeForTabPfn(table, table.columns, "y");
      for (const name of c.names) {
        const want = c.modality[`input_${name}`]!;
        const j = frame.featureNames.indexOf(name);
        if (want === "CONSTANT") assert.equal(j, -1, `${name} should be dropped`);
        else {
          assert.notEqual(j, -1, `${name} should be kept`);
          assert.equal(frame.categorical[j], want === "CATEGORICAL", `${name}: Python says ${want}`);
        }
      }
    });
  }

  for (const c of fixtures.clip) {
    it(`soft outlier clipping matches TorchSoftClipOutliers (${c.name})`, () => {
      for (let j = 0; j < c.cols; j++) {
        const col = Float64Array.from({ length: c.rows }, (_, r) => num(c.x[r * c.cols + j]!));
        softClipColumn(col, c.nTrain);
        for (let r = 0; r < c.rows; r++) {
          const want = num(c.clipped[r * c.cols + j]!);
          if (Number.isNaN(want)) assert.ok(Number.isNaN(col[r]!));
          else assert.ok(Math.abs(col[r]! - want) <= 1e-4 * Math.max(1, Math.abs(want)), `col ${j} row ${r}: ${col[r]} vs ${want}`);
        }
      }
    });
  }
});

describe("type consistency", () => {
  it("parses the number spellings a sheet produces and nothing else", () => {
    assert.equal(parseNumber("1,234.5"), 1234.5);
    assert.equal(parseNumber("$ 12"), 12);
    assert.equal(parseNumber("12%"), 12);
    assert.equal(parseNumber("(5)"), -5);
    assert.equal(parseNumber(true), 1);
    assert.ok(Number.isNaN(parseNumber("abc")));
    assert.ok(Number.isNaN(parseNumber("")));
    assert.ok(Number.isNaN(parseNumber("N/A")));
    assert.ok(Number.isNaN(parseNumber(Infinity)));
  });

  it("turns cells that don't fit a numeric column into blanks, and says so", () => {
    const rows = Array.from({ length: 12 }, (_, i) => [i === 3 ? "oops" : i === 4 ? "$1,000" : i % 4, i % 2]);
    const table = typed(["v", "y"], ["numeric", "numeric"], rows);
    const frame = encodeForTabPfn(table, table.columns, "y");
    assert.equal(frame.matrix[4]!, 1000);
    assert.ok(Number.isNaN(frame.matrix[3]!));
    assert.ok(frame.notes.some((n) => /1 cell in "v" weren't numbers/.test(n)), frame.notes.join("|"));
  });

  it("reads dates as wall-clock whatever the format, and unparseable ones as blank", () => {
    assert.equal(parseDateMs("2024-03-05"), Date.UTC(2024, 2, 5));
    assert.equal(parseDateMs("2024-03-05T14:30:00"), Date.UTC(2024, 2, 5, 14, 30));
    assert.equal(parseDateMs("2024-03-05 14:30"), Date.UTC(2024, 2, 5, 14, 30));
    assert.equal(parseDateMs("3/5/2024"), Date.UTC(2024, 2, 5), "non-ISO strings are US month/day, local midnight, re-expressed as wall-clock");
    assert.equal(parseDateMs(new Date(2024, 2, 5)), Date.UTC(2024, 2, 5), "Date objects are read by their local calendar fields");
    assert.ok(Number.isNaN(parseDateMs("soon")));
    assert.ok(Number.isNaN(parseDateMs(45000)));
  });

  it("merges categories that differ only by case or padding, with blanks staying blank", () => {
    const rows = ["Pro", "pro ", "PRO", "basic", "", "Basic", "free"].map((v, i) => [v, i]);
    const table = typed(["plan", "y"], ["categorical", "numeric"], rows);
    const frame = encodeForTabPfn(table, table.columns, "y");
    const col = Array.from(frame.matrix);
    assert.equal(col[0], col[1]);
    assert.equal(col[0], col[2]);
    assert.equal(col[3], col[5]);
    assert.ok(Number.isNaN(col[4]!));
    assert.deepEqual([...new Set(col.filter((v) => !Number.isNaN(v)))].sort(), [0, 1, 2], "three categories -> a permutation of 0..2");
  });
});

describe("date expansion", () => {
  const dates = Array.from({ length: 40 }, (_, i) => [new Date(Date.UTC(2023, 0, 1 + i * 3)).toISOString().slice(0, 10), i % 2]);
  const table = typed(["when", "y"], ["datetime", "numeric"], dates);
  const frame = encodeForTabPfn(table, table.columns, "y");
  const col = (name: string, r: number) => frame.matrix[r * frame.cols + frame.featureNames.indexOf(name)]!;

  it("emits a running index plus annual and weekly Fourier pairs (no daily pair for whole dates)", () => {
    assert.deepEqual(frame.featureNames.filter((n) => !/annual|weekly/.test(n)), ["when (days)"]);
    assert.equal(frame.featureNames.length, 1 + 4 + 4);
    assert.equal(col("when (days)", 0), 0);
    assert.equal(col("when (days)", 39), 117);
  });

  it("weekly terms repeat every 7 days and annual terms follow the calendar", () => {
    // Rows are 3 days apart, so row r and r+7 are 21 days apart: same weekday.
    assert.ok(Math.abs(col("when (weekly sin1)", 1) - col("when (weekly sin1)", 8)) < 1e-6);
    assert.ok(Math.abs(col("when (weekly cos2)", 1) - col("when (weekly cos2)", 8)) < 1e-6);
    // 2023-01-01 is the first instant of the year: phase 0.
    assert.ok(Math.abs(col("when (annual sin1)", 0)) < 1e-6 && Math.abs(col("when (annual cos1)", 0) - 1) < 1e-6);
  });

  it("adds a daily pair when a column carries a time of day", () => {
    const withTime = typed(["when", "y"], ["datetime", "numeric"], Array.from({ length: 12 }, (_, i) => [`2024-01-01T${String(i * 2).padStart(2, "0")}:00:00`, i]));
    const f = encodeForTabPfn(withTime, withTime.columns, "y");
    assert.ok(f.featureNames.includes("when (daily sin1)"));
  });
});

describe("buildTabPfnInputs", () => {
  /** 30 rows: x varies, k is constant in the first 20 rows only, c is categorical, and rows 0 and 1 are identical. */
  function frameOf() {
    const rows = Array.from({ length: 30 }, (_, i) => [i < 2 ? 5 : i, i < 20 ? 1 : 2 + (i % 3), i < 2 ? "a" : ["a", "b", "c"][i % 3], i % 2]);
    const table = typed(["x", "k", "c", "y"], ["numeric", "numeric", "categorical", "numeric"], rows);
    return encodeForTabPfn(table, table.columns, "y");
  }
  const train = Array.from({ length: 20 }, (_, i) => i);
  const test = [20, 21, 22, 23];

  it("drops columns that are constant in the train rows, adds a fingerprint, and keeps train/test aligned", () => {
    const frame = frameOf();
    assert.equal(frame.cols, 3, "k varies over the whole table, so the table-wide encoder keeps it");
    const ctx = buildTabPfnInputs(frame, train, test);
    assert.equal(ctx.cols, 3, "k is constant in train (dropped) and a fingerprint is added: x, c, fingerprint");
    assert.equal(ctx.trainX.length, 20 * 3);
    assert.equal(ctx.testX.length, 4 * 3);
  });

  it("is deterministic, gives duplicate train rows different fingerprints, and never touches category codes with the clip", () => {
    const frame = frameOf();
    const a = buildTabPfnInputs(frame, train, test);
    const b = buildTabPfnInputs(frame, train, test);
    assert.deepEqual(a.trainX, b.trainX);
    // Rows 0 and 1 have identical features; exactly one column (the fingerprint) tells them apart.
    const differing = Array.from({ length: a.cols }, (_, j) => j).filter((j) => a.trainX[j] !== a.trainX[a.cols + j]);
    assert.equal(differing.length, 1);
    const fp = differing[0]!;
    for (let r = 0; r < 20; r++) assert.ok(a.trainX[r * a.cols + fp]! >= 0 && a.trainX[r * a.cols + fp]! < 1);
    // The categorical column's values are still plain codes 0..2.
    const catCols = Array.from({ length: a.cols }, (_, j) => j).filter((j) => j !== fp && Array.from({ length: 20 }, (_, r) => a.trainX[r * a.cols + j]!).every((v) => [0, 1, 2].includes(v)));
    assert.ok(catCols.length >= 1);
  });

  it("clips an extreme test value using bounds from the train rows only", () => {
    const rows = Array.from({ length: 40 }, (_, i) => [i === 35 ? 1e9 : i % 7, i % 2]);
    const table = typed(["x", "y"], ["numeric", "numeric"], rows);
    const frame = encodeForTabPfn(table, table.columns, "y");
    const ctx = buildTabPfnInputs(frame, Array.from({ length: 30 }, (_, i) => i), Array.from({ length: 10 }, (_, i) => 30 + i));
    const extreme = Math.max(...Array.from({ length: ctx.cols }, (_, j) => ctx.testX[5 * ctx.cols + j]!));
    assert.ok(extreme > 5 && extreme < 100, `1e9 should be clipped to a few dozen, got ${extreme}`);
  });

  it("refuses a table whose every column is constant in the train rows", () => {
    const table = typed(["x", "y"], ["numeric", "numeric"], Array.from({ length: 12 }, (_, i) => [i < 8 ? 1 : 2, i]));
    const frame = encodeForTabPfn(table, table.columns, "y");
    assert.throws(() => buildTabPfnInputs(frame, [0, 1, 2, 3], [9, 10]), /constant/);
  });
});

describe("identifier rule", () => {
  it("still ignores unique ids, but keeps a one-row-per-day date and a continuous measure", () => {
    const rows = Array.from({ length: 12 }, (_, i) => [`C${100 + i}`, 1000 + i, 10.5 + i * 1.25, `2024-02-${String(i + 1).padStart(2, "0")}`, i % 3]);
    const table = fromValues(["id", "row_no", "price", "day", "k"], rows);
    const withSchema = applySchema(table, inferSchema(table));
    const role = Object.fromEntries(profileColumns(withSchema, withSchema.columns).map((p) => [p.name, p.role]));
    assert.deepEqual(role, { id: "ignore", row_no: "ignore", price: "feature", day: "feature", k: "feature" });
  });
});
