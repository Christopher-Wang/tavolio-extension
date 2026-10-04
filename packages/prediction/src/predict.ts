import { modelRegistry, type LoadProgress, type PredictionResult, type ValidationStrategy } from "@tavolio/models";
import { LocalTabularModel } from "@tavolio/models";
import { columnValues, type ColumnType, type Table } from "@tavolio/table";
import { applySchema, inferSchema } from "@tavolio/preprocessing";
import { inferTask, rareClasses } from "./classification.js";

/** "baseline" (fitting the simple logistic/linear model to compare against) only appears when quality is scored. "loading-model" only appears when the model has something to fetch (first run downloads TabPFN; later runs use the cache). */
export type PredictStage = "preparing" | "loading-model" | "predicting" | "evaluating" | "baseline";

export interface PredictTableRequest {
  table: Table;
  target: string;
  modelId?: string;
  /** Column types the user corrected; these win over inference. */
  typeOverrides?: Record<string, ColumnType>;
  /** How quality is scored; random 70/30 when omitted. */
  validation?: ValidationStrategy;
  /** Explain the predictions (Kernel SHAP on the end coalitions) and rank columns by that. Slower. */
  explain?: boolean;
  /**
   * Predict exactly these rows (0-based) instead of the blank-target ones. Their known targets are hidden from the model,
   * so they are never learned from or scored on, whatever the validation strategy says.
   */
  predictRows?: number[];
  /** Also score a simple reference model for comparison (default true). */
  baseline?: boolean;
  /** Regression only: also give a prediction interval covering this share of outcomes, 0..1 (0.95). */
  interval?: number;
  /** Called as each stage starts (and, while "loading-model", as bytes arrive); awaited so a UI can paint between stages. */
  onProgress?: (stage: PredictStage, detail?: LoadProgress) => void | Promise<void>;
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
  typeOverrides,
  validation,
  explain,
  predictRows,
  baseline,
  interval,
  onProgress,
}: PredictTableRequest): Promise<PredictionResult> {
  ensureDefaultModel();
  if (!table.columns.some((c) => c.name === target)) {
    throw new Error(`Unknown target column: ${target}`);
  }
  await onProgress?.("preparing");

  const base = inferSchema(table);
  const inferred = typeOverrides
    ? { ...base, columns: base.columns.map((c) => (typeOverrides[c.name] ? { ...c, type: typeOverrides[c.name]!, confidence: 1 } : c)) }
    : base;
  const typed: Table = applySchema(table, inferred);
  const targetAt = typed.columns.findIndex((c) => c.name === target);
  const picked = predictRows ? new Set(predictRows) : null;
  const withSchema: Table = picked
    ? { ...typed, rows: typed.rows.map((r, i) => (picked.has(i) ? r.map((v, j) => (j === targetAt ? null : v)) : r)) }
    : typed;
  const targetValues = columnValues(withSchema, target);
  const task = inferTask(inferred.columns, target, targetValues);

  const model = modelRegistry.get(modelId);
  // Start loading first so the download / session creation overlaps feature building. The hint lets a model that will
  // delegate (e.g. TabPFN on a regression target) skip a pointless download. Models with nothing to fetch never call back.
  const loading = model.load((p) => void onProgress?.("loading-model", p), { task });
  const [prepared] = await Promise.all([
    model.prepare({ table: withSchema, schema: withSchema.columns, target, task, validation, explain, baseline, interval }),
    loading,
  ]);
  await onProgress?.("predicting");
  const outputs = await model.run(prepared);
  await onProgress?.("evaluating");
  const result = await model.decode(outputs, {
    table: withSchema,
    schema: withSchema.columns,
    target,
    task,
    validation,
    explain,
    baseline,
    interval,
    onBaseline: () => onProgress?.("baseline"),
  });
  // A model that delegated (e.g. TabPFN falling back to the baseline) names the model that actually ran.
  // Only the chosen rows count as predicted, not any other blank-target rows that came along.
  if (picked && result.newRowIndexes) result.newRowIndexes = result.newRowIndexes.filter((i) => picked.has(i));
  const rare = task.type === "classification" ? rareClasses(targetValues) : [];
  const warnings = rare.length === 0 || targetValues.length < 20
    ? result.warnings
    : [
        ...result.warnings,
        `Only one example each of ${rare.slice(0, 4).map((c) => `"${c}"`).join(", ")}${rare.length > 4 ? ` and ${rare.length - 4} more` : ""}: Tavolio is unlikely to predict ${rare.length === 1 ? "that value" : "those values"}.`,
      ];
  return { ...result, warnings, model: result.model ?? { id: model.manifest.id, displayName: model.manifest.displayName } };
}
