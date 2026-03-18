interface ContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

// Roles where ref is needed (Claude clicks/types these)
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'combobox', 'textbox', 'checkbox', 'radio',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
  'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'treeitem',
]);

// Roles that are just wrappers — skip them, render children
const TRANSPARENT_ROLES = new Set([
  'generic', 'none', 'presentation', 'group', 'rowgroup',
]);

// Structural roles that become section markers
const SECTION_ROLES = new Set([
  'banner', 'main', 'navigation', 'complementary', 'region', 'form',
]);

// Footer — strip entirely
const FOOTER_ROLES = new Set(['contentinfo']);

interface ParsedNode {
  indent: number;
  role: string;
  name: string;        // quoted name: heading "Title" → "Title"
  ref: string;         // e15
  attrs: string[];     // [disabled], [selected], [active], etc.
  level: number;       // heading level
  inlineText: string;  // text after ": " at end of line
  rawLine: string;
}

const LINE_RE = /^(\s*)-\s+(.+)$/;
const ROLE_RE = /^(\/?[\w-]+)/;
const QUOTED_NAME_RE = /^[\w-]+\s+"((?:[^"\\]|\\.)*)"/;
const SINGLE_QUOTED_NAME_RE = /^[\w-]+\s+'((?:[^'\\]|\\.)*)'/;
const REF_RE = /\[ref=([\w]+)\]/;
const LEVEL_RE = /\[level=(\d+)\]/;
const CURSOR_RE = /\s*\[cursor=\w+\]/g;
const ATTR_RE = /\[(disabled|selected|active|required|checked|expanded|pressed|readonly)\]/g;

function parseLine(line: string): ParsedNode | null {
  const match = line.match(LINE_RE);
  if (!match) return null;

  const indent = match[1].replace(/\t/g, '  ').length;
  let content = match[2];

  // Extract role
  const roleMatch = content.match(ROLE_RE);
  if (!roleMatch) return null;
  const role = roleMatch[1];

  // Extract quoted name
  let name = '';
  const qMatch = content.match(QUOTED_NAME_RE);
  if (qMatch) {
    name = qMatch[1];
  } else {
    const sqMatch = content.match(SINGLE_QUOTED_NAME_RE);
    if (sqMatch) name = sqMatch[1];
  }

  // Extract ref
  const refMatch = content.match(REF_RE);
  const ref = refMatch ? refMatch[1] : '';

  // Extract heading level
  const levelMatch = content.match(LEVEL_RE);
  const level = levelMatch ? parseInt(levelMatch[1]) : 0;

  // Extract attrs (disabled, selected, etc.)
  const attrs: string[] = [];
  let attrMatch;
  const attrRe = /\[(disabled|selected|active|required|checked|expanded|pressed|readonly)\]/g;
  while ((attrMatch = attrRe.exec(content)) !== null) {
    attrs.push(attrMatch[1]);
  }

  // Extract inline text after final ":"
  let inlineText = '';
  // Remove all [...] brackets and role+name to find trailing text
  const cleaned = content
    .replace(/\[[\w=]+\]/g, '')
    .replace(CURSOR_RE, '')
    .replace(/^[\w-]+\s*/, '')  // remove role
    .replace(/"(?:[^"\\]|\\.)*"/g, '')  // remove quoted name
    .replace(/'(?:[^'\\]|\\.)*'/g, '')  // remove single-quoted name
    .trim();

  // Check if original line ends with ": text" (colon + space + text, not just colon)
  const colonTextMatch = content.match(/:\s+(.+?)\s*$/);
  if (colonTextMatch) {
    // Make sure what's after colon isn't just refs/attrs
    const afterColon = colonTextMatch[1].replace(/\[[\w=]+\]/g, '').trim();
    if (afterColon && !afterColon.match(/^[\s\[\]]*$/)) {
      inlineText = afterColon;
    }
  }

  return { indent, role, name, ref, attrs, level, inlineText, rawLine: line };
}

/**
 * Convert Playwright accessibility tree snapshot to compact Markdown.
 *
 * Preserves: text content, interactive element refs, structure (via MD headings/lists/tables).
 * Removes: generic wrappers, non-interactive refs, cursor attrs, deep nesting.
 */
export function domToMarkdown(text: string): string {
  // Split the Playwright output: keep non-snapshot sections, convert snapshot
  const snapshotStart = text.indexOf('```yaml\n');
  const snapshotEnd = text.lastIndexOf('\n```');

  if (snapshotStart === -1 || snapshotEnd === -1 || snapshotEnd <= snapshotStart) {
    // No yaml snapshot block — try to process as raw accessibility tree
    return convertAccessibilityTree(text);
  }

  const before = text.slice(0, snapshotStart);
  const snapshot = text.slice(snapshotStart + '```yaml\n'.length, snapshotEnd);
  const after = text.slice(snapshotEnd + '\n```'.length);

  const converted = convertAccessibilityTree(snapshot);
  return (before + converted + after).trim();
}

function convertAccessibilityTree(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];
  let i = 0;

  // Collect interactive elements for a summary section
  const interactiveRefs: string[] = [];

  while (i < lines.length) {
    i = processNode(lines, i, output, interactiveRefs, 0);
  }

  return output.join('\n');
}

function getChildLines(lines: string[], startIdx: number, parentIndent: number): number {
  let end = startIdx;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === '') { end++; continue; }
    const parsed = parseLine(line);
    if (!parsed || parsed.indent <= parentIndent) break;
    end++;
  }
  return end;
}

function collectText(lines: string[], start: number, end: number): string {
  const parts: string[] = [];
  for (let i = start; i < end; i++) {
    const parsed = parseLine(lines[i]);
    if (!parsed) continue;

    if (parsed.role === 'text' || parsed.role === '/url' || parsed.role === '/placeholder') {
      continue; // handled by parent
    }
    if (parsed.name) parts.push(parsed.name);
    else if (parsed.inlineText) parts.push(parsed.inlineText);
  }
  return parts.join(' ');
}

function getUrl(lines: string[], start: number, end: number): string {
  for (let i = start; i < end; i++) {
    const line = lines[i].trim();
    if (line.startsWith('- /url:')) {
      return line.replace('- /url:', '').trim().replace(/^"(.*)"$/, '$1');
    }
  }
  return '';
}

function getPlaceholder(lines: string[], start: number, end: number): string {
  for (let i = start; i < end; i++) {
    const line = lines[i].trim();
    if (line.startsWith('- /placeholder:')) {
      return line.replace('- /placeholder:', '').trim().replace(/^"(.*)"$/, '$1');
    }
  }
  return '';
}

function processNode(
  lines: string[],
  idx: number,
  output: string[],
  interactiveRefs: string[],
  depth: number,
): number {
  if (idx >= lines.length) return idx;
  const line = lines[idx];
  if (line.trim() === '') return idx + 1;

  const node = parseLine(line);
  if (!node) {
    // Raw text line (not a node) — include as-is
    const trimmed = line.trim();
    if (trimmed) output.push(trimmed);
    return idx + 1;
  }

  const childEnd = getChildLines(lines, idx + 1, node.indent);

  // Footer — skip entirely
  if (FOOTER_ROLES.has(node.role)) {
    return childEnd;
  }

  // /url, /placeholder — metadata handled by parent
  if (node.role.startsWith('/')) {
    return idx + 1;
  }

  // text nodes — just emit the content
  if (node.role === 'text') {
    const text = node.name || node.inlineText;
    if (text) output.push(text);
    return idx + 1;
  }

  // heading → markdown heading
  if (node.role === 'heading') {
    const hashes = '#'.repeat(Math.min(node.level || 1, 6));
    // Collect all text from children (strong, text nodes, etc.)
    let headingText = node.name || '';
    if (!headingText && idx + 1 < childEnd) {
      headingText = collectInlineContent(lines, idx + 1, childEnd);
    }
    output.push(`${hashes} ${headingText}`);
    return childEnd;
  }

  // link → [text](url) [ref]
  if (node.role === 'link') {
    const url = getUrl(lines, idx + 1, childEnd);
    let linkText = node.name || '';
    if (!linkText) {
      linkText = collectInlineContent(lines, idx + 1, childEnd);
    }
    const refTag = node.ref ? ` [${node.ref}]` : '';
    if (url) {
      output.push(`[${linkText}](${url})${refTag}`);
    } else {
      output.push(`[${linkText}]${refTag}`);
    }
    return childEnd;
  }

  // button → [ref] button "text" (attrs)
  if (node.role === 'button') {
    const refTag = node.ref ? `[${node.ref}] ` : '';
    const attrStr = node.attrs.length > 0 ? ` (${node.attrs.join(', ')})` : '';
    let btnText = node.name || '';
    if (!btnText) {
      btnText = collectInlineContent(lines, idx + 1, childEnd);
    }
    output.push(`${refTag}button "${btnText}"${attrStr}`);
    if (node.ref) interactiveRefs.push(`${node.ref}: button "${btnText}"`);
    return childEnd;
  }

  // Form inputs: textbox, combobox, searchbox, checkbox, radio, etc.
  if (INTERACTIVE_ROLES.has(node.role) && node.role !== 'link' && node.role !== 'button') {
    const refTag = node.ref ? `[${node.ref}] ` : '';
    const placeholder = getPlaceholder(lines, idx + 1, childEnd);
    const attrStr = node.attrs.length > 0 ? ` (${node.attrs.join(', ')})` : '';
    const phStr = placeholder ? ` — "${placeholder}"` : '';
    output.push(`${refTag}${node.role} "${node.name}"${phStr}${attrStr}`);
    if (node.ref) interactiveRefs.push(`${node.ref}: ${node.role} "${node.name}"`);
    return childEnd;
  }

  // strong → **text**
  if (node.role === 'strong') {
    const text = node.name || node.inlineText || collectInlineContent(lines, idx + 1, childEnd);
    output.push(`**${text}**`);
    return childEnd;
  }

  // paragraph — emit text, then children
  if (node.role === 'paragraph') {
    if (node.name) {
      output.push(node.name);
    } else if (node.inlineText) {
      output.push(node.inlineText);
    } else {
      // Collect inline children (text, strong, etc.)
      const text = collectInlineContent(lines, idx + 1, childEnd);
      if (text) output.push(text);
    }
    return childEnd;
  }

  // img — skip empty, show alt
  if (node.role === 'img') {
    if (node.name) {
      output.push(`![${node.name}]`);
    }
    return idx + 1;
  }

  // table → markdown table
  if (node.role === 'table') {
    renderTable(lines, idx + 1, childEnd, output);
    return childEnd;
  }

  // list → markdown list items
  if (node.role === 'list') {
    // Process children (listitems)
    let ci = idx + 1;
    while (ci < childEnd) {
      ci = processNode(lines, ci, output, interactiveRefs, depth + 1);
    }
    return childEnd;
  }

  if (node.role === 'listitem') {
    const itemOutput: string[] = [];
    let ci = idx + 1;
    while (ci < childEnd) {
      ci = processNode(lines, ci, itemOutput, interactiveRefs, depth + 1);
    }
    if (itemOutput.length > 0) {
      output.push(`- ${itemOutput.join(' ')}`);
    }
    return childEnd;
  }

  // Section roles — emit as bold section header
  if (SECTION_ROLES.has(node.role)) {
    if (node.name) {
      output.push('');
      output.push(`**${node.name}:**`);
    }
    let ci = idx + 1;
    while (ci < childEnd) {
      ci = processNode(lines, ci, output, interactiveRefs, depth + 1);
    }
    return childEnd;
  }

  // tablist
  if (node.role === 'tablist') {
    let ci = idx + 1;
    while (ci < childEnd) {
      ci = processNode(lines, ci, output, interactiveRefs, depth + 1);
    }
    return childEnd;
  }

  // tab → like button with selected state
  if (node.role === 'tab') {
    const refTag = node.ref ? `[${node.ref}] ` : '';
    const sel = node.attrs.includes('selected') ? ' (selected)' : '';
    output.push(`${refTag}tab "${node.name}"${sel}`);
    if (node.ref) interactiveRefs.push(`${node.ref}: tab "${node.name}"`);
    return childEnd;
  }

  // Transparent roles — skip wrapper, process children
  if (TRANSPARENT_ROLES.has(node.role)) {
    // But if it has meaningful inline text, emit it
    if (node.inlineText) {
      output.push(node.inlineText);
    } else if (node.name) {
      output.push(node.name);
    }
    let ci = idx + 1;
    while (ci < childEnd) {
      ci = processNode(lines, ci, output, interactiveRefs, depth + 1);
    }
    return childEnd;
  }

  // row, cell, columnheader — handled by table renderer
  if (node.role === 'row' || node.role === 'cell' || node.role === 'columnheader') {
    // Outside table context — just emit content
    if (node.name) output.push(node.name);
    else if (node.inlineText) output.push(node.inlineText);
    let ci = idx + 1;
    while (ci < childEnd) {
      ci = processNode(lines, ci, output, interactiveRefs, depth + 1);
    }
    return childEnd;
  }

  // Default: emit name/text and recurse into children
  if (node.name) {
    output.push(node.name);
  } else if (node.inlineText) {
    output.push(node.inlineText);
  }
  let ci = idx + 1;
  while (ci < childEnd) {
    ci = processNode(lines, ci, output, interactiveRefs, depth + 1);
  }
  return childEnd;
}

/**
 * Collect inline text content from children, merging text/strong nodes.
 */
function collectInlineContent(lines: string[], start: number, end: number): string {
  const parts: string[] = [];
  let i = start;
  while (i < end) {
    const node = parseLine(lines[i]);
    if (!node) { i++; continue; }
    if (node.role.startsWith('/')) { i++; continue; }
    if (node.role === 'img' && !node.name) { i++; continue; }

    const nodeChildEnd = getChildLines(lines, i + 1, node.indent);

    if (node.role === 'text') {
      const text = node.name || node.inlineText;
      if (text) parts.push(text);
      i++;
    } else if (node.role === 'strong') {
      const text = node.name || node.inlineText || collectInlineContent(lines, i + 1, nodeChildEnd);
      if (text) parts.push(`**${text}**`);
      i = nodeChildEnd;
    } else if (node.role === 'img') {
      parts.push(`![${node.name}]`);
      i++;
    } else if (node.role === 'link') {
      const url = getUrl(lines, i + 1, nodeChildEnd);
      const linkText = node.name || collectInlineContent(lines, i + 1, nodeChildEnd);
      const refTag = node.ref ? ` [${node.ref}]` : '';
      parts.push(url ? `[${linkText}](${url})${refTag}` : `[${linkText}]${refTag}`);
      i = nodeChildEnd;
    } else if (TRANSPARENT_ROLES.has(node.role)) {
      const text = node.name || node.inlineText || collectInlineContent(lines, i + 1, nodeChildEnd);
      if (text) parts.push(text);
      i = nodeChildEnd;
    } else {
      const text = node.name || node.inlineText;
      if (text) parts.push(text);
      i = nodeChildEnd;
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function renderTable(lines: string[], start: number, end: number, output: string[]): void {
  // Parse rows from the tree
  const rows: { cells: string[]; isHeader: boolean; refs: string[] }[] = [];
  let i = start;

  while (i < end) {
    const node = parseLine(lines[i]);
    if (!node) { i++; continue; }

    const rowEnd = getChildLines(lines, i + 1, node.indent);

    if (node.role === 'rowgroup') {
      // Recurse into rowgroup
      renderTable(lines, i + 1, rowEnd, output);
      i = rowEnd;
      continue;
    }

    if (node.role === 'row') {
      const cells: string[] = [];
      const cellRefs: string[] = [];
      let isHeader = false;
      let ci = i + 1;

      while (ci < rowEnd) {
        const cellNode = parseLine(lines[ci]);
        if (!cellNode) { ci++; continue; }
        const cellEnd = getChildLines(lines, ci + 1, cellNode.indent);

        if (cellNode.role === 'columnheader') {
          isHeader = true;
          const text = cellNode.name || collectInlineContent(lines, ci + 1, cellEnd);
          cells.push(text);
          cellRefs.push('');
        } else if (cellNode.role === 'cell') {
          // Check if cell has interactive children (links, buttons)
          const cellContent = collectCellContent(lines, ci, cellEnd);
          cells.push(cellContent.text);
          cellRefs.push(cellContent.ref);
        }
        ci = cellEnd;
      }

      if (cells.length > 0) {
        rows.push({ cells, isHeader, refs: cellRefs });
      }
    }
    i = rowEnd;
  }

  if (rows.length === 0) return;

  // Determine column count
  const colCount = Math.max(...rows.map(r => r.cells.length));

  // Render as markdown table
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const paddedCells = [...row.cells];
    while (paddedCells.length < colCount) paddedCells.push('');

    output.push(`| ${paddedCells.join(' | ')} |`);

    if (row.isHeader || (ri === 0 && rows.length > 1)) {
      output.push(`| ${paddedCells.map(() => '---').join(' | ')} |`);
    }
  }
}

function collectCellContent(lines: string[], cellIdx: number, cellEnd: number): { text: string; ref: string } {
  const cellNode = parseLine(lines[cellIdx]);
  if (!cellNode) return { text: '', ref: '' };

  let text = cellNode.name || cellNode.inlineText || '';
  let ref = '';

  // Look for interactive children
  for (let i = cellIdx + 1; i < cellEnd; i++) {
    const child = parseLine(lines[i]);
    if (!child) continue;
    if (child.role === 'link') {
      text = child.name || text;
      ref = child.ref || '';
    } else if (child.role === 'button') {
      ref = child.ref || '';
    }
  }

  if (ref) {
    text = `${text} [${ref}]`;
  }

  return { text, ref };
}

/**
 * Compress DOM snapshot by converting accessibility tree to Markdown.
 * Drop-in replacement for compressDomCleanup.
 */
export function compressDomToMarkdown(block: ContentBlock): ContentBlock {
  if (block.type !== 'text' || !block.text) return block;

  const text = block.text;
  const converted = domToMarkdown(text);

  // Clean up: collapse multiple blank lines, trim
  const cleaned = converted
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Safety: if conversion made it bigger, return original
  if (cleaned.length >= text.length) {
    return block;
  }

  return { type: 'text', text: cleaned };
}
