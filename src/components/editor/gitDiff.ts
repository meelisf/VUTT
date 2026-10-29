// Git-diffi parser ajaloovaadete jaoks (lehe ajalugu, ülevaatusleht; #674).
// Puhas funktsioon: tehnilised päised ja JSON-i müra (ajatemplid, ID-d, paljad
// sulud) eemaldatakse, ainult ajatempleid muutnud faili plokk jäetakse välja.

export type GitDiffBlockKind = 'json' | 'text' | 'other';
export type GitDiffLineType = 'addition' | 'deletion' | 'context';

export interface GitDiffLine {
  key: string;
  type: GitDiffLineType;
  text: string;
}

export interface GitDiffBlock {
  key: string;
  kind: GitDiffBlockKind;
  lines: GitDiffLine[];
}

const HEADER_PREFIXES = [
  'index ', '---', '+++', '@@', '\\ No newline',
  'new file mode', 'old file mode', 'a/', 'b/',
];

const TECH_FIELD = /^["'](updated_at|created_at|work_id|page_number|id|slug)["']\s*:/;
const TECH_FIELD_CHANGE = /^[+-]\s*["'](updated_at|created_at|work_id|page_number|id|slug)["']\s*:/;
const BRACKET_ONLY = new Set(['{', '}', '[', ']', '},', '],']);

export function parseGitDiff(diffText: string): GitDiffBlock[] {
  const result: GitDiffBlock[] = [];

  diffText.split('diff --git').forEach((block, blockIdx) => {
    if (!block.trim()) return;

    const kind: GitDiffBlockKind = block.includes('.json') ? 'json' : block.includes('.txt') ? 'text' : 'other';
    const lines: GitDiffLine[] = [];
    let hasMeaningfulChanges = false;

    block.split('\n').forEach((line, i) => {
      const trimmedLine = line.trim();

      // Ploki esimene rida on failitee
      if (i === 0 || trimmedLine === '' || HEADER_PREFIXES.some(p => trimmedLine.startsWith(p))) return;

      if (TECH_FIELD.test(trimmedLine) || TECH_FIELD_CHANGE.test(line)) return;

      const isAddition = line.startsWith('+');
      const isDeletion = line.startsWith('-');

      if (isAddition || isDeletion) {
        // Paljas sulg või tühi rida ei ole sisuline muudatus
        const content = trimmedLine.substring(1).trim();
        if (content !== '' && !BRACKET_ONLY.has(content)) hasMeaningfulChanges = true;
      } else if (kind === 'json' && BRACKET_ONLY.has(trimmedLine)) {
        return;
      }

      lines.push({
        key: `${blockIdx}-${i}`,
        type: isAddition ? 'addition' : isDeletion ? 'deletion' : 'context',
        text: line,
      });
    });

    if (hasMeaningfulChanges) result.push({ key: `block-${blockIdx}`, kind, lines });
  });

  return result;
}
