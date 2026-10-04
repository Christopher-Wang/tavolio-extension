/**
 * An approximate Shapley explanation from the identity coalitions only: for every feature, "only this one present", the rest
 * absent. Of all the coalitions Kernel SHAP weighs, these are the cheap ones: a row with only feature i present depends on that
 * one cell, so rows sharing a value in column i share the evaluation, and the work is the number of distinct (column, value)
 * pairs instead of rows × features. (The mirror coalition, "all but i", depends on every other cell and never repeats.)
 *
 * With a = f({i}) - f(empty) as each feature's solo effect, the Kernel SHAP regression restricted to these coalitions, with the
 * empty and full ones as constraints, solves to phi_i = a_i + (delta - sum(a)) / M where delta = f(full) - f(empty). The values
 * therefore sum to delta exactly; whatever the solo effects miss (interactions) is shared evenly.
 *
 * "Absent" is the caller's business: `value` decides how a missing feature is filled (Tavolio leaves the cell empty, NaN).
 */

export interface ShapQuery {
  /** Which explained row (0-based, the caller's numbering) supplies the present values. Absent everywhere: any row. */
  row: number;
  /** Per feature: true keeps the row's own value, false leaves it absent. */
  present: boolean[];
}

export interface ShapResult {
  /** Rows × features, in the explained outcome's units. Each row sums to final - base. */
  phi: number[][];
  /** Which output was explained per row: the one the full row scores highest (always 0 for a single output). */
  outcome: number[];
  /** f(full) per row, for the explained output. */
  final: number[];
  /** f(empty) per row, for the explained output. */
  base: number[];
  /** f(empty) for every output, so a caller can keep it for the next call that explains against the same context. */
  empty: ArrayLike<number>;
  /** How many distinct queries went to `value`. */
  evaluations: number;
}

/** Answers the caller already has, so they are not asked again. */
export interface ShapKnown {
  /** f(empty), every output: the same for every row, as long as the context rows are the same. */
  base?: ArrayLike<number>;
  /** f(full) for an explained row (index into `rows`), every output; undefined = ask. */
  final?: (row: number) => ArrayLike<number> | undefined;
}

/**
 * `value` receives all distinct queries at once so a model can batch them, and returns `outputs` numbers per query
 * (class probabilities, or one prediction), row-major. `key(row, feature)` identifies a cell's value: two cells with the
 * same key must give the same answer when alone. `known` skips queries whose answers the caller already has.
 */
export async function identityShap(args: {
  rows: number;
  features: number;
  outputs: number;
  key: (row: number, feature: number) => string;
  value: (queries: ShapQuery[]) => Promise<ArrayLike<number>>;
  known?: ShapKnown;
}): Promise<ShapResult> {
  const { rows, features, outputs } = args;
  if (rows === 0) return { phi: [], outcome: [], final: [], base: [], empty: [], evaluations: 0 };

  const queries: ShapQuery[] = [];
  const given = args.known?.base;
  const emptyAt = given ? -1 : queries.push({ row: 0, present: new Array<boolean>(features).fill(false) }) - 1;
  // Per row: where its full answer sits among the queries, or the answer itself when it was given.
  const full = Array.from({ length: rows }, (_, row): number | ArrayLike<number> => {
    const have = args.known?.final?.(row);
    if (have) return have;
    return queries.push({ row, present: new Array<boolean>(features).fill(true) }) - 1;
  });
  const soloAt = new Map<string, number>();
  const soloOf = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: features }, (_, f) => {
      const id = `${f}\u0000${args.key(row, f)}`;
      let at = soloAt.get(id);
      if (at === undefined) {
        queries.push({ row, present: Array.from({ length: features }, (_, j) => j === f) });
        soloAt.set(id, (at = queries.length - 1));
      }
      return at;
    }),
  );

  const out = queries.length > 0 ? await args.value(queries) : [];
  if (out.length !== queries.length * outputs) throw new Error("The explanation got the wrong number of answers back.");
  const at = (q: number, o: number) => out[q * outputs + o]!;
  const empty = given ?? Array.from({ length: outputs }, (_, o) => at(emptyAt, o));
  const fullOf = (row: number, o: number) => {
    const f = full[row]!;
    return typeof f === "number" ? at(f, o) : f[o]!;
  };

  const result: ShapResult = { phi: [], outcome: [], final: [], base: [], empty, evaluations: queries.length };
  for (let row = 0; row < rows; row++) {
    let o = 0;
    for (let c = 1; c < outputs; c++) if (fullOf(row, c) > fullOf(row, o)) o = c;
    const base = empty[o]!;
    const final = fullOf(row, o);
    const solo = soloOf[row]!.map((q) => at(q, o) - base);
    const share = features === 0 ? 0 : (final - base - solo.reduce((a, b) => a + b, 0)) / features;
    result.phi.push(solo.map((a) => a + share));
    result.outcome.push(o);
    result.final.push(final);
    result.base.push(base);
  }
  return result;
}
