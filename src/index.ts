#!/usr/bin/env node

import { loadConfig } from './config.js';
import { setVerbose, logAlways, logError } from './logger.js';
import { startProxy } from './proxy.js';

function parseArgs(args: string[]): {
  wrap?: string;
  config?: string;
  verbose: boolean;
  dryRun: boolean;
  ocrEngine?: string;
  maxTextTokens?: number;
  threshold?: number;
} {
  const result: ReturnType<typeof parseArgs> = { verbose: false, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--wrap':
        result.wrap = args[++i];
        break;
      case '--config':
        result.config = args[++i];
        break;
      case '--verbose':
        result.verbose = true;
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--ocr-engine':
        result.ocrEngine = args[++i];
        break;
      case '--max-text-tokens':
        result.maxTextTokens = parseInt(args[++i], 10);
        break;
      case '--threshold':
        result.threshold = parseInt(args[++i], 10);
        break;
      default:
        if (args[i].startsWith('-')) {
          logError(`Unknown flag: ${args[i]}`);
          process.exit(1);
        }
    }
  }

  return result;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args.wrap) {
    logError('Missing required --wrap flag. Usage: context-trash-mcp --wrap "command args"');
    process.exit(1);
  }

  const config = loadConfig(args.config);

  // CLI flags override config
  if (args.verbose) config.verbose = true;
  if (args.dryRun) config.dryRun = true;
  if (args.ocrEngine) config.ocrEngine = args.ocrEngine as typeof config.ocrEngine;
  if (args.maxTextTokens) config.maxTextTokens = args.maxTextTokens;
  if (args.threshold) config.threshold = args.threshold;

  setVerbose(config.verbose);

  logAlways(`Wrapping: ${args.wrap}`);
  logAlways(`Threshold: ${config.threshold} tokens, Max text: ${config.maxTextTokens} tokens`);

  startProxy(args.wrap!, config);
}

main();
