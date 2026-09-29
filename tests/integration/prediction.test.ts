import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fromValues } from "@tavolio/table";
import type { ColumnSchema } from "@tavolio/table";
import { inferSchema } from "@tavolio/preprocessing";
import { predictTable } from "@tavolio/prediction";

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
});
