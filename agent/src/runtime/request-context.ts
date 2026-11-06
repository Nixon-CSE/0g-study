import { AsyncLocalStorage } from 'node:async_hooks';
import type { RouterCall } from '../providers/zerog-router.js';

/**
 * Per-turn context. Tools and the traced HTTP layer read it so concurrent users never
 * share state (no module-level "current user").
 */
export interface RequestContext {
  /** Stable id of the human student for this turn (undefined for non-study traffic). */
  studentId?: string;
  /** 0G router calls made during this turn, in order. */
  calls: RouterCall[];
  /**
   * FR9: the student's own 0G API key (sk-…) when they connected their 0G account. Router calls in
   * this turn are billed to it instead of the shared ZEROG_API_KEY. Never logged, never sent to a browser.
   */
  zerogApiKey?: string;
  /** Cards saved by a successful `study_log` in this turn; the runtime attaches them to the reply. */
  flashcards?: { q: string; a: string }[];
}

const store = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}

export function currentContext(): RequestContext | undefined {
  return store.getStore();
}
