import type { ColumnSchema, Table } from "@tavolio/table";

export interface InspectTableProps {
  table: Table;
  schema: ColumnSchema[];
  target: string;
  onTargetChange: (name: string) => void;
  onPredict: () => void;
}

export function InspectTable({ table, schema, target, onTargetChange, onPredict }: InspectTableProps) {
  return (
    <main style={{ fontFamily: "sans-serif", padding: 12 }}>
      <h2>Tavolio</h2>
      <p>
        {table.rows.length} rows × {schema.length} columns
      </p>
      <table>
        <thead>
          <tr>
            <th>Column</th>
            <th>Type</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {schema.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td>{c.type}</td>
              <td>{c.confidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <label>
        Target{" "}
        <select value={target} onChange={(e) => onTargetChange(e.target.value)}>
          {schema.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div>
        <button onClick={onPredict} disabled={!target}>
          Predict
        </button>
      </div>
    </main>
  );
}

