export type WorkbenchSemanticBlockKind =
  | 'evidence'
  | 'caveat'
  | 'next-action'
  | 'follow-up'
  | 'linked-surface';

export interface WorkbenchSemanticBlock {
  kind: WorkbenchSemanticBlockKind;
  attributes: Record<string, string>;
  body: string;
  raw: string;
}

export interface WorkbenchMarkdownPart {
  kind: 'markdown' | 'semantic-block';
  text: string;
}

const SUPPORTED_BLOCKS = new Set<WorkbenchSemanticBlockKind>([
  'evidence',
  'caveat',
  'next-action',
  'follow-up',
  'linked-surface',
]);

const BLOCK_START_RE = /^:::([a-z-]+)(?:\s+(.*))?$/;
const BLOCK_END_RE = /^:::\s*$/;
const ATTRIBUTE_RE = /([a-z-]+)="((?:\\.|[^"])*)"/g;

export function parseWorkbenchMarkdownParts(markdown: string): WorkbenchMarkdownPart[] {
  if (!markdown.trim()) {
    return [];
  }

  const lines = markdown.split('\n');
  const parts: WorkbenchMarkdownPart[] = [];
  let narrativeLines: string[] = [];
  let index = 0;

  const flushNarrative = () => {
    const text = narrativeLines.join('\n').trim();
    if (text) {
      parts.push({ kind: 'markdown', text });
    }
    narrativeLines = [];
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const match = line.match(BLOCK_START_RE);
    const blockKind = match?.[1] as WorkbenchSemanticBlockKind | undefined;

    if (match && blockKind && SUPPORTED_BLOCKS.has(blockKind)) {
      flushNarrative();
      const blockLines = [line];
      index += 1;
      while (index < lines.length) {
        const nextLine = lines[index] ?? '';
        blockLines.push(nextLine);
        index += 1;
        if (BLOCK_END_RE.test(nextLine)) {
          break;
        }
      }
      parts.push({
        kind: 'semantic-block',
        text: blockLines.join('\n'),
      });
      continue;
    }

    narrativeLines.push(line);
    index += 1;
  }

  flushNarrative();
  return parts;
}

export function parseWorkbenchSemanticBlock(text: string): WorkbenchSemanticBlock | null {
  const trimmed = text.trim();
  const lines = trimmed.split('\n');
  const firstLine = lines[0] ?? '';
  const lastLine = lines[lines.length - 1] ?? '';
  const match = firstLine.match(BLOCK_START_RE);

  if (!match || !BLOCK_END_RE.test(lastLine)) {
    return null;
  }

  const kind = match[1] as WorkbenchSemanticBlockKind;
  if (!SUPPORTED_BLOCKS.has(kind)) {
    return null;
  }

  const attributes = parseSemanticBlockAttributes(match[2] ?? '');
  const body = lines.slice(1, -1).join('\n').trim();
  return {
    kind,
    attributes,
    body,
    raw: trimmed,
  };
}

export function stripSemanticBlockWrapper(text: string): string {
  const block = parseWorkbenchSemanticBlock(text);
  return block ? block.body : text;
}

function parseSemanticBlockAttributes(input: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of input.matchAll(ATTRIBUTE_RE)) {
    const key = match[1];
    const value = (match[2] ?? '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    attributes[key] = value;
  }
  return attributes;
}
