import { modelRegistry, type PredictionResult } from "@tavolio/models";
import { LocalTabularModel } from "@tavolio/models";
import { columnValues, type Table } from "@tavolio/table";
import { applySchema, inferSchema } from "@tavolio/preprocessing";
import { inferTask } from "./classification.js";

export interface PredictTableRequest {
  table: Table;
  target: string;
  modelId?: string;
}

// Register the bundled baseline so predictTable works with zero setup.
let registered = false;
function ensureDefaultModel(): void {
  if (registered) return;
  try {
    modelRegistry.get("local-tabular-v1");
  } catch {
    modelRegistry.register(new LocalTabularModel());
  }
  registered = true;
}

/**
 * The entire product in one function:
 * Table -> inferSchema -> inferTask -> adapter.prepare/run/decode -> PredictionResult.
 * The Sheets/Excel shells orchestrate this; they contain no ML logic.
 */
export async function predictTable({
  table,
  target,
  modelId = "local-tabular-v1",
}: PredictTableRequest): Promise<PredictionResult> {
  ensureDefaultModel();
  if (!table.columns.some((c) => c.name === target)) {
    throw new Error(`Unknown target column: ${target}`);
  }

  const inferred = inferSchema(table);
  const withSchema: Table = applySchema(table, inferred);
  const targetValues = columnValues(withSchema, target);
  const task = inferTask(inferred.columns, target, targetValues);

  const model = modelRegistry.get(modelId);
  const prepared = await model.prepare({
    table: withSchema,
    schema: withSchema.columns,
    target,
    task,
  });
  const outputs = await model.run(prepared);
  return model.decode(outputs, {
    table: withSchema,
    schema: withSchema.columns,
    target,
    task,
  });
}
