import { estimateTokens } from '../classifier.js';

interface ContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

const DEFAULT_MAX_ARRAY_ITEMS = 3;  // show first N items of long arrays
const DEFAULT_MAX_DEPTH = 5;        // collapse deeper nesting
const ARRAY_THRESHOLD = 10;         // arrays shorter than this pass through
const TABLE_MAX_ROWS = 100;         // max rows in MD table before truncating
const TABLE_MAX_COLS = 15;          // max columns in MD table

/**
 * Tries to parse text as JSON. Returns null if not valid JSON.
 */
function tryParseJSON(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Detect if an array has homogeneous structure (all objects with same keys).
 */
function getArraySchema(arr: unknown[]): string[] | null {
  if (arr.length === 0) return null;
  if (typeof arr[0] !== 'object' || arr[0] === null || Array.isArray(arr[0])) return null;

  const originalKeys = Object.keys(arr[0] as Record<string, unknown>);
  const sortedKeys = [...originalKeys].sort();

  const isHomogeneous = arr.every((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
    const keys = Object.keys(item as Record<string, unknown>).sort();
    return keys.length === sortedKeys.length && keys.every((k, i) => k === sortedKeys[i]);
  });

  return isHomogeneous ? originalKeys : null;
}

function isScalar(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const t = typeof value;
  return t === 'string' || t === 'number' || t === 'boolean';
}

function isTabular(arr: unknown[], schema: string[]): boolean {
  if (schema.length > TABLE_MAX_COLS) return false;
  if (arr.length < 2) return false;

  let scalarCount = 0;
  let totalCount = 0;
  for (const item of arr.slice(0, 20)) {
    const obj = item as Record<string, unknown>;
    for (const key of schema) {
      totalCount++;
      if (isScalar(obj[key])) scalarCount++;
    }
  }
  return scalarCount / totalCount >= 0.7;
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const s = JSON.stringify(value);
    return s.length > 80 ? s.slice(0, 77) + '...' : s;
  }
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderMdTable(arr: unknown[], schema: string[]): string {
  const lines: string[] = [];

  lines.push('| ' + schema.join(' | ') + ' |');
  lines.push('| ' + schema.map(() => '---').join(' | ') + ' |');

  const rowsToShow = Math.min(arr.length, TABLE_MAX_ROWS);
  for (let i = 0; i < rowsToShow; i++) {
    const obj = arr[i] as Record<string, unknown>;
    const cells = schema.map(key => escapeCell(obj[key]));
    lines.push('| ' + cells.join(' | ') + ' |');
  }

  if (arr.length > TABLE_MAX_ROWS) {
    lines.push(`| ... ${arr.length - TABLE_MAX_ROWS} more rows (${arr.length} total) | ${schema.slice(1).map(() => '').join(' | ')} |`);
  }

  return lines.join('\n');
}

function tryRenderAsTable(parsed: unknown): string | null {
  if (Array.isArray(parsed)) {
    const schema = getArraySchema(parsed);
    if (schema && isTabular(parsed, schema)) {
      return renderMdTable(parsed, schema);
    }
    return null;
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    const keys = Object.keys(obj);

    for (const key of keys) {
      const val = obj[key];
      if (Array.isArray(val) && val.length >= 2) {
        const schema = getArraySchema(val);
        if (schema && isTabular(val, schema)) {
          const meta = keys
            .filter(k => k !== key && isScalar(obj[k]))
            .map(k => `${k}: ${obj[k]}`)
            .join(' | ');

          const table = renderMdTable(val, schema);
          return meta ? `${meta}\n\n${table}` : table;
        }
      }
    }
  }

  return null;
}

/**
 * Collapse a JSON value, respecting depth and array limits.
 */
function collapseValue(
  value: unknown,
  depth: number,
  maxDepth: number,
  maxArrayItems: number,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  if (depth >= maxDepth) {
    if (Array.isArray(value)) return `[... ${value.length} items]`;
    const keys = Object.keys(value as Record<string, unknown>);
    return `{${keys.join(', ')} — ${keys.length} keys}`;
  }

  if (Array.isArray(value)) {
    if (value.length <= ARRAY_THRESHOLD) {
      return value.map((v) => collapseValue(v, depth + 1, maxDepth, maxArrayItems));
    }

    // Long array — show first N items + summary
    const schema = getArraySchema(value);
    const sample = value
      .slice(0, maxArrayItems)
      .map((v) => collapseValue(v, depth + 1, maxDepth, maxArrayItems));

    const omitted = value.length - maxArrayItems;

    if (schema) {
      return [
        ...sample,
        `... ${omitted} more items with same shape {${schema.join(', ')}}`,
      ];
    }
    return [
      ...sample,
      `... ${omitted} more items (${value.length} total)`,
    ];
  }

  // Object
  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    // Strip null, empty strings, empty arrays
    if (val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
      continue;
    }
    result[key] = collapseValue(val, depth + 1, maxDepth, maxArrayItems);
  }

  return result;
}

export function compressJsonCollapse(
  block: ContentBlock,
  maxTokens: number,
): ContentBlock {
  if (block.type !== 'text' || !block.text) return block;

  const tokens = estimateTokens(block.text);
  if (tokens <= maxTokens) return block;

  const parsed = tryParseJSON(block.text);
  if (parsed === null) return block; // not JSON — fall through to truncate

  // Try MD table first — better compression for tabular data
  const tableResult = tryRenderAsTable(parsed);
  if (tableResult !== null) {
    const tableTokens = estimateTokens(tableResult);
    if (tableTokens < tokens) {
      return {
        type: 'text',
        text: `[JSON → table — ${tokens.toLocaleString()} tokens → ${tableTokens.toLocaleString()}]\n${tableResult}`,
      };
    }
  }

  // Fallback: standard JSON collapse
  const collapsed = collapseValue(parsed, 0, DEFAULT_MAX_DEPTH, DEFAULT_MAX_ARRAY_ITEMS);
  const collapsedText = JSON.stringify(collapsed, null, 2);

  // If collapsed is still bigger than original (shouldn't happen but safety check)
  if (estimateTokens(collapsedText) >= tokens) return block;

  return {
    type: 'text',
    text: `[JSON collapsed — original had ${tokens.toLocaleString()} tokens]\n${collapsedText}`,
  };
}
