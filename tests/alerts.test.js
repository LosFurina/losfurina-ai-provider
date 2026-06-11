import { describe, it, expect } from 'vitest';
import { evaluateRule } from '../src/lib/alerts.js';

describe('evaluateRule', () => {
  const baseRule = (overrides) => ({
    id: 1, name: 'test', metric: 'latency_ms', operator: 'gt',
    threshold: 0.5, window_min: 10, action: 'telegram', enabled: 1,
    ...overrides,
  });

  it('triggers latency_ms based on logEntry.durationMs', () => {
    const r = evaluateRule(baseRule({ metric: 'latency_ms', threshold: 5000 }), {
      logEntry: { durationMs: 7000 }, snapshot: {},
    });
    expect(r.triggered).toBe(true);
  });

  it('uses snapshot.errorRate for error_rate metric', () => {
    const r = evaluateRule(baseRule({ metric: 'error_rate', threshold: 0.05 }), {
      logEntry: {}, snapshot: { errorRate: 0.12 },
    });
    expect(r.triggered).toBe(true);
    expect(r.actualValue).toBeCloseTo(0.12);
  });

  it('uses snapshot.providerUnhealthyName for provider_unhealthy', () => {
    const r = evaluateRule(baseRule({ metric: 'provider_unhealthy', operator: 'gt', threshold: 0 }), {
      logEntry: {}, snapshot: { providerUnhealthyName: 'OpenAI' },
    });
    expect(r.triggered).toBe(true);
    expect(r.context.provider).toBe('OpenAI');
  });

  it('returns triggered=false when rule is disabled', () => {
    const r = evaluateRule(baseRule({ enabled: 0 }), {
      logEntry: { durationMs: 999999 }, snapshot: {},
    });
    expect(r.triggered).toBe(false);
  });
});
