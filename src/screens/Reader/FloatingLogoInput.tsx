import { AnimatePresence, motion } from 'framer-motion';
import { Feather } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export function FloatingLogoInput() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  function submit() {
    setText('');
    setOpen(false);
    toast.message('AI features arriving in Phase 3.');
  }

  return (
    <AnimatePresence mode="wait">
      {!open ? (
        <motion.button
          key="floating-logo-button"
          layoutId="floating-logo"
          type="button"
          aria-label="Ask Scholara"
          onClick={() => setOpen(true)}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-amber-100 bg-cream/95 shadow-lg"
        >
          <Feather className="h-5 w-5 text-ink" />
        </motion.button>
      ) : (
        <motion.div
          key="floating-logo-input"
          layoutId="floating-logo"
          className="flex h-14 w-[80vw] items-center rounded-full border border-white/30 bg-white/45 px-5 shadow-lg backdrop-blur-md"
        >
          <input
            autoFocus
            type="text"
            value={text}
            placeholder="Ask anything…"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                submit();
              }
              if (event.key === 'Escape') {
                setText('');
                setOpen(false);
              }
            }}
            onBlur={() => {
              setText('');
              setOpen(false);
            }}
            className="w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
