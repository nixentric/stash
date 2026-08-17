/** What a finished queue has to account for. */
export interface QueueResult {
  done: number;
  /** One reason per failure, in the order they happened. */
  failures: string[];
  /** True only when items were actually left unstarted. */
  stopped: boolean;
}

/**
 * Run `work` over `items` one at a time, and account for every one of them.
 *
 * Sequential is the point — the callers here are network jobs against one
 * account, where running twelve at once finishes later than twelve in order and
 * reads as chaos while it happens.
 *
 * One failure never takes the rest with it: the reason is collected and the
 * queue carries on, so a single unreachable file out of forty costs one file.
 * `stop` is handed to `work` so the surface driving it can offer a way out; it
 * takes effect between items, never mid-item.
 */
export async function runQueue<T>(
  items: T[],
  work: (item: T, index: number, stop: () => void) => Promise<unknown>,
  reason: (e: unknown) => string = String,
): Promise<QueueResult> {
  let stopRequested = false;
  const stop = () => {
    stopRequested = true;
  };
  let done = 0;
  const failures: string[] = [];

  for (const [index, item] of items.entries()) {
    if (stopRequested) break;
    try {
      await work(item, index, stop);
      done++;
    } catch (e) {
      failures.push(reason(e));
    }
  }

  return {
    done,
    failures,
    // Stopping during the last item stops nothing: the run finished, and saying
    // "stopped after 12 of 12" would be a lie about what the user got.
    stopped: stopRequested && done + failures.length < items.length,
  };
}
