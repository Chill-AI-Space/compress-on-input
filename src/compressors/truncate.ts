import { estimateTokens } from '../classifier.js';

interface ContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

const HEAD_RATIO = 0.7;
const TAIL_RATIO = 0.3;

export function compressTruncate(block: ContentBlock, maxTokens: number): ContentBlock {
  if (block.type !== 'text' || !block.text) return block;

  const text = block.text;
  const tokens = estimateTokens(text);

  if (tokens <= maxTokens) return block;

  // Convert token budget to approximate character counts (tokens * 4 bytes avg)
  const maxChars = maxTokens * 4;
  const headChars = Math.floor(maxChars * HEAD_RATIO);
  const tailChars = Math.floor(maxChars * TAIL_RATIO);

  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);

  const truncatedTokens = tokens - estimateTokens(head) - estimateTokens(tail);

  return {
    type: 'text',
    text: `${head}\n\n[... truncated ${truncatedTokens.toLocaleString()} tokens ...]\n\n${tail}`,
  };
}
