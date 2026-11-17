// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  resolveRecipientRuntimeAfterCreate,
  resolveRecipientRuntimeAfterDeleteOutcome,
  resolveRecipientRuntimeAfterRename,
  resolveRecipientRuntimeAfterDelete,
} from '@/hooks/controllers/censusEmailRecipientMutationRuntimeController';
import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';

const buildList = (
  overrides: Partial<GlobalEmailRecipientList> = {}
): GlobalEmailRecipientList => ({
  id: 'census-default',
  name: 'Censo',
  description: 'desc',
  recipients: ['uno@example.com'],
  scope: 'global',
  updatedAt: '2026-04-14T10:00:00.000Z',
  updatedByUid: null,
  updatedByEmail: null,
  ...overrides,
});

describe('censusEmailRecipientMutationRuntimeController', () => {
  it('activates the created list as the next runtime state', () => {
    const created = buildList({ id: 'custom', name: 'Custom', recipients: ['dos@example.com'] });

    expect(resolveRecipientRuntimeAfterCreate([buildList()], created)).toEqual({
      recipientLists: [created, buildList()],
      recipients: ['dos@example.com'],
      recipientsSource: 'firebase',
      activeRecipientListId: 'custom',
      recipientsSyncError: null,
      lastRemoteRecipients: ['dos@example.com'],
    });
  });

  it('keeps the renamed active list as the next runtime state', () => {
    const current = buildList();
    const renamed = buildList({ name: 'Renombrada', recipients: ['renombrada@example.com'] });

    expect(resolveRecipientRuntimeAfterRename([current], renamed)).toEqual({
      recipientLists: [renamed],
      recipients: ['renombrada@example.com'],
      recipientsSource: 'firebase',
      activeRecipientListId: 'census-default',
      recipientsSyncError: null,
      lastRemoteRecipients: ['renombrada@example.com'],
    });
  });

  it('falls back to the provided list after delete flows', () => {
    const current = buildList();
    const other = buildList({ id: 'otra', name: 'Otra', recipients: ['otra@example.com'] });

    expect(
      resolveRecipientRuntimeAfterDelete({
        recipientLists: [current, other],
        listId: 'otra',
        fallbackList: current,
      })
    ).toEqual({
      recipientLists: [current],
      recipients: ['uno@example.com'],
      recipientsSource: 'firebase',
      activeRecipientListId: 'census-default',
      recipientsSyncError: null,
      lastRemoteRecipients: ['uno@example.com'],
    });
  });

  it('returns null when delete outcomes do not include a fallback list', () => {
    expect(
      resolveRecipientRuntimeAfterDeleteOutcome({
        recipientLists: [buildList()],
        listId: 'missing',
        fallbackList: null,
      })
    ).toBeNull();
  });
});
