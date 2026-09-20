/**
 * One elapsed-time clock for both the map's animation frame and the slower UI.
 * Reading materializes time without notifying React. Actions materialize first,
 * so pausing never snaps a vehicle back to the last 250 ms UI snapshot.
 */
export function createScenarioClock<State extends { running: boolean }, Action>({
  initialState,
  reduce,
  elapsedAction,
  now = () => performance.now(),
}: {
  initialState: State;
  reduce: (state: State, action: Action) => State;
  elapsedAction: (seconds: number) => Action;
  now?: () => number;
}) {
  let state = initialState;
  let anchor = now();

  const read = (): State => {
    const timestamp = now();
    // A malformed or backwards clock must not add time or reset the anchor.
    if (!Number.isFinite(timestamp) || timestamp < anchor) return state;
    const elapsed = (timestamp - anchor) / 1000;
    anchor = timestamp;
    if (state.running && elapsed > 0) state = reduce(state, elapsedAction(elapsed));
    return state;
  };

  const dispatch = (action: Action): State => {
    read();
    state = reduce(state, action);
    return state;
  };

  return { read, dispatch };
}
