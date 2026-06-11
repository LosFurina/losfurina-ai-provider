import { describe, it, expect } from 'vitest';
import { parseUsage } from '../src/lib/usage.js';

describe('parseUsage', () => {
  it('parses OpenAI non-stream JSON', () => {
    const body = JSON.stringify({
      choices: [{}],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
    expect(parseUsage(body, 'application/json')).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it('parses Anthropic non-stream JSON with cache fields', () => {
    const body = JSON.stringify({
      id: 'msg_x',
      usage: {
        input_tokens: 80,
        output_tokens: 30,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 200,
      },
    });
    const r = parseUsage(body, 'application/json');
    expect(r.promptTokens).toBe(80);
    expect(r.completionTokens).toBe(30);
    expect(r.cacheCreationTokens).toBe(1000);
    expect(r.cacheReadTokens).toBe(200);
    // total = input + cache_creation + cache_read + output
    expect(r.totalTokens).toBe(80 + 1000 + 200 + 30);
  });

  it('parses Anthropic SSE stream (message_start + message_delta)', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":50,"cache_creation_input_tokens":2000,"cache_read_input_tokens":300,"output_tokens":1}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"text":"Hi"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":42}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');
    const r = parseUsage(sse, 'text/event-stream');
    expect(r.promptTokens).toBe(50);
    expect(r.cacheCreationTokens).toBe(2000);
    expect(r.cacheReadTokens).toBe(300);
    expect(r.completionTokens).toBe(42); // final, not the placeholder 1
    expect(r.totalTokens).toBe(50 + 2000 + 300 + 42);
  });

  it('returns zeros for empty body', () => {
    expect(parseUsage('', '')).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it('returns zeros for malformed JSON', () => {
    expect(parseUsage('not json at all', 'application/json')).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it('handles SSE without explicit content-type by sniffing', () => {
    const sse = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}\n\nevent: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n';
    const r = parseUsage(sse, '');
    expect(r.promptTokens).toBe(10);
    expect(r.completionTokens).toBe(5);
  });

  it('uses total_tokens from OpenAI when present', () => {
    const body = JSON.stringify({ usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } });
    expect(parseUsage(body, 'application/json').totalTokens).toBe(10);
  });
});
