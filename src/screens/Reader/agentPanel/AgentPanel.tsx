import { Check, Menu } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Book } from '../../../db/types';
import { useAppStore } from '../../../store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AiChatTab } from './AiChatTab';
import { DictionaryTab } from './DictionaryTab';
import { NotesTab } from './NotesTab';

interface Props {
  book: Book;
}

export function AgentPanel({ book }: Props) {
  const [tab, setTab] = useState('chat');
  const [scopeOpen, setScopeOpen] = useState(false);
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  const scopeButtonRef = useRef<HTMLButtonElement | null>(null);
  const scopePanelRef = useRef<HTMLDivElement | null>(null);
  const navItems = useAppStore((state) => state.readerNavItems);
  const showScope = book.file_type === 'epub' && tab === 'notes';
  const selectedScope = useMemo(
    () => navItems.find((item) => item.id === selectedScopeId) ?? null,
    [navItems, selectedScopeId],
  );
  const scopeLabel = selectedScope?.label ?? 'All Notes';

  useEffect(() => {
    if (!showScope) {
      setScopeOpen(false);
    }
  }, [showScope]);

  useEffect(() => {
    if (!scopeOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (scopeButtonRef.current?.contains(target) || scopePanelRef.current?.contains(target)) {
        return;
      }
      setScopeOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [scopeOpen]);

  function ScopedPanelContent({
    showScope: shouldShowScope,
    scopeLabel: label,
    children,
  }: {
    showScope: boolean;
    scopeLabel: string;
    children: ReactNode;
  }) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {shouldShowScope ? (
          <div className="relative border-b border-stone-100 px-4 py-2">
            <button
              ref={scopeButtonRef}
              type="button"
              aria-label="Choose notes scope"
              onClick={() => setScopeOpen((value) => !value)}
              className="flex max-w-full items-center gap-1 rounded-md py-1 text-left text-sm text-ink-muted transition hover:bg-white hover:text-ink"
            >
              <Menu className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">{label}</span>
            </button>
            {scopeOpen ? (
              <div
                ref={scopePanelRef}
                className="absolute left-4 top-11 z-30 w-60 overflow-hidden rounded-lg border border-stone-200 bg-cream shadow-xl"
              >
                <ScopeButton
                  active={selectedScopeId === null}
                  label="All Notes"
                  onClick={() => {
                    setSelectedScopeId(null);
                    setScopeOpen(false);
                  }}
                />
                {navItems.map((item) => (
                  <ScopeButton
                    key={item.id}
                    active={selectedScopeId === item.id}
                    label={item.label}
                    onClick={() => {
                      setSelectedScopeId(item.id);
                      setScopeOpen(false);
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    );
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col">
      <div className="flex h-14 items-center border-b border-stone-200 px-2">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="chat">AI Chat</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="dictionary">Dictionary</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="chat" className="flex-1 overflow-hidden">
        <AiChatTab book={book} />
      </TabsContent>
      <TabsContent value="notes" className="flex-1 overflow-hidden">
        <ScopedPanelContent showScope={showScope} scopeLabel={scopeLabel}>
          <NotesTab book={book} scope={showScope ? selectedScope : null} />
        </ScopedPanelContent>
      </TabsContent>
      <TabsContent value="dictionary" className="flex-1 overflow-y-auto p-4">
        <DictionaryTab book={book} />
      </TabsContent>
    </Tabs>
  );
}

function ScopeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
        active ? 'bg-white text-ink' : 'text-ink-muted hover:bg-white/70 hover:text-ink'
      }`}
      onClick={onClick}
    >
      <span className="min-w-0 truncate">{label}</span>
      {active ? <Check className="h-4 w-4 shrink-0 text-accent-orange" /> : null}
    </button>
  );
}
