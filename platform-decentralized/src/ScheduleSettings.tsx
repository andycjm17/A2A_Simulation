import { useEffect, useState } from "react";
import type { Snapshot } from "./App";
export type Schedule = { minutes: number; seconds: number };
export function scheduleValue(value: Schedule) {
  const milliseconds = Math.round(value.minutes * 60000),
    roundMs = value.seconds * 1000,
    rounds = milliseconds / roundMs;
  if (
    !Number.isFinite(value.minutes) ||
    value.minutes <= 0 ||
    value.minutes > 240 ||
    !Number.isInteger(value.seconds) ||
    value.seconds < 2 ||
    value.seconds > 60 ||
    !Number.isInteger(rounds) ||
    rounds < 1 ||
    rounds > 7200
  )
    throw Error(
      "Use 2–60 seconds per round and up to 240 minutes. Total duration must contain a whole number of rounds.",
    );
  return { rounds, roundMs };
}
export function ScheduleFields({
  value,
  change,
  disabled = false,
}: {
  value: Schedule;
  change: (s: Schedule) => void;
  disabled?: boolean;
}) {
  let detail = "";
  try {
    detail = `${scheduleValue(value).rounds} rounds · ${value.seconds} seconds per round`;
  } catch {
    detail = "Choose a duration containing a whole number of rounds.";
  }
  return (
    <fieldset className="initial-balances-fields" disabled={disabled}>
      <legend>Trading schedule</legend>
      <label className="field">
        Total duration (minutes)
        <input
          required
          type="number"
          min={1 / 30}
          max={240}
          step="any"
          value={value.minutes}
          onChange={(e) =>
            change({ ...value, minutes: Number(e.target.value) })
          }
        />
      </label>
      <label className="field">
        Seconds per round
        <input
          required
          type="number"
          min={2}
          max={60}
          step={1}
          value={value.seconds}
          onChange={(e) =>
            change({ ...value, seconds: Number(e.target.value) })
          }
        />
      </label>
      <p className="hint">
        {detail}. Timing locks when the competition starts.
      </p>
    </fieldset>
  );
}
export function ScheduleEditor({
  s,
  busy,
  save,
}: {
  s: Snapshot;
  busy: boolean;
  save: (value: { rounds: number; roundMs: number }) => Promise<void>;
}) {
  const [value, setValue] = useState<Schedule>({
    minutes: (s.config.rounds * s.config.roundMs) / 60000,
    seconds: s.config.roundMs / 1000,
  });
  useEffect(
    () =>
      setValue({
        minutes: (s.config.rounds * s.config.roundMs) / 60000,
        seconds: s.config.roundMs / 1000,
      }),
    [s.config.id, s.config.rounds, s.config.roundMs],
  );
  const [error, setError] = useState("");
  return (
    <form
      className="stack"
      aria-label="Edit trading schedule"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          await save(scheduleValue(value));
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <ScheduleFields
        value={value}
        change={setValue}
        disabled={busy || s.status !== "lobby"}
      />
      {error && <p role="alert">{error}</p>}
      <p className="hint">
        Saving regenerates the public price-path commitment for this schedule.
        Starting balances and registered Agents are preserved.
      </p>
      <button className="secondary" disabled={busy || s.status !== "lobby"}>
        Save trading schedule
      </button>
    </form>
  );
}
