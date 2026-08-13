import { describe, it, expect } from 'vitest';
import { forEachModel } from './runner';

/** A signal object whose `aborted` flag the test can flip mid-run. */
function fakeSignal(): { aborted: boolean } {
  return { aborted: false };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('forEachModel', () => {
  it('runs every item sequentially when concurrent is false', async () => {
    const order: string[] = [];
    await forEachModel(['a', 'b', 'c'], false, fakeSignal(), async (item) => {
      order.push(`start:${item}`);
      await tick();
      order.push(`end:${item}`);
    });
    expect(order).toEqual([
      'start:a', 'end:a',
      'start:b', 'end:b',
      'start:c', 'end:c',
    ]);
  });

  it('overlaps items when concurrent is true', async () => {
    const order: string[] = [];
    await forEachModel(['a', 'b', 'c'], true, fakeSignal(), async (item) => {
      order.push(`start:${item}`);
      await tick();
      order.push(`end:${item}`);
    });
    // Every task starts before any finishes — the whole point of the toggle.
    expect(order.slice(0, 3)).toEqual(['start:a', 'start:b', 'start:c']);
    expect(order).toHaveLength(6);
  });

  it('awaits all concurrent work before resolving', async () => {
    let finished = 0;
    await forEachModel([1, 2, 3, 4], true, fakeSignal(), async () => {
      await tick();
      finished += 1;
    });
    expect(finished).toBe(4);
  });

  it('stops starting new items once the signal aborts mid-run', async () => {
    const signal = fakeSignal();
    const started: string[] = [];
    await forEachModel(['a', 'b', 'c'], false, signal, async (item) => {
      started.push(item);
      if (item === 'b') signal.aborted = true;
      await tick();
    });
    expect(started).toEqual(['a', 'b']);
  });

  it('starts nothing when the signal is already aborted', async () => {
    const signal = fakeSignal();
    signal.aborted = true;
    const started: string[] = [];
    for (const concurrent of [false, true]) {
      await forEachModel(['a', 'b'], concurrent, signal, async (item) => {
        started.push(item);
      });
    }
    expect(started).toEqual([]);
  });

  it('is a no-op for an empty list in both modes', async () => {
    let calls = 0;
    await forEachModel([], false, fakeSignal(), async () => { calls += 1; });
    await forEachModel([], true, fakeSignal(), async () => { calls += 1; });
    expect(calls).toBe(0);
  });

  /**
   * The dashboard marks a row "Probing"/"Testing" as its own task starts and
   * clears it when that task lands, so the peak number of rows showing work is
   * the peak number of requests actually in flight. Asserted here because the
   * per-row state would otherwise only be observable through the UI: a
   * sequential run must never show more than one row busy at a time.
   */
  it('keeps at most one task in flight when sequential, and all of them when concurrent', async () => {
    async function peakInFlight(concurrent: boolean): Promise<number> {
      let inFlight = 0;
      let peak = 0;
      await forEachModel(['a', 'b', 'c', 'd'], concurrent, fakeSignal(), async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight -= 1;
      });
      expect(inFlight).toBe(0);
      return peak;
    }
    expect(await peakInFlight(false)).toBe(1);
    expect(await peakInFlight(true)).toBe(4);
  });
});
