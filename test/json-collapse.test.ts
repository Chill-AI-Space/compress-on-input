import { describe, it, expect } from 'vitest';
import { compressJsonCollapse } from '../src/compressors/json-collapse.js';

describe('compressJsonCollapse', () => {
  it('passes through small JSON', () => {
    const block = { type: 'text', text: '{"name": "test"}' };
    const result = compressJsonCollapse(block, 2000);
    expect(result.text).toBe('{"name": "test"}');
  });

  it('collapses long arrays to first 3 items + summary', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `item-${i}`, email: `${i}@test.com` }));
    const block = { type: 'text', text: JSON.stringify(items) };
    const result = compressJsonCollapse(block, 100); // force compression
    expect(result.text).toContain('[JSON collapsed');
    expect(result.text).toContain('item-0');
    expect(result.text).toContain('item-1');
    expect(result.text).toContain('item-2');
    expect(result.text).not.toContain('item-49');
    expect(result.text).toContain('more items');
  });

  it('detects homogeneous array schema', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: i, name: `n${i}` }));
    const block = { type: 'text', text: JSON.stringify(items) };
    const result = compressJsonCollapse(block, 100);
    expect(result.text).toContain('same shape');
    expect(result.text).toContain('id');
    expect(result.text).toContain('name');
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
