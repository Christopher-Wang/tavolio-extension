import { useEffect, useState } from "react";
import { inferSchema } from "@tavolio/preprocessing";
import { predictTable } from "@tavolio/prediction";
import type { ColumnSchema, Table } from "@tavolio/table";
import { readSelection, writePredictions } from "../sheets/readSelection.js";
import { InspectTable } from "./screens/InspectTable.js";
import { Running } from "./screens/Running.js";
import { Results } from "./screens/Results.js";

type Phase =
  | { name: "loading" }
  | { name: "inspect"; table: Table; schema: ColumnSchema[] }
  | { name: "running"; table: Table; schema: ColumnSchema[]; target: string }
  | {
      name: "results";
      table: Table;
      schema: ColumnSchema[];
      target: string;
      predictions: unknown[];
      metrics?: Record<string, number>;
      warnings: string[];
    }
  | { name: "error"; message: string };

export function App() {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [target, setTarget] = useState("");

  useEffect(() => {
    readSelection()
      .then((table) => {
        const schema = inferSchema(table).columns;
        setPhase({ name: "inspect", table, schema });
        if (schema.length > 0) setTarget(schema[schema.length - 1]!.name);
      })
      .catch((e) => setPhase({ name: "error", message: String(e) }));
  }, []);

  async function onPredict() {
    if (phase.name !== "inspect" || !target) return;
    const { table, schema } = phase;
    const targetCol = target;
    setPhase({ name: "running", table, schema, target: targetCol });
    try {
      const result = await predictTable({ table, target: targetCol });
      setPhase({
        name: "results",
        table,
        schema,
        target: targetCol,
        predictions: result.predictions,
        metrics: result.metrics,
        warnings: result.warnings,
      });
    } catch (e) {
      setPhase({ name: "error", message: String(e) });
    }
  }

  if (phase.name === "loading") return <p>Reading selected range…</p>;
  if (phase.name === "error") return <p>Error: {phase.message}</p>;
  if (phase.name === "running") return <Running target={phase.target} />;

  if (phase.name === "results") {
    return (
      <Results
        target={phase.target}
        predictions={phase.predictions}
        metrics={phase.metrics}
        warnings={phase.warnings}
        onWrite={() =>
          writePredictions({
            predictions: phase.predictions,
            header: `${phase.target} (predicted)`,
          })
        }
      />
    );
  }

  // inspect: 1. table 2. detected types 3. target 4. predict
  return (
    <InspectTable
      table={phase.table}
      schema={phase.schema}
      target={target}
      onTargetChange={setTarget}
      onPredict={onPredict}
    />
  );
}
