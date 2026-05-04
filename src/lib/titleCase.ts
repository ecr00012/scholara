const LOWERCASE_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'in',
  'on',
  'at',
  'by',
  'for',
  'and',
  'or',
  'to',
  'with',
  'from',
  'as',
  'but',
  'nor',
  'is',
]);

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return name;   // no extension
  if (dot === 0) return '';   // hidden file like .pdf → empty stem
  return name.slice(0, dot);
}

function capitalize(word: string): string {
  if (word.length === 0) return word;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

export function titleFromFilename(input: string): string {
  if (!input) return 'Untitled';

  const stem = stripExtension(basename(input));
  const cleaned = stem
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length === 0) return 'Untitled';

  const words = cleaned.split(' ');
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i !== 0 && LOWERCASE_WORDS.has(lower)) return lower;
      return capitalize(w);
    })
    .join(' ');
}
