import { describe, it, expect } from 'vitest';
import { compressDomCleanup } from '../src/compressors/dom-cleanup.js';

describe('compressDomCleanup', () => {
  it('strips [ref=N] from text', () => {
    const result = compressDomCleanup({
      type: 'text',
      text: '- button "Submit" [ref=42]\n- link "Home" [ref=7]',
    });
    expect(result.text).not.toContain('[ref=42]');
    expect(result.text).not.toContain('[ref=7]');
    expect(result.text).toContain('button "Submit"');
  });

  it('adds mapping table with refs', () => {
    const result = compressDomCleanup({
      type: 'text',
      text: '- button "Submit" [ref=42]\n- link "Home" [ref=7]',
    });
    expect(result.text).toContain('[Element references]');
    expect(result.text).toContain('button "Submit" → ref=42');
    expect(result.text).toContain('link "Home" → ref=7');
  });

  it('strips generic roles', () => {
    const result = compressDomCleanup({
      type: 'text',
      text: '- div role="generic" [ref=1]',
    });
    expect(result.text).not.toContain('role="generic"');
  });

  it('collapses multiple blank lines', () => {
    const result = compressDomCleanup({
      type: 'text',
      text: 'line1\n\n\n\n\nline2',
    });
    expect(result.text).toContain('line1\n\nline2');
  });

  it('handles alphanumeric refs (Playwright format)', () => {
    const result = compressDomCleanup({
      type: 'text',
      text: '- heading "Example Domain" [ref=e2]\n- link "More info" [ref=s4e]',
    });
    expect(result.text).not.toContain('[ref=e2]');
    expect(result.text).not.toContain('[ref=s4e]');
    expect(result.text).toContain('heading "Example Domain" → ref=e2');
    expect(result.text).toContain('link "More info" → ref=s4e');
  });

  it('passes through non-text blocks', () => {
    const block = { type: 'image', data: 'abc' };
    expect(compressDomCleanup(block)).toBe(block);
  });
});
