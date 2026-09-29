import type { ColumnSchema } from "@tavolio/table";

export interface SelectTargetProps {
  schema: ColumnSchema[];
  target: string;
  onTargetChange: (name: string) => void;
  onPredict: () => void;
}

export function SelectTarget({ schema, target, onTargetChange, onPredict }: SelectTargetProps) {
  return (
    <section style={{ marginTop: 12 }}>
      <label>
        Target{" "}
        <select value={target} onChange={(e) => onTargetChange(e.target.value)}>
          {schema.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.type})
            </option>
          ))}
        </select>
      </label>{" "}
      <button onClick={onPredict} disabled={!target}>
        Predict
      </button>
    </section>
  );
}

