#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const CACHE_DIR = join(process.env.HOME || '/Users/vova', '.cache', 'compress-on-input');

function findPackageRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = join(dir, '..');
  }
  return __dirname;
}

function getSourceHash(): string {
  const srcPath = join(findPackageRoot(), 'src', 'ocr', 'vision.swift');
  if (!existsSync(srcPath)) return '';
  const crypto = require('node:crypto');
  const content = require('node:fs').readFileSync(srcPath);
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 12);
}

function ensureVisionBinary(): string | null {
  if (process.platform !== 'darwin') return null;
  
  const hash = getSourceHash();
  const versionedBin = join(CACHE_DIR, `vision-ocr-${hash}`);
  
  if (existsSync(versionedBin)) return versionedBin;
  
  const srcPath = join(findPackageRoot(), 'src', 'ocr', 'vision.swift');
  if (!existsSync(srcPath)) return null;
  
  try {
    require('node:fs').mkdirSync(CACHE_DIR, { recursive: true });
    execFileSync('swiftc', ['-O', '-o', versionedBin, srcPath], { timeout: 30000 });
    return versionedBin;
  } catch {
    return null;
  }
}

function ocrImage(imagePath: string): string {
  const bin = ensureVisionBinary();
  
  if (bin) {
    try {
      const result = execFileSync(bin, [imagePath], { timeout: 10000 });
      const text = result.toString('utf-8').trim();
      if (text && text.length > 10) return text;
    } catch {}
  }
  
  try {
    const result = execFileSync('tesseract', [imagePath, 'stdout', '-l', 'eng+rus', '--psm', '1'], { timeout: 10000 });
    return result.toString('utf-8').trim();
  } catch (err) {
    throw new Error(`OCR failed: ${err}`);
  }
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

function send(message: JsonRpcMessage): void {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function handleRequest(msg: JsonRpcMessage): void {
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'compress-on-input', version: '0.1.0' }
      }
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    return;
  }
  
  if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'ocr_image',
            description: 'Extract text from images using Apple Vision (macOS) or Tesseract OCR. Supports PNG, JPG, JPEG, PDF, WebP, HEIC.',
            inputSchema: {
              type: 'object',
              properties: {
                imagePath: {
                  type: 'string',
                  description: 'Absolute path to the image file'
                }
              },
              required: ['imagePath']
            }
          }
        ]
      }
    });
    return;
  }
  
  if (msg.method === 'tools/call') {
    const params = msg.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    const name = params?.name;
    const args = params?.arguments as Record<string, unknown> | undefined;
    
    if (name === 'ocr_image') {
      const imagePath = args?.imagePath as string;
      
      if (!imagePath) {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: 'Error: imagePath is required' }],
            isError: true
          }
        });
        return;
      }
      
      try {
        const text = ocrImage(imagePath);
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text }] }
        });
      } catch (err) {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: `OCR failed: ${err}` }],
            isError: true
          }
        });
      }
      return;
    }
    
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true
      }
    });
    return;
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  
  try {
    const msg = JSON.parse(trimmed);
    handleRequest(msg);
  } catch {}
});

process.stderr.write('compress-on-input MCP server ready\n');

export function startMcpServer(): void {
  // Server starts automatically via stdin listeners above
}
