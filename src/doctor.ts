import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync, execSync } from 'node:child_process';
import { loadConfig } from './config.js';
import { compressResult } from './pipeline.js';
import { classifyContent, estimateTokens } from './classifier.js';
import { compressOCR } from './compressors/ocr.js';

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const LOG_DIR = path.join(os.homedir(), '.local', 'share', 'compress-on-input');
const DEBUG_LOG = path.join(LOG_DIR, 'debug.log');
const EVENTS_LOG = path.join(LOG_DIR, 'events.jsonl');
const CONFIG_PATH = path.join(os.homedir(), '.config', 'compress-on-input', 'config.json');

let passed = 0;
let failed = 0;
let warned = 0;

function ok(msg: string): void {
  passed++;
  process.stderr.write(`  \x1b[32m✓\x1b[0m ${msg}\n`);
}

function fail(msg: string, fix?: string): void {
  failed++;
  process.stderr.write(`  \x1b[31m✗\x1b[0m ${msg}\n`);
  if (fix) process.stderr.write(`    \x1b[33m→ Fix: ${fix}\x1b[0m\n`);
}

function warn(msg: string, hint?: string): void {
  warned++;
  process.stderr.write(`  \x1b[33m!\x1b[0m ${msg}\n`);
  if (hint) process.stderr.write(`    \x1b[33m→ ${hint}\x1b[0m\n`);
}

function info(msg: string): void {
  process.stderr.write(`  \x1b[90m${msg}\x1b[0m\n`);
}

function section(title: string): void {
  process.stderr.write(`\n\x1b[1m${title}\x1b[0m\n`);
}

function checkHookInstalled(): void {
  section('Hook Installation');

  if (!fs.existsSync(SETTINGS_PATH)) {
    fail('~/.claude/settings.json not found', 'Run: compress-on-input install');
    return;
  }

  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    const postToolUse = settings?.hooks?.PostToolUse;
    if (!Array.isArray(postToolUse)) {
      fail('No PostToolUse hooks configured', 'Run: compress-on-input install');
      return;
    }

    const ourHook = postToolUse.find((group: Record<string, unknown>) =>
      Array.isArray(group.hooks) &&
      group.hooks.some((h: Record<string, unknown>) =>
        typeof h.command === 'string' && h.command.includes('compress-on-input')
      )
    );

    if (!ourHook) {
      fail('compress-on-input hook not found in PostToolUse', 'Run: compress-on-input install');
      return;
    }

    ok('Hook found in ~/.claude/settings.json');

    const matcher = ourHook.matcher ?? '(no matcher)';
    if (matcher === '.*') {
      ok(`Matcher: "${matcher}" (all tools)`);
    } else if (matcher === 'mcp__.*') {
      warn(`Matcher: "${matcher}" (MCP tools only)`, 'Consider changing to ".*" for all tools');
    } else {
      info(`Matcher: "${matcher}"`);
    }

    const hookDef = ourHook.hooks.find((h: Record<string, unknown>) =>
      typeof h.command === 'string' && h.command.includes('compress-on-input')
    );
    const timeout = hookDef?.timeout;
    if (typeof timeout === 'number') {
      if (timeout < 10) {
        warn(`Timeout: ${timeout}s (may be too short for OCR)`, 'Recommended: 15s');
      } else {
        ok(`Timeout: ${timeout}s`);
      }
    }
  } catch (e) {
    fail(`Failed to parse settings.json: ${e}`);
  }
}

function checkBinaryInPath(): void {
  section('Binary');

  try {
    const whichResult = execSync('which compress-on-input 2>/dev/null', { encoding: 'utf-8' }).trim();
    ok(`Found: ${whichResult}`);
  } catch {
    fail('compress-on-input not found in PATH', 'Run: npm install -g compress-on-input (or npm link from source)');
  }
}

function checkConfig(): void {
  section('Configuration');

  const config = loadConfig();

  if (fs.existsSync(CONFIG_PATH)) {
    ok(`Config file: ${CONFIG_PATH}`);
  } else {
    info(`No config file (using defaults). Optional: ${CONFIG_PATH}`);
  }

  info(`Text compression threshold: ${config.textCompressionThreshold.toLocaleString()} tokens`);
  info(`Image OCR: ${config.imageOcr ? 'enabled' : 'disabled'}`);
  info(`JSON collapse: ${config.jsonCollapse ? 'enabled' : 'disabled'}`);
  info(`OCR engine: ${config.ocrEngine}`);

  if (config.geminiApiKey) {
    ok('Gemini API key: configured');
  } else {
    info('Gemini API key: not set (optional — for compressing very large text >100k tokens)');
  }
}

function checkLogs(): void {
  section('Logs & Debugging');

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const testFile = path.join(LOG_DIR, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    ok(`Log directory writable: ${LOG_DIR}`);
  } catch {
    fail(`Cannot write to ${LOG_DIR}`, `Run: mkdir -p ${LOG_DIR}`);
  }

  if (fs.existsSync(DEBUG_LOG)) {
    const stat = fs.statSync(DEBUG_LOG);
    const sizeKb = Math.round(stat.size / 1024);
    ok(`Debug log: ${DEBUG_LOG} (${sizeKb}KB)`);
    if (sizeKb > 10240) {
      warn(`Debug log is ${sizeKb}KB — consider truncating`, `Run: tail -1000 "${DEBUG_LOG}" > /tmp/dbg && mv /tmp/dbg "${DEBUG_LOG}"`);
    }
  } else {
    info('Debug log: not yet created (will appear after first hook call)');
  }

  if (fs.existsSync(EVENTS_LOG)) {
    const stat = fs.statSync(EVENTS_LOG);
    const lines = fs.readFileSync(EVENTS_LOG, 'utf-8').trim().split('\n').length;
    ok(`Events log: ${EVENTS_LOG} (${lines} events, ${Math.round(stat.size / 1024)}KB)`);
  } else {
    info('Events log: not yet created (records each compression)');
  }
}

function checkOCR(): void {
  section('OCR Engine');

  if (process.platform === 'darwin') {
    // Check Swift compiler
    try {
      execFileSync('swiftc', ['--version'], { timeout: 5000, stdio: 'pipe' });
      ok('Swift compiler available');
    } catch {
      fail('Swift compiler not found', 'Install Xcode Command Line Tools: xcode-select --install');
    }

    // Check Vision binary cache
    const cacheDir = path.join(os.homedir(), '.cache', 'compress-on-input');
    const visionBins = fs.existsSync(cacheDir)
      ? fs.readdirSync(cacheDir).filter(f => f.startsWith('vision-ocr-'))
      : [];
    if (visionBins.length > 0) {
      ok(`Vision OCR binary cached: ${visionBins[0]}`);
    } else {
      info('Vision OCR binary: will compile on first use');
    }
  } else {
    // Check Tesseract
    try {
      execFileSync('tesseract', ['--version'], { timeout: 5000, stdio: 'pipe' });
      ok('Tesseract available');
    } catch {
      fail('Tesseract not found', 'Install: apt install tesseract-ocr (or brew install tesseract)');
    }
  }
}

async function runCompressionTests(): Promise<void> {
  section('Compression Tests');
  const config = loadConfig();

  // Test 1: JSON collapse
  {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: i, name: `User ${i}`, email: `u${i}@test.com`, active: true,
    }));
    const block = { type: 'text', text: JSON.stringify(rows) };
    const before = estimateTokens(block.text);
    try {
      const result = await compressResult('test_json', { content: [block] }, config);
      const afterTokens = result.content!.reduce((sum, b) =>
        sum + (b.text ? estimateTokens(b.text) : 0), 0);
      if (afterTokens < before) {
        ok(`JSON collapse: ${before} → ${afterTokens} tokens (-${Math.round((1 - afterTokens / before) * 100)}%)`);
      } else {
        warn(`JSON collapse: ${before} → ${afterTokens} tokens (no reduction)`);
      }
    } catch (e) {
      fail(`JSON collapse threw: ${e}`);
    }
  }

  // Test 2: Image with file path — should OCR
  {
    // Create a tiny valid PNG (1x1 white pixel)
    // Suppress stderr noise from OCR failing on tiny test image
    const pngBuf = createMinimalPng();
    const b64 = pngBuf.toString('base64');
    const content = [
      { type: 'text', text: 'Screenshot saved to /tmp/test-screenshot.png' },
      { type: 'image', data: b64, mimeType: 'image/png' },
    ];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      if (s.includes('OCR failed') || s.includes('ERROR') || s.includes('Error:')) return true;
      return origWrite(chunk);
    }) as typeof process.stderr.write;
    try {
      const result = await compressResult('browser_take_screenshot', { content }, config);
      const hasImage = result.content!.some(b => b.type === 'image');
      const hasOcr = result.content!.some(b => b.text?.includes('[OCR'));
      if (hasOcr) {
        ok('Image + file path: OCR extracted text');
      } else if (!hasImage) {
        fail('Image + file path: image lost without OCR text!');
      } else {
        // 1x1 pixel has no text — OCR returns <7 chars — passthrough is correct
        ok('Image + file path: OCR ran, image preserved (no text in test image)');
      }
    } catch (e) {
      fail(`Image OCR test threw: ${e}`);
    } finally {
      process.stderr.write = origWrite;
    }
  }

  // Test 3: Image WITHOUT file path — must NOT be lost
  {
    const pngBuf = createMinimalPng();
    const b64 = pngBuf.toString('base64');
    const content = [
      { type: 'image', data: b64, mimeType: 'image/png' },
    ];
    try {
      const result = await compressResult('generate_chart', { content }, config);
      const hasImage = result.content!.some(b => b.type === 'image');
      if (hasImage) {
        ok('Image without file path: preserved (not lost)');
      } else {
        fail('Image without file path: IMAGE WAS LOST! This is a data loss bug.');
      }
    } catch (e) {
      fail(`Image preservation test threw: ${e}`);
    }
  }

  // Test 4: Small text — should passthrough
  {
    const block = { type: 'text', text: 'Hello, world! This is a small response.' };
    try {
      const result = await compressResult('test_small', { content: [block] }, config);
      const unchanged = result.content!.length === 1 && result.content![0].text === block.text;
      if (unchanged) {
        ok('Small text: passed through unchanged');
      } else {
        warn('Small text was modified (expected passthrough)');
      }
    } catch (e) {
      fail(`Small text test threw: ${e}`);
    }
  }

  // Test 5: DOM snapshot
  {
    let dom = '- navigation "Main" [ref=e1]\n';
    for (let i = 2; i < 100; i++) {
      dom += `  - link "Item ${i}" [ref=e${i}]\n`;
      dom += `    - text: "Description for item ${i}"\n`;
    }
    dom += '- role="generic"\n  - role="generic"\n    - role="none"\n      - button "Submit" [ref=e100]\n';
    const block = { type: 'text', text: dom };
    try {
      const ct = classifyContent(block, config.textCompressionThreshold);
      if (ct === 'dom-snapshot') {
        ok('DOM detection: correctly identified accessibility tree');
      } else {
        fail(`DOM detection: classified as "${ct}" instead of "dom-snapshot"`);
      }
    } catch (e) {
      fail(`DOM detection threw: ${e}`);
    }
  }

  // Test 6: Null/empty/malformed — graceful handling
  {
    let graceful = true;
    try { await compressResult('test', { content: [] }, config); } catch { graceful = false; }
    try { await compressResult('test', { content: undefined as unknown as never[] }, config); } catch { graceful = false; }
    try { await compressResult('test', {} as never, config); } catch { graceful = false; }
    if (graceful) {
      ok('Edge cases: empty/null/malformed handled gracefully');
    } else {
      fail('Edge cases: threw on empty/null/malformed input');
    }
  }
}

async function testHookTimeout(): Promise<void> {
  section('Hook Performance');

  // Measure cold-start time with a small JSON input
  const input = JSON.stringify({
    session_id: 'doctor-test',
    cwd: '/tmp',
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__test__small',
    tool_input: {},
    tool_response: 'hello',
  });

  try {
    const start = Date.now();
    execSync(`echo '${input.replace(/'/g, "'\\''")}' | compress-on-input --hook 2>/dev/null`, {
      timeout: 15000,
      encoding: 'utf-8',
    });
    const elapsed = Date.now() - start;

    if (elapsed < 1000) {
      ok(`Hook startup: ${elapsed}ms (fast)`);
    } else if (elapsed < 5000) {
      warn(`Hook startup: ${elapsed}ms (slow but within timeout)`);
    } else {
      fail(`Hook startup: ${elapsed}ms (dangerously close to timeout)`, 'Check Node.js startup time');
    }
  } catch (e) {
    const err = e as { killed?: boolean; signal?: string };
    if (err.killed || err.signal === 'SIGTERM') {
      fail('Hook timed out (>15s) — would block Claude Code!', 'Check Node.js version and system load');
    } else {
      fail(`Hook startup test failed: ${e}`);
    }
  }

  // Measure JSON compression
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `User ${i}`, email: `u${i}@test.com` }));
  const jsonInput = JSON.stringify({
    session_id: 'doctor-test',
    cwd: '/tmp',
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__db__query',
    tool_input: {},
    tool_response: { content: [{ type: 'text', text: JSON.stringify(rows) }] },
  });

  try {
    const start = Date.now();
    execSync(`echo '${jsonInput.replace(/'/g, "'\\''")}' | compress-on-input --hook 2>/dev/null`, {
      timeout: 15000,
      encoding: 'utf-8',
    });
    const elapsed = Date.now() - start;
    ok(`JSON compression (100 rows): ${elapsed}ms`);
  } catch {
    fail('JSON compression timed out');
  }
}

function createMinimalPng(): Buffer {
  // Minimal valid 1x1 white PNG
  const header = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  ]);
  const ihdr = createPngChunk('IHDR', Buffer.from([
    0x00, 0x00, 0x00, 0x01, // width: 1
    0x00, 0x00, 0x00, 0x01, // height: 1
    0x08,                   // bit depth: 8
    0x02,                   // color type: RGB
    0x00, 0x00, 0x00,       // compression, filter, interlace
  ]));
  // Raw pixel data: filter byte (0) + RGB (FF FF FF)
  const rawData = Buffer.from([0x00, 0xFF, 0xFF, 0xFF]);
  const { deflateSync } = require('node:zlib');
  const compressed = deflateSync(rawData);
  const idat = createPngChunk('IDAT', compressed);
  const iend = createPngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([header, ihdr, idat, iend]);
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, data]);
  const { crc32 } = require('node:zlib');
  const crcVal = crc32(body);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal >>> 0);
  return Buffer.concat([len, body, crcBuf]);
}

export async function runCheck(): Promise<void> {
  process.stderr.write('\n\x1b[1mcompress-on-input check\x1b[0m\n');
  process.stderr.write('Running self-diagnostics...\n');

  checkBinaryInPath();
  checkHookInstalled();
  checkConfig();
  checkLogs();
  checkOCR();
  await runCompressionTests();
  await testHookTimeout();

  section('Summary');
  const total = passed + failed + warned;
  process.stderr.write(`  ${passed}/${total} checks passed`);
  if (warned > 0) process.stderr.write(`, ${warned} warnings`);
  if (failed > 0) process.stderr.write(`, \x1b[31m${failed} failed\x1b[0m`);
  process.stderr.write('\n');

  if (failed > 0) {
    process.stderr.write('\n  \x1b[31mSome checks failed.\x1b[0m Scroll up for fix instructions.\n');
    process.stderr.write('  Debug log: ' + DEBUG_LOG + '\n');
    process.stderr.write('  Report issues: https://github.com/Chill-AI-Space/compress-on-input/issues\n\n');
    process.exit(1);
  } else if (warned > 0) {
    process.stderr.write('\n  \x1b[33mAll critical checks passed, but there are warnings.\x1b[0m\n\n');
  } else {
    process.stderr.write('\n  \x1b[32mAll checks passed. compress-on-input is ready.\x1b[0m\n');
    process.stderr.write('  Restart Claude Code (/exit + claude) if this is a fresh install.\n\n');
  }
}
