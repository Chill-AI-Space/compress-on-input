import { describe, it, expect } from 'vitest';
import { compressJsonCollapse } from '../src/compressors/json-collapse.js';

describe('compressJsonCollapse', () => {
  it('passes through small JSON', () => {
    const block = { type: 'text', text: '{"name": "test"}' };
    const result = compressJsonCollapse(block, 2000);
    expect(result.text).toBe('{"name": "test"}');
  });

  it('renders tabular arrays as MD table', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `item-${i}`, email: `${i}@test.com` }));
    const block = { type: 'text', text: JSON.stringify(items) };
    const result = compressJsonCollapse(block, 100); // force compression
    expect(result.text).toContain('[JSON → table');
    expect(result.text).toContain('| id | name | email |');  // header
    expect(result.text).toContain('| --- | --- | --- |');     // separator
    expect(result.text).toContain('item-0');
    expect(result.text).toContain('item-49');  // MD table keeps all rows (up to 100)
  });

  it('renders homogeneous array as table with all columns', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: i, name: `n${i}` }));
    const block = { type: 'text', text: JSON.stringify(items) };
    const result = compressJsonCollapse(block, 100);
    expect(result.text).toContain('| id | name |');
    expect(result.text).toContain('n0');
    expect(result.text).toContain('n19');
  });

  it('strips null and empty values from objects', () => {
    const obj = { name: 'test', empty: '', nothing: null, items: [], data: 'keep' };
    const block = { type: 'text', text: JSON.stringify(obj) };
    const result = compressJsonCollapse(block, 5); // force compression
    const parsed = JSON.parse(result.text!.split('\n').slice(1).join('\n'));
    expect(parsed.name).toBe('test');
    expect(parsed.data).toBe('keep');
    expect(parsed.empty).toBeUndefined();
    expect(parsed.nothing).toBeUndefined();
    expect(parsed.items).toBeUndefined();
  });

  it('passes through non-JSON text', () => {
    const block = { type: 'text', text: 'this is not json at all '.repeat(500) };
    const result = compressJsonCollapse(block, 100);
    // Should return original since it's not JSON
    expect(result.text).toBe(block.text);
  });

  it('passes through non-text blocks', () => {
    const block = { type: 'image', data: 'abc' };
    expect(compressJsonCollapse(block, 2000)).toBe(block);
  });

  it('collapses deeply nested structures', () => {
    // Build a structure deep enough with enough data to exceed maxTokens
    let obj: any = { value: 'x'.repeat(200), extra: 'y'.repeat(200) };
    for (let i = 0; i < 10; i++) {
      obj = { [`level${i}`]: obj, padding: 'z'.repeat(100) };
    }
    const block = { type: 'text', text: JSON.stringify(obj) };
    const result = compressJsonCollapse(block, 100);
    expect(result.text).toContain('[JSON collapsed');
  });
});
