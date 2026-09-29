export interface ResultsProps {
  target: string;
  predictions: unknown[];
  metrics?: Record<string, number>;
  warnings: string[];
  onWrite: () => void;
}

export function Results({ target, predictions, metrics, warnings, onWrite }: ResultsProps) {
  return (
    <main style={{ fontFamily: "sans-serif", padding: 12 }}>
      <h2>Predictions: {target}</h2>
      {metrics && <pre>{JSON.stringify(metrics, null, 2)}</pre>}
      <ol>
        {predictions.slice(0, 20).map((p, i) => (
          <li key={i}>{String(p)}</li>
        ))}
      </ol>
      {warnings.map((w) => (
        <p key={w}>
          <small>{w}</small>
        </p>
      ))}
      <button onClick={onWrite}>Write to sheet</button>
    </main>
  );
}

