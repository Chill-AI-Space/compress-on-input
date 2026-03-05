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

  const firstKeys = Object.keys(arr[0] as Record<string, unknown>).sort();

  const isHomogeneous = arr.every((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
    const keys = Object.keys(item as Record<string, unknown>).sort();
    return keys.length === firstKeys.length && keys.every((k, i) => k === firstKeys[i]);
  });

  return isHomogeneous ? firstKeys : null;
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

  const collapsed = collapseValue(parsed, 0, DEFAULT_MAX_DEPTH, DEFAULT_MAX_ARRAY_ITEMS);
  const collapsedText = JSON.stringify(collapsed, null, 2);

  // If collapsed is still bigger than original (shouldn't happen but safety check)
  if (estimateTokens(collapsedText) >= tokens) return block;

  return {
    type: 'text',
    text: `[JSON collapsed — original had ${tokens.toLocaleString()} tokens]\n${collapsedText}`,
  };
}
