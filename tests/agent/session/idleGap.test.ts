// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ThreadRow } from '../../../src/db/types';
import { IDLE_GAP_MS, pickActiveThread } from '../../../src/agent/session/idleGap';

function thread(overrides: Partial<ThreadRow>): ThreadRow {
  return {
    id: 1,
    book_id: 1,
    title: null,
    spoiler_mode: 1,
    model: 'test-model',
    last_active_at: '2026-05-10T12:00:00.000Z',
    created_at: '2026-05-10T12:00:00.000Z',
    ...overrides,
  };
}

describe('pickActiveThread', () => {
  const now = Date.parse('2026-05-10T12:00:00.000Z');

  it('creates a new thread when there are no prior threads', () => {
    expect(pickActiveThread([], now)).toBe('create-new');
  });

  it('reuses the most recent thread inside the idle gap', () => {
    const recent = thread({
      id: 7,
      last_active_at: new Date(now - IDLE_GAP_MS + 1).toISOString(),
    });

    expect(pickActiveThread([recent], now)).toBe(recent);
  });

  it('creates a new thread at or beyond the idle gap', () => {
    const stale = thread({
      id: 8,
      last_active_at: new Date(now - IDLE_GAP_MS).toISOString(),
    });

    expect(pickActiveThread([stale], now)).toBe('create-new');
  });

  it('creates a new thread when the latest activity timestamp is invalid', () => {
    expect(
      pickActiveThread([thread({ last_active_at: 'not-a-date' })], now),
    ).toBe('create-new');
  });
});
