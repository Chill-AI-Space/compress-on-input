import { describe, it, expect } from 'vitest';
import { compressDomCleanup } from '../src/compressors/dom-cleanup.js';

describe('compressDomCleanup', () => {
  it('strips [cursor=pointer] from all elements', () => {
    const result = compressDomCleanup({
      type: 'text',
      text: '- button "Submit" [ref=e42] [cursor=pointer]',
    });
    expect(result.text).not.toContain('[cursor=pointer]');
    expect(result.text).toContain('[ref=e42]');
  });

  it('keeps refs on interactive elements (button, link, combobox)', () => {
    const result = compressDomCleanup({
      type: 'text',
      text: '- button "Submit" [ref=e42]\n- link "Home" [ref=e7]\n- combobox "Search" [ref=e10]',
    });
    expect(result.text).toContain('[ref=e42]');
    expect(result.text).toContain('[ref=e7]');
    expect(result.text).toContain('[ref=e10]');
  });

  it('strips refs from non-interactive elements', () => {
    const result = compressDomCleanup({
      type: 'text',
      text: '- heading "Title" [ref=e5]\n- paragraph [ref=e6]\n- list [ref=e8]',
    });
    expect(result.text).not.toContain('[ref=e5]');
    expect(result.text).not.toContain('[ref=e6]');
    expect(result.text).not.toContain('[ref=e8]');
  });

  it('strips generic roles', () => {
    const result = compressDomCleanup({
      type: 'text',
      text: '- div role="generic" [ref=e1]',
    });
    expect(result.text).not.toContain('role="generic"');
  });

  it('strips empty img nodes', () => {
    const result = compressDomCleanup({
      type: 'text',
      text: '    - button "X" [ref=e1]\n      - img\n    - link "Y" [ref=e2]',
    });
    expect(result.text).not.toMatch(/^\s*- img\s*$/m);
    expect(result.text).toContain('button "X"');
    expect(result.text).toContain('link "Y"');
  });

  it('keeps img with alt text', () => {
    const result = compressDomCleanup({
      type: 'text',
      text: '- img "avatar" [ref=e5]',
    });
    expect(result.text).toContain('img "avatar"');
  });

  it('strips row descriptions that duplicate cell content', () => {
    const result = compressDomCleanup({
      type: 'text',
      text: '- \'row "Name Age City" [ref=e10]\':\n  - cell "Name":\n  - cell "Age":',
    });
    expect(result.text).not.toContain('Name Age City');
    expect(result.text).toContain('row');
    expect(result.text).toContain('cell "Name"');
  });

  it('strips footer/contentinfo sections', () => {
    const result = compressDomCleanup({
      type: 'text',
      text: '- main:\n  - heading "Content"\n- contentinfo [ref=e50]:\n  - heading "Footer"\n  - link "Terms" [ref=e51]',
    });
    expect(result.text).toContain('heading "Content"');
    expect(result.text).not.toContain('Terms');
  });

  it('collapses multiple blank lines', () => {
    const result = compressDomCleanup({
      type: 'text',
      text: '- main:\n  - heading "A"\n\n\n\n\n  - heading "B" [ref=e1]',
    });
    // Should not have 3+ consecutive newlines
    expect(result.text).not.toMatch(/\n{3,}/);
  });

  it('passes through non-text blocks', () => {
    const block = { type: 'image', data: 'abc' };
    expect(compressDomCleanup(block)).toBe(block);
  });

  it('returns original if cleanup made it bigger', () => {
    // A very short text where cleanup adds nothing but doesn't remove
    const block = { type: 'text', text: 'hi' };
    const result = compressDomCleanup(block);
    expect(result).toBe(block);
  });

  it('achieves significant reduction on real-world DOM', () => {
    const realDom = `- generic [ref=e2]:
  - banner [ref=e6]:
    - heading "Nav" [level=2] [ref=e7]
    - generic [ref=e8]:
      - link "Home" [ref=e10] [cursor=pointer]:
        - /url: /
        - img [ref=e11]
      - button "Menu" [ref=e20] [cursor=pointer]:
        - img [ref=e21]
  - main [ref=e30]:
    - heading "Page Title" [level=1] [ref=e31]
    - paragraph [ref=e32]: Some content here
    - generic [ref=e33]:
      - generic [ref=e34]:
        - link "Click me" [ref=e35] [cursor=pointer]:
          - /url: /action
  - contentinfo [ref=e50]:
    - heading "Footer" [level=2] [ref=e51]
    - link "Terms" [ref=e52] [cursor=pointer]:
      - /url: /terms
    - link "Privacy" [ref=e53] [cursor=pointer]:
      - /url: /privacy`;

    const result = compressDomCleanup({ type: 'text', text: realDom });
    const reduction = 1 - result.text!.length / realDom.length;
    // Should achieve at least 20% reduction
    expect(reduction).toBeGreaterThan(0.2);
    // Should keep interactive refs
    expect(result.text).toContain('[ref=e10]');
    expect(result.text).toContain('[ref=e20]');
    expect(result.text).toContain('[ref=e35]');
    // Should strip non-interactive refs
    expect(result.text).not.toContain('[ref=e2]');
    expect(result.text).not.toContain('[ref=e31]');
    // Should strip footer
    expect(result.text).not.toContain('Terms');
    expect(result.text).not.toContain('Privacy');
  });
});
