import { describe, expect, it } from 'vitest';
import {
  normalizeEmail,
  resolveAddRecipient,
  resolveBulkRecipients,
  resolveRemoveRecipient,
  resolveSafeRecipients,
  resolveUpdateRecipient,
  resolveVisibleRecipients,
} from '@/features/census/controllers/censusEmailRecipientsController';

describe('censusEmailRecipientsController', () => {
  it('normalizes and sanitizes recipients safely', () => {
    expect(normalizeEmail('  TEST@MAIL.COM  ')).toBe('test@mail.com');
    expect(resolveSafeRecipients(undefined)).toEqual([]);
    expect(resolveSafeRecipients([' A@MAIL.COM ', '', 'b@mail.com'])).toEqual([
      'a@mail.com',
      'b@mail.com',
    ]);
  });

  it('adds recipient only when valid and unique', () => {
    const success = resolveAddRecipient({
      recipients: ['a@mail.com'],
      input: '  B@MAIL.COM ',
    });

    expect(success.ok).toBe(true);
    if (success.ok) {
      expect(success.value.recipients).toEqual(['a@mail.com', 'b@mail.com']);
    }

    const duplicate = resolveAddRecipient({
      recipients: ['a@mail.com'],
      input: 'A@MAIL.COM',
    });

    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.code).toBe('DUPLICATE_EMAIL');
    }
  });

  it('parses bulk recipients with dedupe and validation', () => {
    const success = resolveBulkRecipients({
      rawInput: 'a@mail.com\nA@mail.com,b@mail.com',
    });

    expect(success.ok).toBe(true);
    if (success.ok) {
      expect(success.value.recipients).toEqual(['a@mail.com', 'b@mail.com']);
    }

    const invalid = resolveBulkRecipients({
      rawInput: 'ok@mail.com,not-an-email',
    });

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe('INVALID_EMAIL');
    }
  });

  it('updates and removes recipients with explicit index validation', () => {
    const updated = resolveUpdateRecipient({
      recipients: ['a@mail.com', 'b@mail.com'],
      index: 1,
      input: 'c@mail.com',
    });

    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.recipients).toEqual(['a@mail.com', 'c@mail.com']);
    }

    const invalidUpdate = resolveUpdateRecipient({
      recipients: ['a@mail.com'],
      index: 5,
      input: 'b@mail.com',
    });
    expect(invalidUpdate.ok).toBe(false);

    const removed = resolveRemoveRecipient({
      recipients: ['a@mail.com', 'b@mail.com'],
      index: 0,
    });

    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(removed.value.recipients).toEqual(['b@mail.com']);
    }
  });

  it('resolves visible recipients and hidden count', () => {
    const resolution = resolveVisibleRecipients({
      recipients: ['1@mail.com', '2@mail.com', '3@mail.com'],
      showAll: false,
      maxVisible: 2,
    });

    expect(resolution.visibleRecipients).toEqual(['1@mail.com', '2@mail.com']);
    expect(resolution.hiddenCount).toBe(1);
  });
});
