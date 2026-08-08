// Bounded retries for network work.
//
// The Firebase Storage SDK retries internally for up to ten minutes, so a
// single stalled upload can make a long import look frozen with no way to tell
// what happened. These wrappers put a ceiling on each attempt and surface the
// failure instead, letting a batch job skip one bad item and carry on.

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${Math.round(ms / 1000)}s`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface RetryOptions {
  attempts?: number;
  timeoutMs?: number;
  /** called before each retry, for progress messages */
  onRetry?: (attempt: number, err: unknown) => void;
  signal?: AbortSignal;
}

export async function retry<T>(
  task: () => Promise<T>,
  { attempts = 3, timeoutMs = 45000, onRetry, signal }: RetryOptions = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) throw new Error("Cancelled");
    try {
      return await withTimeout(task(), timeoutMs);
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      onRetry?.(attempt, err);
      // Back off a little before trying again, but stay responsive.
      await new Promise((r) => setTimeout(r, Math.min(1000 * attempt, 4000)));
    }
  }
  throw lastError;
}
