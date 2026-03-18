import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const PREFIX = '[compress-on-input]';
const LOG_DIR = path.join(os.homedir(), '.local', 'share', 'compress-on-input');
const LOG_FILE = path.join(LOG_DIR, 'events.jsonl');
const DEBUG_FILE = path.join(LOG_DIR, 'debug.jsonl');

let verboseEnabled = false;
let debugLogEnabled = false;
let logDirReady = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export function setDebugLog(enabled: boolean): void {
  debugLogEnabled = enabled;
}

export function log(message: string): void {
  if (verboseEnabled) {
    process.stderr.write(`${PREFIX} ${message}\n`);
  }
}

export function logAlways(message: string): void {
  process.stderr.write(`${PREFIX} ${message}\n`);
}

export function logError(message: string): void {
  process.stderr.write(`${PREFIX} ERROR: ${message}\n`);
}

export interface EventRecord {
  ts: string;
  tool: string;
  strategy: string;
  before: number;
  after: number;
  reduction: string;
  duration_ms: number;
  content_type?: string;
  action?: string;
  tool_input?: Record<string, unknown>;
}

export interface DebugRecord extends EventRecord {
  session_id?: string;
  full_tool_name?: string;
  block_types?: string[];
  block_sizes?: number[];
  compressed_preview?: string;
  original_preview?: string;
}

function ensureLogDir(): void {
  if (logDirReady) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logDirReady = true;
  } catch {
    // silently fail — logging should never break compression
  }
}

function appendFile(filePath: string, data: string): void {
  ensureLogDir();
  try {
    fs.appendFileSync(filePath, data + '\n');
  } catch {
    // silently fail
  }
}

export function logEvent(event: EventRecord): void {
  appendFile(LOG_FILE, JSON.stringify(event));
}

export function logDebug(record: DebugRecord): void {
  if (!debugLogEnabled) return;
  appendFile(DEBUG_FILE, JSON.stringify(record));
}

export function logSkip(
  toolName: string,
  reason: string,
  tokens: number,
  toolInput?: Record<string, unknown>,
  extra?: Partial<DebugRecord>,
): void {
  const event: EventRecord = {
    ts: new Date().toISOString(),
    tool: toolName,
    strategy: 'skip',
    before: tokens,
    after: tokens,
    reduction: '0%',
    duration_ms: 0,
    action: reason,
    tool_input: toolInput ? summarizeInput(toolInput) : undefined,
  };
  logEvent(event);
  logDebug({ ...event, ...extra, tool_input: toolInput });
}

/** Keep only short string values from tool_input (URLs, paths, queries) — not full payloads */
function summarizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input)) {
    if (typeof val === 'string') {
      result[key] = val.length > 200 ? val.slice(0, 200) + '...' : val;
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      result[key] = val;
    }
  }
  return result;
}

/** First N chars of text for debug preview */
function preview(text: string | undefined, maxLen = 500): string | undefined {
  if (!text) return undefined;
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

export function logStats(
  toolName: string,
  beforeTokens: number,
  afterTokens: number,
  strategy?: string,
  contentType?: string,
  startTime?: number,
  toolInput?: Record<string, unknown>,
  debugExtra?: Partial<DebugRecord>,
): void {
  const reduction = ((1 - afterTokens / beforeTokens) * 100).toFixed(1);
  log(`${toolName}: ${beforeTokens.toLocaleString()} → ${afterTokens.toLocaleString()} tokens (${reduction}% reduction)`);

  const duration_ms = startTime ? Date.now() - startTime : 0;

  const event: EventRecord = {
    ts: new Date().toISOString(),
    tool: toolName,
    strategy: strategy ?? 'auto',
    before: beforeTokens,
    after: afterTokens,
    reduction: `${reduction}%`,
    duration_ms,
    content_type: contentType,
    action: 'compressed',
    tool_input: toolInput ? summarizeInput(toolInput) : undefined,
  };
  logEvent(event);
  logDebug({ ...event, ...debugExtra, tool_input: toolInput });
}

export { preview };
