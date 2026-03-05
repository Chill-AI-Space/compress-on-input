import { describe, it, expect } from 'vitest';
import { classifyContent, estimateTokens } from '../src/classifier.js';

describe('estimateTokens', () => {
  it('estimates ASCII text at ~bytes/4', () => {
    const text = 'Hello world'; // 11 bytes
    expect(estimateTokens(text)).toBe(3); // ceil(11/4)
  });

  it('handles empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('classifyContent', () => {
  it('classifies image blocks', () => {
    expect(classifyContent({ type: 'image', data: 'abc', mimeType: 'image/png' }, 500, 2000))
      .toBe('image');
  });

  it('classifies DOM snapshots by [ref=', () => {
    expect(classifyContent({ type: 'text', text: '- button "OK" [ref=42]' }, 500, 2000))
      .toBe('dom-snapshot');
  });

  it('classifies DOM snapshots by role:', () => {
    expect(classifyContent({ type: 'text', text: '- role: navigation' }, 500, 2000))
      .toBe('dom-snapshot');
  });

  it('classifies large text over maxTextTokens', () => {
    const bigText = 'x'.repeat(10000); // 10000 bytes = 2500 tokens > 2000
    expect(classifyContent({ type: 'text', text: bigText }, 500, 2000))
      .toBe('large-text');
  });

  it('classifies small text as passthrough', () => {
    expect(classifyContent({ type: 'text', text: 'small' }, 500, 2000))
      .toBe('small-text');
  });
});
