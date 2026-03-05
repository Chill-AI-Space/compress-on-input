const PREFIX = '[context-trash]';

let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
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

export function logStats(toolName: string, beforeTokens: number, afterTokens: number): void {
  const reduction = ((1 - afterTokens / beforeTokens) * 100).toFixed(1);
  log(`${toolName}: ${beforeTokens.toLocaleString()} → ${afterTokens.toLocaleString()} tokens (${reduction}% reduction)`);
}
