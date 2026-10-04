import type { PredictionResult } from "@tavolio/models";
import type { Destination } from "../analysis.js";
import { Callout, Icon, plural } from "../components.js";

export interface AddToSheetProps {
  /** Absent while the run is still going: the options can be chosen, but nothing can be added yet. */
  result?: PredictionResult;
  destination: Destination;
  onDestination: (d: Destination) => void;
  /** Address written to, once the user has added predictions. */
  written: string | null;
  writeError: string | null;
}

/** Where the predictions go. Nothing is written until the user asks. */
export function AddToSheet({ result, destination, onDestination, written, writeError }: AddToSheetProps) {
  const target = result?.target ?? "the target";
  const isClass = result?.task.type === "classification";
  const blank = result?.newRowIndexes ?? [];
  return (
    <>
      <fieldset className="tv-options">
        <legend className="tv-small" style={{ padding: 0, marginBottom: 6 }}>
          {!result
            ? "Available once the predictions are ready."
            : blank.length > 0
            ? `Predictions for the ${plural(blank.length, "row")} without ${target}.`
            : `Predictions for all ${plural(result.predictions.length, "row")}.`}
        </legend>
        <Option
          value="new-columns"
          current={destination}
          onChange={onDestination}
          title="New columns"
          detail={isClass ? "Prediction and confidence, next to your table" : "Prediction, next to your table"}
        />
        {/* "new-sheet" is still supported by buildWritePlan and both bridges; the option is hidden for now. */}
        <Option
          value="fill-blanks"
          current={destination}
          onChange={onDestination}
          disabled={result !== undefined && blank.length === 0}
          title="Fill blank cells"
          detail={result && blank.length === 0 ? `Every row already has a ${target}` : `Write into the empty ${target} cells`}
        />
      </fieldset>

      {written ? (
        <div className="tv-success" style={{ marginTop: 10 }} role="status">
          <Icon.done />
          <span>Added to {written}. Nothing else was changed.</span>
        </div>
      ) : writeError ? (
        <Callout tone="danger">{writeError}</Callout>
      ) : null}
    </>
  );
}

function Option({
  value,
  current,
  onChange,
  title,
  detail,
  disabled,
}: {
  value: Destination;
  current: Destination;
  onChange: (d: Destination) => void;
  title: string;
  detail: string;
  disabled?: boolean;
}) {
  return (
    <label className="tv-option">
      <input
        type="radio"
        name="tv-destination"
        value={value}
        checked={current === value}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <div>
        <b>{title}</b>
        <span>{detail}</span>
      </div>
    </label>
  );
}
