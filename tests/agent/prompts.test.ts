// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../src/agent/prompts';
import type { Book } from '../../src/db/types';

const baseBook: Book = {
  id: 1, title: 'Moby-Dick', author: 'Melville', cover_image_path: null,
  file_path: '', file_type: 'epub', last_opened: null, current_position: null,
  display_mode: 'agent', metadata_source: 'extracted', epub_locations: null,
  created_at: '',
};

describe('buildSystemPrompt', () => {
  it('includes persona, book, position, page text, and tool guide always', () => {
    const out = buildSystemPrompt({
      book: baseBook, position: null, positionLabel: 'Ch. 1',
      currentPageText: 'Call me Ishmael.', spoilerMode: false,
      recentNotes: [], recentVocab: [], preferences: [],
      globalProfile: null, bookProfile: null,
    });
    expect(out).toContain('[PERSONA]');
    expect(out).toContain('Moby-Dick');
    expect(out).toContain('Ch. 1');
    expect(out).toContain('Call me Ishmael.');
    expect(out).toContain('[TOOLS]');
    expect(out).not.toContain('[SPOILER MODE]');
  });

  it('adds spoiler rule when enabled', () => {
    const out = buildSystemPrompt({
      book: baseBook, position: null, positionLabel: '',
      currentPageText: '', spoilerMode: true,
      recentNotes: [], recentVocab: [], preferences: [],
      globalProfile: null, bookProfile: null,
    });
    expect(out).toContain('[SPOILER MODE]');
  });

  it('truncates oversized current-page text', () => {
    const huge = 'x'.repeat(40_000);
    const out = buildSystemPrompt({
      book: baseBook, position: null, positionLabel: '',
      currentPageText: huge, spoilerMode: false,
      recentNotes: [], recentVocab: [], preferences: [],
      globalProfile: null, bookProfile: null,
    });
    // 3000 tokens × 4 chars = 12000 chars; output should not contain all 40k.
    expect(out.length).toBeLessThan(20_000);
  });
});
