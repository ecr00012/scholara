// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { titleFromFilename } from '../../src/lib/titleCase';

describe('titleFromFilename', () => {
  it('strips the extension', () => {
    expect(titleFromFilename('war_and_peace.pdf')).toBe('War and Peace');
  });

  it('replaces underscores and dashes with spaces', () => {
    expect(titleFromFilename('the-brothers-karamazov.epub')).toBe(
      'The Brothers Karamazov',
    );
  });

  it('keeps function words lowercase except as the first word', () => {
    expect(titleFromFilename('the_lord_of_the_rings.pdf')).toBe(
      'The Lord of the Rings',
    );
  });

  it('capitalizes the first word even when it is a function word', () => {
    expect(titleFromFilename('a_brief_history_of_time.pdf')).toBe(
      'A Brief History of Time',
    );
  });

  it('collapses multiple separators', () => {
    expect(titleFromFilename('foo___bar--baz.epub')).toBe('Foo Bar Baz');
  });

  it('handles paths by taking only the basename', () => {
    expect(titleFromFilename('/Users/me/Documents/some_book.pdf')).toBe(
      'Some Book',
    );
  });

  it('falls back to "Untitled" for empty / unparseable input', () => {
    expect(titleFromFilename('.pdf')).toBe('Untitled');
    expect(titleFromFilename('')).toBe('Untitled');
  });
});
