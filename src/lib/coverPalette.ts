export interface Palette {
  background: string;
  accent: string;
  ink: string;
}

export type Pattern =
  | 'plain'
  | 'paper-grain'
  | 'rule-lines'
  | 'monogram-S'
  | 'marbled'
  | 'dotted-grid';

export const PALETTES: Palette[] = [
  { background: '#F4ECD8', accent: '#B45A2B', ink: '#3A2A1A' }, // parchment + burnt orange
  { background: '#E6E6DC', accent: '#7A8C5E', ink: '#2A2E1F' }, // soft moss
  { background: '#EAE3D2', accent: '#3D5A6C', ink: '#1F2A33' }, // faded sky + ink navy
  { background: '#F2E6D2', accent: '#9C3D2E', ink: '#3B1F1B' }, // cream + brick
  { background: '#E9E2D0', accent: '#7C5B3F', ink: '#2D2118' }, // warm tan
  { background: '#E1E5DC', accent: '#5C7C8A', ink: '#1F2A30' }, // sage + steel blue
  { background: '#F0E2C8', accent: '#7A4E2D', ink: '#3A271A' }, // wheat + sepia
  { background: '#E6DFD2', accent: '#46624A', ink: '#1F2A22' }, // linen + forest
  { background: '#EDE0D4', accent: '#A45A52', ink: '#3A1F1C' }, // bone + rose-clay
  { background: '#E8E3D2', accent: '#6E5B8A', ink: '#28223A' }, // ivory + plum
  { background: '#F0E8D4', accent: '#3A6E6E', ink: '#1F2D2D' }, // pale cream + teal
  { background: '#E5DFCE', accent: '#94733E', ink: '#2D2418' }, // greige + ochre
];

export const PATTERNS: Pattern[] = [
  'plain',
  'paper-grain',
  'rule-lines',
  'monogram-S',
  'marbled',
  'dotted-grid',
];

export function pickPalette(hash: number): Palette {
  const idx = (hash >>> 0) % PALETTES.length;
  return PALETTES[idx];
}

export function pickPattern(hash: number): Pattern {
  const idx = ((hash >>> 0) >>> 8) % PATTERNS.length;
  return PATTERNS[idx];
}
