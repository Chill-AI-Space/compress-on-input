interface ContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

// Interactive roles that need refs for Claude to click/type
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'combobox', 'textbox', 'checkbox', 'radio',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
  'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'treeitem',
]);

// Structural noise roles — strip refs, and if they have no useful text content, remove entirely
const NOISE_ROLES = new Set([
  'generic', 'none', 'presentation',
]);

// Footer/boilerplate patterns to strip entirely
const FOOTER_PATTERNS = [
  /^[\t ]*- contentinfo\b/,
  /^[\t ]*- heading "Footer"/,
  /^[\t ]*- navigation "Footer"/,
];

function isInteractiveLine(line: string): boolean {
  // Match: "- button", "- link", "- combobox" etc at any indent
  const roleMatch = line.match(/^[\t ]*-\s+(\w+)/);
  if (!roleMatch) return false;
  return INTERACTIVE_ROLES.has(roleMatch[1]);
}

function getIndentLevel(line: string): number {
  const match = line.match(/^([\t ]*)/);
  if (!match) return 0;
  return match[1].replace(/\t/g, '  ').length;
}

export function compressDomCleanup(block: ContentBlock): ContentBlock {
  if (block.type !== 'text' || !block.text) return block;

  const text = block.text;
  const lines = text.split('\n');
  const result: string[] = [];
  let skipUntilIndent = -1; // skip subtree when >= 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = getIndentLevel(line);

    // If we're skipping a subtree, continue until indent drops back
    if (skipUntilIndent >= 0) {
      if (indent > skipUntilIndent) continue;
      skipUntilIndent = -1;
    }

    // Strip footer sections entirely
    if (FOOTER_PATTERNS.some(p => p.test(line))) {
      skipUntilIndent = indent;
      continue;
    }

    let cleaned = line;

    // 1. Strip [cursor=pointer] — always implied for interactive elements
    cleaned = cleaned.replace(/\s*\[cursor=pointer\]/g, '');

    // 2. Strip refs from non-interactive elements
    if (!isInteractiveLine(cleaned)) {
      cleaned = cleaned.replace(/\s*\[ref=[\w]+\]/g, '');
    }

    // 3. Strip role="generic" and role="none"
    cleaned = cleaned.replace(/\s*role="(?:generic|none)"/g, '');

    // 4. Strip empty img nodes (no alt text, just "- img" or "- img [ref=...]")
    if (/^[\t ]*-\s+img\s*$/.test(cleaned)) {
      continue;
    }

    // 5. Strip redundant text in row/cell descriptions
    // Row labels duplicate all cell content — shorten to just "row"
    cleaned = cleaned.replace(
      /^([\t ]*-\s+)'row ".*?"(\s*\[ref=[\w]+\])?'/,
      (_, prefix, ref) => `${prefix}row${ref ? ` ${ref}` : ''}`,
    );
    // Also unquoted row descriptions
    cleaned = cleaned.replace(
      /^([\t ]*-\s+)row ".*?"(\s*\[ref=[\w]+\])?:/,
      (_, prefix, ref) => `${prefix}row${ref ? ` ${ref}` : ''}:`,
    );

    // 6. Collapse "- generic:" lines with no useful info
    // Keep if they have text content after the colon
    const genericMatch = cleaned.match(/^([\t ]*)-\s+generic\s*:?\s*$/);
    if (genericMatch) {
      // Check if next line is a single child — if so, skip this wrapper
      if (i + 1 < lines.length) {
        const nextIndent = getIndentLevel(lines[i + 1]);
        if (nextIndent > indent) {
          // Check if there's only one direct child at this level
          let childCount = 0;
          for (let j = i + 1; j < lines.length; j++) {
            const jIndent = getIndentLevel(lines[j]);
            if (jIndent <= indent) break;
            if (jIndent === indent + 2) childCount++;
            if (childCount > 1) break;
          }
          if (childCount <= 1) {
            continue; // Skip this generic wrapper, child will be promoted
          }
        }
      }
    }

    // 7. Collapse generic with text content: "- generic [ref=eXXX]: SomeText" → "- SomeText"
    cleaned = cleaned.replace(
      /^([\t ]*-\s+)generic(?:\s*\[ref=[\w]+\])?\s*:\s*(.+)/,
      '$1$2',
    );

    // 8. Remove redundant "- text:" lines
    cleaned = cleaned.replace(
      /^([\t ]*)-\s+text:\s*/,
      '$1  ',
    );

    // Skip empty lines after processing
    if (/^[\t ]*-?\s*$/.test(cleaned) && cleaned.trim() === '') {
      continue;
    }

    result.push(cleaned);
  }

  // Final pass: collapse multiple blank lines
  let output = result.join('\n').replace(/\n{3,}/g, '\n\n');

  // Size guard: if cleanup made it bigger, return original
  if (output.length >= text.length) {
    return block;
  }

  return { type: 'text', text: output };
}
