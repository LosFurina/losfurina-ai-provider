/**
 * In-memory log buffer queue.
 * Accumulates log entries and flushes to Telegram on:
 * - Queue reaches MAX_SIZE (5 entries)
 * - FLUSH_INTERVAL (30 seconds) elapsed since first entry
 * Does nothing when queue is empty.
 *
 * Note: Workers can be evicted at any time, so buffered logs may be lost.
 * This is acceptable for low-traffic personal use.
 */
const MAX_SIZE = 5;
const FLUSH_INTERVAL_MS = 30_000;

export class LogBuffer {
  constructor() {
    this.queue = [];
    this.timer = null;
  }

  push(logEntry, flushFn, ctx) {
    this.queue.push(logEntry);

    // If queue was empty, start the flush timer
    if (this.queue.length === 1) {
      this.timer = setTimeout(() => {
        const promise = this.flush(flushFn);
        if (promise && ctx) {
          ctx.waitUntil(promise);
        }
      }, FLUSH_INTERVAL_MS);
    }

    // Queue is full, flush immediately
    if (this.queue.length >= MAX_SIZE) {
      const promise = this.flush(flushFn);
      if (promise && ctx) {
        ctx.waitUntil(promise);
      }
    }
  }

  async flush(flushFn) {
    if (this.queue.length === 0) return;

    clearTimeout(this.timer);
    this.timer = null;

    const entries = this.queue;
    this.queue = [];

    await flushFn(entries);
  }
}
