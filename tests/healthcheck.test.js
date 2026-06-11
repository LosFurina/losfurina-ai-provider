import { describe, it, expect } from 'vitest';
import { judgeStatus, parseModelsResponse, buildModelMap } from '../src/lib/healthcheck.js';

describe('judgeStatus', () => {
  it('returns healthy on 200 with non-empty model list', () => {
    expect(judgeStatus(200, ['gpt-4o', 'gpt-3.5'])).toBe('healthy');
  });
  it('returns degraded on 200 with empty list', () => {
    expect(judgeStatus(200, [])).toBe('degraded');
  });
  it('returns unhealthy on non-200', () => {
    expect(judgeStatus(500, null)).toBe('unhealthy');
    expect(judgeStatus(429, null)).toBe('unhealthy');
  });
  it('returns unhealthy on network error (status 0)', () => {
    expect(judgeStatus(0, null)).toBe('unhealthy');
  });
});

describe('parseModelsResponse', () => {
  it('parses OpenAI-style response', () => {
    const json = '{"object":"list","data":[{"id":"gpt-4o"},{"id":"gpt-3.5"}]}';
    expect(parseModelsResponse(json)).toEqual(['gpt-4o', 'gpt-3.5']);
  });
  it('returns [] on invalid JSON', () => {
    expect(parseModelsResponse('not-json')).toEqual([]);
  });
  it('returns [] on missing data array', () => {
    expect(parseModelsResponse('{"object":"list"}')).toEqual([]);
  });
});

describe('buildModelMap', () => {
  it('prefixes each model with provider name', () => {
    const map = buildModelMap('PackyAPI-1.5', ['claude-opus-4-7', 'claude-sonnet-4-6']);
    expect(map).toEqual({
      'PackyAPI-1.5-claude-opus-4-7': 'claude-opus-4-7',
      'PackyAPI-1.5-claude-sonnet-4-6': 'claude-sonnet-4-6',
    });
  });

  it('returns empty object for empty models', () => {
    expect(buildModelMap('Test', [])).toEqual({});
  });
});
