import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
      {isCta && (
        <div className="mt-4 font-serif text-base text-ink-muted">
          Begin a new study.
        </div>
      )}
    </button>
  );
}

function Quill({ hovered }: { hovered: boolean }) {
  return (
    <svg
      viewBox="0 0 200 300"
      className="h-full w-full"
      role="presentation"
      aria-hidden="true"
    >
      {/* Inkwell */}
      <motion.g
        initial={false}
        animate={hovered ? { scale: 1.02 } : { scale: 1 }}
        transition={{ duration: 0.4 }}
        style={{ transformOrigin: '100px 240px' }}
      >
        <ellipse cx="100" cy="245" rx="34" ry="8" fill="#E5DCC8" />
        <path
          d="M70 240 Q70 260 100 262 Q130 260 130 240 Z"
          fill="#F5EFE0"
          stroke="#A89880"
          strokeWidth="1"
        />
        <ellipse cx="100" cy="240" rx="30" ry="6" fill="#3A2A1A" />
      </motion.g>

      {/* Quill - drifts when idle, lifts on hover */}
      <motion.g
        initial={false}
        animate={
          hovered
            ? { rotate: -8, x: 10, y: -30 }
            : {
                rotate: [-2, 2, -2],
                x: [-1, 1, -1],
                y: [0, -1, 0],
              }
        }
        transition={
          hovered
            ? { duration: 0.25, ease: 'easeOut' }
            : { duration: 4, ease: 'easeInOut', repeat: Infinity }
        }
        style={{ transformOrigin: '100px 240px' }}
      >
        {/* Feather */}
        <path
          d="M120 80 Q140 130 130 200 Q120 220 110 230 Q108 215 115 200 Q120 150 118 100 Z"
          fill="#F4ECD8"
          stroke="#B8A98E"
          strokeWidth="0.8"
        />
        {/* Spine */}
        <line x1="120" y1="80" x2="110" y2="232" stroke="#7A6A52" strokeWidth="1.5" />
        {/* Nib */}
        <path
          d="M108 232 L112 232 L113 244 L107 244 Z"
          fill="#3A2A1A"
        />
        {/* Ink stain near nib */}
        <ellipse cx="110" cy="244" rx="2" ry="1.2" fill="#3A2A1A" />
      </motion.g>

      {/* Calligraphic flourish drawn on hover */}
      <AnimatePresence>
        {hovered && (
          <motion.path
            key="flourish"
            d="M50 130 C70 110, 130 110, 150 130 M95 110 L95 150 M75 130 L115 130"
            stroke="#B45A2B"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            transition={{ pathLength: { duration: 0.6, ease: 'easeInOut' } }}
          />
        )}
      </AnimatePresence>
    </svg>
  );
}
