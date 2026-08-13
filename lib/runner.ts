/**
 * Walk a list of models, one at a time or all at once.
 *
 * Both runners on the dashboard share this, so the "Run concurrently" toggle
 * means exactly one thing wherever it is honoured. Completion order is not
 * guaranteed in the concurrent case, so `task` owns its own state updates rather
 * than returning a result to be assembled in order.
 *
 * Abort is checked before each task in both modes and never swallowed: a run the
 * user stopped must not keep firing requests, and `task` is expected to re-check
 * the signal after its own awaits before writing anything.
 */
export async function forEachModel<T>(
  items: readonly T[],
  concurrent: boolean,
  signal: Pick<AbortSignal, 'aborted'>,
  task: (item: T) => Promise<void>,
): Promise<void> {
  if (concurrent) {
    // Started in one tick so the requests genuinely overlap. Already-aborted
    // items resolve immediately rather than being filtered, which keeps the
    // "started" set identical to the sequential case's.
    await Promise.all(items.map((item) => (signal.aborted ? Promise.resolve() : task(item))));
    return;
  }
  for (const item of items) {
    if (signal.aborted) break;
    await task(item);
  }
}
