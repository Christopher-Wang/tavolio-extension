import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fromValues } from "@tavolio/table";
import type { ColumnSchema } from "@tavolio/table";
import { inferSchema, profileColumns } from "@tavolio/preprocessing";
import { isPredictError, predictTable } from "@tavolio/prediction";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "..", "fixtures");

function loadCsv(name: string) {
  const text = readFileSync(join(fixtures, name), "utf8").trim();
  const lines = text.split("\n").map((l) => l.split(","));
  const [header, ...rows] = lines;
  return fromValues(header!, rows);
}

describe("prediction pipeline", () => {
  it("profiles churn.csv (numeric/categorical/datetime/nullable)", () => {
    const table = loadCsv("churn.csv");
    const schema = inferSchema(table);
    const byName = new Map<string, ColumnSchema>(schema.columns.map((c) => [c.name, c]));
    assert.equal(byName.get("Age")?.type, "numeric");
    assert.equal(byName.get("Age")?.nullable, true);
    assert.equal(byName.get("Plan")?.type, "categorical");
    assert.equal(byName.get("Signup Date")?.type, "datetime");
  });

  it("predicts churn (classification) end-to-end", async () => {
    const table = loadCsv("churn.csv");
    const result = await predictTable({ table, target: "Churn" });
    assert.equal(result.task.type, "classification");
    assert.equal(result.predictions.length, table.rows.length);
    assert.equal(result.probabilities?.length, table.rows.length);
  });

  it("predicts housing price (regression) end-to-end", async () => {
    const table = loadCsv("housing.csv");
    const result = await predictTable({ table, target: "Price" });
    assert.equal(result.task.type, "regression");
    assert.equal(result.predictions.length, table.rows.length);
  });

  it("handles the messy fixture without throwing", async () => {
    const table = loadCsv("messy.csv");
    const result = await predictTable({ table, target: "Subscribed" });
    assert.equal(result.task.type, "classification");
    assert.equal(result.predictions.length, table.rows.length);
  });

  it("profiles IDs as ignored, not features (vision §4)", () => {
    const table = loadCsv("churn.csv");
    const schema = inferSchema(table);
    const profiles = profileColumns(table, schema.columns);
    const byName = new Map(profiles.map((p) => [p.name, p]));
    assert.equal(byName.get("CustomerID")?.role, "ignore");
    assert.match(byName.get("CustomerID")?.reason ?? "", /identifier/i);
    assert.equal(byName.get("Plan")?.role, "feature");
  });

  it("reports held-out accuracy vs baseline, not just raw predictions (vision §6)", async () => {
    const table = loadCsv("churn.csv");
    const result = await predictTable({ table, target: "Churn" });
    assert.equal(result.evaluation?.kind, "classification");
    assert.ok((result.evaluation?.accuracy ?? -1) >= 0);
    assert.ok((result.evaluation?.baselineAccuracy ?? -1) >= 0);
    assert.ok((result.confidences?.length ?? 0) === table.rows.length);
    assert.ok(Array.isArray(result.featureSignals));
  });

  it("reports regression error vs mean-target baseline (vision §9)", async () => {
    const table = loadCsv("housing.csv");
    const result = await predictTable({ table, target: "Price" });
    assert.equal(result.evaluation?.kind, "regression");
    assert.ok((result.evaluation?.mae ?? -1) >= 0);
    assert.ok((result.evaluation?.baselineMae ?? -1) >= 0);
    assert.ok((result.evaluation?.rmse ?? -1) >= 0);
  });

  it("tracks blank-target rows for first-class new-data prediction (vision §11)", async () => {
    const table = loadCsv("churn.csv");
    const withBlank = fromValues(
      table.columns.map((c) => c.name),
      [...table.rows, ["C007", "30", "Basic", "29.99", "2023-04-01", ""]],
    );
    const result = await predictTable({ table: withBlank, target: "Churn" });
    assert.deepEqual(result.newRowIndexes, [withBlank.rows.length - 1]);
  });

  it("explains identifier targets instead of throwing ML jargon (vision §13)", async () => {
    const header = ["Feature", "CustomerID"];
    const rows: string[][] = [];
    for (let i = 0; i < 12; i++) rows.push([`f${i % 3}`, `C${String(i).padStart(3, "0")}`]);
    const table = fromValues(header, rows);
    await assert.rejects(() => predictTable({ table, target: "CustomerID" }), (e: unknown) => {
      return isPredictError(e) && /unique|identifier/i.test(`${e.title} ${e.detail}`);
    });
  });

  it("explains thin classes on real-size tables (vision §13)", async () => {
    const header = ["Feature", "Label"];
    const rows: string[][] = [];
    for (let i = 0; i < 25; i++) rows.push([`f${i % 5}`, "No"]);
    rows.push(["rare", "Yes"]);
    const table = fromValues(header, rows);
    await assert.rejects(() => predictTable({ table, target: "Label" }), (e: unknown) => {
      return isPredictError(e) && /more examples/i.test(e.detail);
    });
  });

  it("doesn't mistake dash-separated IDs for dates", () => {
    const ids = Array.from({ length: 20 }, (_, i) => [`L-${1001 + i}`, `2025-01-${String(i + 1).padStart(2, "0")}`]);
    const schema = inferSchema(fromValues(["Lead ID", "Signup"], ids)).columns;
    assert.notEqual(schema[0]!.type, "datetime");
    assert.equal(schema[1]!.type, "datetime");
  });

  it("reports progress stages and the model used", async () => {
    const stages: string[] = [];
    const result = await predictTable({ table: loadCsv("churn.csv"), target: "Churn", onProgress: (s) => void stages.push(s) });
    assert.deepEqual(stages, ["preparing", "predicting", "evaluating"]);
    assert.equal(result.model?.id, "local-tabular-v1");
  });
});
