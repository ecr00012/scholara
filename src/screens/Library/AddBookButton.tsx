import { useEffect, useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';
import { copyUploadedFile } from '../../ipc/files';
import { titleFromFilename } from '../../lib/titleCase';
import { useAppStore } from '../../store';
import type { Book } from '../../db/types';
import { cn } from '../../lib/cn';

interface Props {
  variant: 'tile' | 'cta';
  onAdded?: (book: Book) => void;
}

export function AddBookButton({ variant, onAdded }: Props) {
  const insertBook = useAppStore((s) => s.insertBook);
  const runMetadataExtractionPass = useAppStore(
    (s) => s.runMetadataExtractionPass,
  );
  const [hovered, setHovered] = useState(false);

  const handleAdd = async () => {
    let selected: string | string[] | null = null;
    try {
      selected = await openDialog({
        multiple: false,
        filters: [{ name: 'Books', extensions: ['pdf', 'epub'] }],
      });
    } catch (err) {
      toast.error(`Could not open file picker: ${(err as Error).message}`);
      return;
    }
    if (!selected || Array.isArray(selected)) return;

    try {
      const { storedPath, fileType } = await copyUploadedFile(selected);
      const title = titleFromFilename(selected);
      const book = await insertBook({
        title,
        file_path: storedPath,
        file_type: fileType,
      });
      await runMetadataExtractionPass();
      toast.success(`Added "${book.title}"`, {
        action: onAdded
          ? { label: 'Edit', onClick: () => onAdded(book) }
          : undefined,
      });
    } catch (err) {
      toast.error(
        `Could not save book. Try again or choose a different file. (${(err as Error).message})`,
      );
    }
  };

  const isCta = variant === 'cta';

  return (
    <button
      type="button"
      onClick={handleAdd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      aria-label="Add a book"
      className={cn(
        'group relative flex flex-col items-center justify-center rounded-md border border-dashed border-stone-300 bg-cream/50 transition focus:outline-none focus:ring-2 focus:ring-accent-gold',
        isCta ? 'aspect-[2/3] w-60' : 'aspect-[2/3] w-full',
      )}
    >
      <Quill hovered={hovered} />
      {isCta && <div className="mt-4 font-serif text-base text-ink-muted">Begin a new study.</div>}
    </button>
  );
}

// ---------------- Quill loader ----------------
// Feather-only quill that scribbles ink lines. The nib at the base of the
// feather tracks the live tip of each ink line via getPointAtLength().
// Animation only advances while `hovered` is true; on un-hover the quill
// freezes exactly where it is.

const INK_PATHS = [
  'M 65 62  q 8 -3 16 0  t 16 1  q 8 -2 18 1  t 18 0',
  'M 66 80  q 10 -2 20 1 t 18 0  q 9 -1 17 1  t 14 -1',
  'M 64 98  q 9 -3 19 0  t 17 1  q 9 -2 17 0  t 17 1',
  'M 65 116 q 8 -2 17 1  t 19 0  q 8 -2 16 1  t 14 0',
  'M 67 134 q 9 -3 18 0  t 17 0  q 8 -1 16 1  t 12 -1',
  'M 66 152 q 9 -2 18 1  t 17 0  q 8 -1 14 0  t 11 1',
];

const DRAW_MS = 800;
const HOLD_MS = 60;
const LIFT_MS = 220;
const SLOT_MS = DRAW_MS + HOLD_MS + LIFT_MS;
const CYCLE_MS = INK_PATHS.length * SLOT_MS;

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeIO = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

function Quill({ hovered }: { hovered: boolean }) {
  const inkRef = useRef<SVGGElement | null>(null);
  const quillRef = useRef<SVGGElement | null>(null);
  const featherRef = useRef<SVGGElement | null>(null);

  const hoveredRef = useRef(hovered);
  useEffect(() => { hoveredRef.current = hovered; }, [hovered]);

  useEffect(() => {
    const inkGroup = inkRef.current;
    const quillEl = quillRef.current;
    const featherEl = featherRef.current;
    if (!inkGroup || !quillEl) return;

    const paths = Array.from(inkGroup.querySelectorAll<SVGPathElement>('path'));
    const lens = paths.map((p) => p.getTotalLength());
    paths.forEach((p, i) => {
      p.style.strokeDasharray = String(lens[i]);
      p.style.strokeDashoffset = String(lens[i]);
      p.style.opacity = '0';
    });

    let played = 0, lastTs: number | null = null, tremor = 0, raf = 0;

    const tick = (ts: number) => {
      if (lastTs !== null && hoveredRef.current) {
        const dt = ts - lastTs; played += dt; tremor += dt;
      }
      lastTs = ts;

      const t = played % CYCLE_MS;
      const idx = Math.floor(t / SLOT_MS);
      const local = t - idx * SLOT_MS;

      for (let i = 0; i < paths.length; i++) {
        const age = idx - i;
        let opacity = 0, offset = lens[i];
        if (age < 0) { opacity = 0; offset = lens[i]; }
        else if (age === 0) {
          if (local <= DRAW_MS) {
            const p = ease(local / DRAW_MS);
            offset = lens[i] * (1 - p); opacity = 0.95;
          } else { offset = 0; opacity = 0.95; }
        } else { offset = 0; opacity = Math.max(0, 0.85 - age * 0.16); }
        paths[i].style.strokeDashoffset = String(offset);
        paths[i].style.opacity = String(opacity);
      }

      const writing = paths[idx], wLen = lens[idx];
      let x: number, y: number;
      if (local <= DRAW_MS) {
        const p = ease(local / DRAW_MS);
        const pt = writing.getPointAtLength(wLen * p); x = pt.x; y = pt.y;
      } else if (local <= DRAW_MS + HOLD_MS) {
        const pt = writing.getPointAtLength(wLen); x = pt.x; y = pt.y;
      } else {
        const nextIdx = (idx + 1) % paths.length;
        const a = writing.getPointAtLength(wLen);
        const b = paths[nextIdx].getPointAtLength(0);
        const tt = (local - DRAW_MS - HOLD_MS) / LIFT_MS;
        const e = easeIO(tt);
        x = a.x + (b.x - a.x) * e;
        y = a.y + (b.y - a.y) * e - 8 * Math.sin(Math.PI * tt);
      }

      const jx = (Math.sin(played * 0.06) + Math.sin(played * 0.13)) * 0.25;
      const jy = (Math.cos(played * 0.07) + Math.sin(played * 0.11)) * 0.25;
      quillEl.setAttribute('transform', `translate(${x + jx} ${y + jy})`);

      if (featherEl) {
        const q = -1.6 + (Math.sin(tremor * 0.015) * 0.5 + 0.5) * 3.4;
        featherEl.setAttribute('transform', `rotate(${q.toFixed(2)})`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="presentation"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="featherInk" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1b1310" />
          <stop offset="0.65" stopColor="#2a1f1a" />
          <stop offset="1" stopColor="#4a3a30" />
        </linearGradient>
      </defs>

      {/* ink lines */}
      <g
        ref={inkRef}
        fill="none"
        stroke="#3A2A1A"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {INK_PATHS.map((d, i) => <path key={i} d={d} />)}
      </g>

      {/* feather (transform set per frame) */}
      <g ref={quillRef}>
        <g transform="rotate(-34)">
          <g ref={featherRef} style={{ transformOrigin: '0px 0px' } as React.CSSProperties}>
            {/* tiny nib at (0,0) — the writing tip */}
            

            {/* vane */}
            <path
              d="M -1.0 -7 C 3.0 -16 8.5 -26 10.0 -38 C 11.5 -50 9.0 -62 5.0 -72 C 3.0 -78 1.0 -82 -0.2 -84 C -0.6 -82 -1.2 -78 -1.8 -74 C -2.4 -70 -3.4 -64 -4.8 -56 C -7.0 -44 -8.4 -32 -7.2 -22 C -6.4 -16 -4.0 -11 -1.6 -8 Z"
              fill="url(#featherInk)"
            />

            {/* left barbs */}
            <g stroke="#f1ede3" strokeWidth={0.55} strokeLinecap="round" fill="none" opacity={0.95}>
              <path d="M -0.5 -12 C -2 -13 -3 -13 -4 -12.5" />
              <path d="M -0.7 -18 C -2.5 -19.5 -4 -20 -5 -19.5" />
              <path d="M -1.0 -24 C -3 -26 -5 -27 -6.2 -26.5" />
              <path d="M -1.4 -30 C -3.5 -32 -5.6 -33 -7 -32.5" />
              <path d="M -1.8 -36 C -4 -38 -6 -39.5 -7.4 -39" />
              <path d="M -2.2 -42 C -4.2 -44 -6 -45.5 -7.2 -45.2" />
              <path d="M -2.6 -48 C -4.4 -50 -5.8 -51.5 -6.6 -51.4" />
              <path d="M -3.0 -54 C -4.4 -56 -5.4 -57.5 -5.8 -57.6" />
              <path d="M -3.0 -60 C -4 -62 -4.6 -63.5 -4.8 -64" />
              <path d="M -2.4 -66 C -3 -68 -3.2 -69.5 -3.0 -70" />
            </g>

            {/* right barbs */}
            <g stroke="#f1ede3" strokeWidth={0.55} strokeLinecap="round" fill="none" opacity={0.95}>
              <path d="M  0.4 -14 C 2 -14 3.5 -13.5 4.5 -12.5" />
              <path d="M  0.6 -20 C 2.5 -20 4.5 -19.5 6 -18.5" />
              <path d="M  0.8 -26 C 3.0 -26.5 5.5 -25.5 7.5 -24" />
              <path d="M  1.2 -32 C 3.5 -33 6.5 -32 8.8 -30" />
              <path d="M  1.6 -38 C 4 -39 7 -38.5 9.5 -36.5" />
              <path d="M  2.0 -44 C 4.2 -45.5 7 -45.5 9.6 -43.5" />
              <path d="M  2.4 -50 C 4.2 -52 6.6 -52.5 8.8 -51" />
              <path d="M  2.6 -56 C 4 -58 6 -58.5 7.6 -57.5" />
              <path d="M  2.6 -62 C 3.6 -64 5 -64.5 6 -64" />
              <path d="M  2.4 -68 C 3 -70 3.8 -70.5 4.4 -70.2" />
              <path d="M  1.8 -74 C 2.2 -75.5 2.6 -76.5 2.8 -76.5" />
            </g>

            
          </g>
        </g>
      </g>
    </svg>
  );
}
