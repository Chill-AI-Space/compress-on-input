import { describe, it, expect } from 'vitest';
import { compressTruncate } from '../src/compressors/truncate.js';

describe('compressTruncate', () => {
  it('passes through text under limit', () => {
    const block = { type: 'text', text: 'short text' };
    const result = compressTruncate(block, 2000);
    expect(result.text).toBe('short text');
  });

  it('truncates text over limit with marker', () => {
    const bigText = 'A'.repeat(20000); // ~5000 tokens
    const result = compressTruncate({ type: 'text', text: bigText }, 1000);
    expect(result.text).toContain('[... truncated');
    expect(result.text).toContain('tokens ...]');
    expect(result.text!.length).toBeLessThan(bigText.length);
  });

  it('keeps head (70%) and tail (30%)', () => {
    const result = compressTruncate({ type: 'text', text: 'A'.repeat(20000) }, 1000);
    const parts = result.text!.split('[... truncated');
    const head = parts[0];
    const tail = parts[1].split('...]')[1];
    // Head should be ~70% of budget (1000*4*0.7=2800 chars)
    expect(head.length).toBeGreaterThan(2500);
    expect(head.length).toBeLessThan(3100);
    // Tail should be ~30% of budget
    expect(tail.length).toBeGreaterThan(1000);
    expect(tail.length).toBeLessThan(1500);
  });

  it('passes through non-text blocks', () => {
    const block = { type: 'image', data: 'abc' };
    expect(compressTruncate(block, 2000)).toBe(block);
  });
});
