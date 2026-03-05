export type ContentType = 'image' | 'dom-snapshot' | 'large-text' | 'small-text';

const DOM_SIGNALS = ['[ref=', '- role:', 'role="', 'aria-'];

export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf-8') / 4);
}

export function classifyContent(
  block: { type: string; text?: string; data?: string; mimeType?: string },
  threshold: number,
  maxTextTokens: number,
): ContentType {
  if (block.type === 'image') {
    return 'image';
  }

  const text = block.text ?? '';

  // Check for DOM snapshot signals
  const hasDomSignals = DOM_SIGNALS.some((signal) => text.includes(signal));
  if (hasDomSignals) {
    return 'dom-snapshot';
  }

  const tokens = estimateTokens(text);
  if (tokens > maxTextTokens) {
    return 'large-text';
  }

  return 'small-text';
}
