import { describe, it, expect, vi } from 'vitest';
import { compressResult, isScreenshotTool } from '../src/pipeline.js';
import { Config } from '../src/config.js';

// Deterministic OCR stub: any image "recognized" as text. Lets tests assert the
// routing decision without depending on Apple Vision / Tesseract being installed.
vi.mock('../src/compressors/ocr.js', () => ({
  compressOCR: (block: { type: string; data?: string }) =>
    block.type === 'image' && block.data
      ? { type: 'text', text: '[OCR extracted from screenshot — may contain errors]\nHELLO WORLD' }
      : block,
}));

const baseConfig: Config = {
  imageOcr: true,
  jsonCollapse: true,
  textCompressionThreshold: 100_000,
  compressionPrompt: 'Shorten. Target: {TARGET} tokens.',
  ocrEngine: 'auto',
  verbose: false,
  dryRun: false,
  rules: [
    { toolName: 'browser_snapshot', strategy: 'dom-cleanup' },
    { toolNamePattern: '.*', strategy: 'auto' },
  ],
};

/** Get all text from content blocks joined */
function allText(result: { content?: Array<{ type: string; text?: string; data?: string }> }): string {
  return (result.content ?? []).map((b) => b.text ?? '').join('\n');
}

describe('compressResult', () => {
  it('passes through small text results (no compression needed)', async () => {
    const result = { content: [{ type: 'text', text: 'small' }] };
    const compressed = await compressResult('some_tool', result, baseConfig);
    expect(compressed.content![0].text).toBe('small');
  });

  it('passes through empty results', async () => {
    const result = { content: [] };
    const compressed = await compressResult('some_tool', result, baseConfig);
    expect(compressed.content).toEqual([]);
  });

  it('passes through results without content', async () => {
    const result = { something: 'else' };
    const compressed = await compressResult('some_tool', result, baseConfig);
    expect(compressed).toEqual(result);
  });

  it('passes through medium text (below 100k threshold)', async () => {
    // ~30k tokens — well below 100k threshold
    const mediumText = Array.from({ length: 1000 }, (_, i) =>
      `Line ${i}: ${'content '.repeat(25)}`
    ).join('\n');
    const result = { content: [{ type: 'text', text: mediumText }] };
    const compressed = await compressResult('unknown_tool', result, baseConfig);
    // Should NOT compress — text is below threshold
    expect(compressed).toBe(result);
  });

  it('passes through images when no file path in result', async () => {
    const fakeBase64 = 'A'.repeat(5000);
    const result = { content: [{ type: 'image', data: fakeBase64, mimeType: 'image/png' }] };
    const compressed = await compressResult('generate_image', result, baseConfig);
    const images = (compressed.content ?? []).filter((b) => b.type === 'image');
    expect(images[0].data).toBe(fakeBase64);
  });

  it('applies json-collapse for large JSON arrays', async () => {
    const items = Array.from({ length: 500 }, (_, i) => ({
      id: i, name: `item-${i}`, email: `user${i}@example.com`,
      bio: `This is the biography for user number ${i} with some extra text`,
    }));
    const bigJson = JSON.stringify(items);
    const result = { content: [{ type: 'text', text: bigJson }] };
    const compressed = await compressResult('db_query', result, baseConfig);
    const text = allText(compressed);
    expect(text).toContain('[compress-on-input:');
    expect(text).toContain('[JSON → table');
    expect(text).toContain('item-0');
    expect(text).toContain('| id |');  // table header
  });

  it('respects jsonCollapse=false', async () => {
    const items = Array.from({ length: 500 }, (_, i) => ({
      id: i, name: `item-${i}`,
    }));
    const bigJson = JSON.stringify(items);
    const result = { content: [{ type: 'text', text: bigJson }] };
    const noJsonConfig = { ...baseConfig, jsonCollapse: false };
    const compressed = await compressResult('db_query', result, noJsonConfig);
    // Should pass through — JSON collapse disabled
    expect(compressed).toBe(result);
  });

  it('dry-run does not modify result', async () => {
    const items = Array.from({ length: 500 }, (_, i) => ({
      id: i, name: `item-${i}`, email: `user${i}@example.com`,
    }));
    const bigJson = JSON.stringify(items);
    const result = { content: [{ type: 'text', text: bigJson }] };
    const dryConfig = { ...baseConfig, dryRun: true };
    const compressed = await compressResult('unknown_tool', result, dryConfig);
    expect(compressed.content![0].text).toBe(bigJson);
  });

  it('summary includes compression stats', async () => {
    const items = Array.from({ length: 500 }, (_, i) => ({
      id: i, name: `item-${i}`, email: `user${i}@example.com`,
      bio: `This is the biography for user number ${i}`,
    }));
    const bigJson = JSON.stringify(items);
    const result = { content: [{ type: 'text', text: bigJson }] };
    const compressed = await compressResult('db_query', result, baseConfig);
    const summary = compressed.content![0].text!;
    expect(summary).toContain('[compress-on-input:');
    expect(summary).toContain('tokens');
  });
});

describe('isScreenshotTool', () => {
  it('detects known screenshot tools by name', () => {
    expect(isScreenshotTool('browser_take_screenshot')).toBe(true);
    expect(isScreenshotTool('browser_screenshot')).toBe(true);
    expect(isScreenshotTool('take_screenshot')).toBe(true);
  });

  it('detects a direct screenshot/zoom action (Claude-in-Chrome computer tool)', () => {
    expect(isScreenshotTool('computer', { action: 'screenshot' })).toBe(true);
    expect(isScreenshotTool('computer', { action: 'zoom' })).toBe(true);
  });

  it('detects a nested screenshot action (browser_batch)', () => {
    const input = {
      actions: [
        { name: 'computer', input: { action: 'wait', duration: 2 } },
        { name: 'computer', input: { action: 'screenshot' } },
      ],
    };
    expect(isScreenshotTool('browser_batch', input)).toBe(true);
  });

  it('does not treat interactive/non-screenshot tools as screenshots', () => {
    expect(isScreenshotTool('computer', { action: 'left_click', coordinate: [1, 2] })).toBe(false);
    expect(isScreenshotTool('browser_batch', { actions: [{ name: 'navigate', input: { url: 'x' } }] })).toBe(false);
    expect(isScreenshotTool('generate_image')).toBe(false);
    expect(isScreenshotTool('db_query', { query: 'select 1' })).toBe(false);
  });
});

describe('image OCR routing', () => {
  const fakeBase64 = 'A'.repeat(5000);
  const imageResult = () => ({ content: [{ type: 'image', data: fakeBase64, mimeType: 'image/png' }] });

  it('OCRs a Claude-in-Chrome computer screenshot (no file path in result)', async () => {
    const compressed = await compressResult('computer', imageResult(), baseConfig, undefined, { action: 'screenshot' });
    const images = (compressed.content ?? []).filter((b) => b.type === 'image');
    expect(images).toHaveLength(0);
    expect(allText(compressed)).toContain('[OCR extracted from screenshot');
  });

  it('OCRs a screenshot nested in browser_batch actions', async () => {
    const input = { actions: [{ name: 'computer', input: { action: 'screenshot' } }] };
    const compressed = await compressResult('browser_batch', imageResult(), baseConfig, undefined, input);
    expect(allText(compressed)).toContain('[OCR extracted from screenshot');
  });

  it('does not OCR a browser_batch with no screenshot action', async () => {
    const input = { actions: [{ name: 'navigate', input: { url: 'https://example.com' } }] };
    const compressed = await compressResult('browser_batch', imageResult(), baseConfig, undefined, input);
    const images = (compressed.content ?? []).filter((b) => b.type === 'image');
    expect(images).toHaveLength(1);
    expect(images[0].data).toBe(fakeBase64);
  });
});
