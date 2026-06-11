import { describe, it, expect } from 'vitest';
import { analyzeComposition } from '../public/lib/summarize.js';

describe('analyzeComposition', () => {
  const sampleBody = JSON.stringify({
    model: 'claude-opus-4-7',
    system: [
      { type: 'text', text: 'A'.repeat(3000), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'B'.repeat(400) },
    ],
    tools: [
      { name: 'Read', description: 'C'.repeat(5000), input_schema: { type: 'object' } },
      { name: 'Bash', description: 'D'.repeat(10000), input_schema: { type: 'object' } },
    ],
    messages: [
      { role: 'user', content: 'old turn one' },
      { role: 'assistant', content: 'response one' },
      { role: 'user', content: 'E'.repeat(800) },
    ],
  });

  it('splits context bytes into system / tools / history / lastUser', () => {
    const c = analyzeComposition(sampleBody, {
      promptTokens: 0,
      cacheCreationTokens: 1000,
      cacheReadTokens: 9000,
      totalTokens: 10000,
    });
    expect(c.system.bytes).toBeGreaterThan(3000);
    expect(c.tools.bytes).toBeGreaterThan(15000);
    expect(c.lastUser.bytes).toBeGreaterThan(700);
    expect(c.history.bytes).toBeGreaterThan(0);
    expect(c.cacheRead.tokens).toBe(9000);
    expect(c.totalContext).toBe(10000);
  });

  it('prorates fresh-input tokens by byte share', () => {
    const c = analyzeComposition(sampleBody, {
      promptTokens: 0,
      cacheCreationTokens: 1000,
      cacheReadTokens: 0,
      totalTokens: 1000,
    });
    // tools is the biggest chunk; should get the most tokens
    expect(c.tools.tokens).toBeGreaterThan(c.system.tokens);
    expect(c.tools.tokens).toBeGreaterThan(c.lastUser.tokens);
    // sum of estimates == fresh input (within rounding)
    const sum = c.system.tokens + c.tools.tokens + c.history.tokens + c.lastUser.tokens;
    expect(Math.abs(sum - 1000)).toBeLessThanOrEqual(4);
  });

  it('handles missing system / tools / messages', () => {
    const minimal = JSON.stringify({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const c = analyzeComposition(minimal, {
      promptTokens: 100,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 100,
    });
    expect(c.system.bytes).toBe(0);
    expect(c.tools.bytes).toBe(0);
    expect(c.history.bytes).toBe(0);
    expect(c.lastUser.bytes).toBeGreaterThan(0);
  });

  it('returns zero composition for invalid JSON', () => {
    const c = analyzeComposition('garbage{', { promptTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0 });
    expect(c.totalContext).toBe(0);
    expect(c.system.tokens).toBe(0);
  });

  it('hitRate field reflects cacheRead share', () => {
    const c = analyzeComposition(sampleBody, {
      promptTokens: 100,
      cacheCreationTokens: 200,
      cacheReadTokens: 700,
      totalTokens: 1000,
    });
    expect(c.hitRate).toBeCloseTo(0.7, 2);
  });
});
