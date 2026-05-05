import { useState } from 'react';
import type { Book } from '../../../db/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AiChatTab } from './AiChatTab';
import { DictionaryTab } from './DictionaryTab';
import { HighlightsTab } from './HighlightsTab';
import { NotesTab } from './NotesTab';

interface Props {
  book: Book;
}

export function AgentPanel({ book }: Props) {
  const [tab, setTab] = useState('chat');

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col">
      <div className="border-b border-stone-200 px-2 py-2">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="chat">AI Chat</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="highlights">Highlights</TabsTrigger>
          <TabsTrigger value="dictionary">Dictionary</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="chat" className="flex-1 overflow-y-auto p-4">
        <AiChatTab />
      </TabsContent>
      <TabsContent value="notes" className="flex-1 overflow-y-auto p-4">
        <NotesTab book={book} />
      </TabsContent>
      <TabsContent value="highlights" className="flex-1 overflow-y-auto p-4">
        <HighlightsTab book={book} />
      </TabsContent>
      <TabsContent value="dictionary" className="flex-1 overflow-y-auto p-4">
        <DictionaryTab book={book} />
      </TabsContent>
    </Tabs>
  );
}
