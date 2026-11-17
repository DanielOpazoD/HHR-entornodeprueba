// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';
import { upsertRecipientListState } from '@/hooks/controllers/censusEmailRecipientListStateController';

describe('censusEmailRecipientListStateController', () => {
  const buildList = (id: string, name: string): GlobalEmailRecipientList => ({
    id,
    name,
    description: '',
    recipients: [`${id}@example.com`],
    scope: 'global',
    updatedAt: '2026-04-14T00:00:00.000Z',
    updatedByUid: 'uid',
    updatedByEmail: 'user@example.com',
  });

  it('prepends a new recipient list when it does not exist', () => {
    expect(
      upsertRecipientListState([buildList('default', 'Default')], buildList('custom', 'Custom'))
    ).toEqual([buildList('custom', 'Custom'), buildList('default', 'Default')]);
  });

  it('replaces an existing recipient list in place when ids match', () => {
    expect(
      upsertRecipientListState(
        [buildList('default', 'Default'), buildList('custom', 'Old')],
        buildList('custom', 'New')
      )
    ).toEqual([buildList('default', 'Default'), buildList('custom', 'New')]);
  });
});
