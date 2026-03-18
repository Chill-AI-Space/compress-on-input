import { Config, loadConfig } from './config.js';
import { compressResult } from './pipeline.js';
import { setVerbose, setDebugLog, log, logError, logSkip, logDebug, preview } from './logger.js';
import { ToolContext } from './query-builder.js';
import { recordCall, getRecentCalls } from './session.js';

/**
 * PostToolUse hook handler for Claude Code.
 *
 * Receives JSON on stdin with tool_name, tool_input, tool_response.
 * Only processes MCP tools (outputs updatedMCPToolOutput to replace output).
 * Built-in tools are skipped — they only support additionalContext which adds tokens.
 */

interface HookInput {
  session_id: string;
  transcript_path?: string;
  cwd: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: unknown;
  tool_use_id?: string;
}

function isMCPTool(toolName: string): boolean {
  return toolName.startsWith('mcp__');
}

function shortToolName(toolName: string): string {
  if (!isMCPTool(toolName)) return toolName;
  const parts = toolName.split('__');
  return parts.length >= 3 ? parts.slice(2).join('__') : toolName;
}

function flattenImageBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((block) => {
    if (block.type !== 'image' || block.data) return block;
    const src = (block as unknown as Record<string, unknown>).source;
    if (src && typeof src === 'object') {
      const s = src as Record<string, unknown>;
      if (typeof s.data === 'string') {
        return {
          type: 'image',
          data: s.data as string,
          mimeType: (s.media_type as string) ?? block.mimeType ?? 'image/png',
        };
      }
    }
    return block;
  });
}

function normalizeResponse(response: unknown): { content: ContentBlock[] } | null {
  if (!response) return null;

  if (Array.isArray(response)) {
    if (response.length === 0) return null;
    if (typeof response[0] === 'object' && response[0] !== null && 'type' in response[0]) {
      return { content: flattenImageBlocks(response as ContentBlock[]) };
    }
    const text = JSON.stringify(response);
    return { content: [{ type: 'text', text }] };
  }

  if (typeof response === 'object' && response !== null) {
    const r = response as Record<string, unknown>;
    if (Array.isArray(r.content)) {
      return { content: flattenImageBlocks(r.content as ContentBlock[]) };
    }
    if (typeof r.type === 'string') {
      return { content: flattenImageBlocks([r as unknown as ContentBlock]) };
    }
    const text = JSON.stringify(response);
    return { content: [{ type: 'text', text }] };
  }

  if (typeof response === 'string') {
    return { content: [{ type: 'text', text: response }] };
  }

  return null;
}

interface ContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

function blockSize(b: ContentBlock): number {
  if (b.type === 'image' && b.data) return Math.ceil(b.data.length / 4);
  return b.text ? Math.ceil(Buffer.byteLength(b.text, 'utf-8') / 4) : 0;
}

export async function handleHook(configOrPath?: Config | string): Promise<void> {
  const config = typeof configOrPath === 'object' && configOrPath !== null
    ? configOrPath
    : loadConfig(configOrPath);
  setVerbose(config.verbose);
  setDebugLog(config.debugLog);

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const rawInput = Buffer.concat(chunks).toString('utf-8').trim();

  if (!rawInput) {
    process.exit(0);
  }

  let input: HookInput;
  try {
    input = JSON.parse(rawInput);
  } catch {
    logError('Failed to parse hook input JSON');
    process.exit(0);
  }

  const { tool_name, tool_input, tool_response } = input;

  log(`Hook: ${tool_name}`);

  const shortName = shortToolName(tool_name);
  recordCall(shortName, tool_input);

  // Skip built-in tools — they don't support updatedMCPToolOutput
  if (!isMCPTool(tool_name)) {
    log(`Hook: ${tool_name} — built-in tool, skipping`);
    process.exit(0);
  }

  const normalized = normalizeResponse(tool_response);
  if (!normalized) {
    log(`Hook: ${tool_name} — no content to compress`);
    logSkip(shortName, 'empty-response', 0, tool_input, {
      session_id: input.session_id,
      full_tool_name: tool_name,
    });
    process.exit(0);
  }

  const blockTypes = normalized.content.map(b => b.type);
  const blockSizes = normalized.content.map(blockSize);
  const originalPreview = normalized.content
    .filter(b => b.type === 'text')
    .map(b => b.text?.slice(0, 300))
    .join('\n---\n');

  const toolContext: ToolContext = {
    toolName: shortName,
    toolArgs: tool_input,
    previousCalls: getRecentCalls(3),
  };

  let compressed;
  try {
    compressed = await compressResult(shortName, normalized, config, toolContext, tool_input);
  } catch (e) {
    logError(`Compression threw for ${tool_name}: ${e}`);
    process.exit(0);
  }

  if (compressed === normalized) {
    log(`Hook: ${tool_name} — no compression needed`);
    const totalTokens = blockSizes.reduce((a, b) => a + b, 0);
    logSkip(shortName, 'no-change', totalTokens, tool_input, {
      session_id: input.session_id,
      full_tool_name: tool_name,
      block_types: blockTypes,
      block_sizes: blockSizes,
      original_preview: preview(originalPreview),
    });
    process.exit(0);
  }

  // Debug log for compressed results — includes before/after previews
  const compressedPreview = compressed.content
    ?.filter(b => b.type === 'text')
    .map(b => b.text?.slice(0, 300))
    .join('\n---\n');

  logDebug({
    ts: new Date().toISOString(),
    tool: shortName,
    full_tool_name: tool_name,
    session_id: input.session_id,
    strategy: 'auto',
    before: blockSizes.reduce((a, b) => a + b, 0),
    after: compressed.content?.reduce((s, b) => s + blockSize(b), 0) ?? 0,
    reduction: '',
    duration_ms: 0,
    action: 'compressed-detail',
    tool_input: tool_input,
    block_types: blockTypes,
    block_sizes: blockSizes,
    original_preview: preview(originalPreview),
    compressed_preview: preview(compressedPreview),
  });

  const output = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedMCPToolOutput: compressed.content,
    },
  };
  process.stdout.write(JSON.stringify(output) + '\n');
}
