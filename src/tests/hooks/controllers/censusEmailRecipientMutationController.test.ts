// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';
import {
  resolveRecipientListsAfterCreate,
  resolveRecipientListForSelection,
  resolveRecipientListsAfterDelete,
  resolveRecipientListsAfterRename,
  resolveRecipientSelectionAfterDelete,
} from '@/hooks/controllers/censusEmailRecipientMutationController';

describe('censusEmailRecipientMutationController', () => {
  const lists: GlobalEmailRecipientList[] = [
    {
      id: 'default',
      name: 'Default',
      description: '',
      recipients: ['a@example.com'],
      scope: 'global',
      updatedAt: '2026-04-14T00:00:00.000Z',
      updatedByUid: 'u1',
      updatedByEmail: 'a@example.com',
    },
    {
      id: 'custom',
      name: 'Custom',
      description: '',
      recipients: ['b@example.com'],
      scope: 'global',
      updatedAt: '2026-04-14T00:00:00.000Z',
      updatedByUid: 'u2',
      updatedByEmail: 'b@example.com',
    },
  ];

  it('resolves the selected recipient list when it exists', () => {
    expect(resolveRecipientListForSelection(lists, 'custom')).toMatchObject({
      id: 'custom',
      name: 'Custom',
    });
    expect(resolveRecipientListForSelection(lists, 'missing')).toBeUndefined();
  });

  it('removes a deleted list from the available recipient lists', () => {
    expect(resolveRecipientListsAfterDelete(lists, 'custom')).toEqual([
      {
        id: 'default',
        name: 'Default',
        description: '',
        recipients: ['a@example.com'],
        scope: 'global',
        updatedAt: '2026-04-14T00:00:00.000Z',
        updatedByUid: 'u1',
        updatedByEmail: 'a@example.com',
      },
    ]);
  });

  it('adds a created list and marks it as the next active list', () => {
    const created = {
      id: 'new-list',
      name: 'Nueva',
      description: '',
      recipients: ['c@example.com'],
      scope: 'global',
      updatedAt: '2026-04-14T00:00:00.000Z',
      updatedByUid: 'u3',
      updatedByEmail: 'c@example.com',
    } satisfies GlobalEmailRecipientList;

    expect(resolveRecipientListsAfterCreate(lists, created)).toEqual({
      recipientLists: [created, ...lists],
      activeRecipientList: created,
    });
  });

  it('upserts the renamed list without changing the rest of the collection', () => {
    expect(
      resolveRecipientListsAfterRename(lists, {
        ...lists[1],
        name: 'Renombrada',
      })
    ).toEqual([
      lists[0],
      {
        ...lists[1],
        name: 'Renombrada',
      },
    ]);
  });

  it('resolves the next active list after deleting the current global list', () => {
    expect(
      resolveRecipientSelectionAfterDelete({
        recipientLists: lists,
        listId: 'custom',
        fallbackList: lists[0],
      })
    ).toEqual({
      recipientLists: [lists[0]],
      activeRecipientListId: 'default',
    });
  });
});
