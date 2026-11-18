// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  resolveBootstrapRecipientSelection,
  resolveStoredRecipientSelection,
} from '@/features/census/email/controllers/censusEmailRecipientSelectionController';
import {
  CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST,
  type GlobalEmailRecipientList,
} from '@/services/email/emailRecipientListService';

describe('censusEmailRecipientSelectionController', () => {
  it('restores local recipients and active list id when stored values exist', () => {
    expect(resolveStoredRecipientSelection(['Local@Test.com'], 'custom-list')).toEqual({
      recipients: ['local@test.com'],
      recipientsSource: 'local',
      activeRecipientListId: 'custom-list',
    });
  });

  it('falls back to defaults when stored recipients are missing or invalid', () => {
    expect(resolveStoredRecipientSelection(null)).toEqual({
      recipients: [],
      recipientsSource: 'default',
      activeRecipientListId: 'census-default',
    });

    expect(resolveStoredRecipientSelection(['', '   '], null)).toEqual({
      recipients: [],
      recipientsSource: 'default',
      activeRecipientListId: 'census-default',
    });
  });

  it('prefers the active Firebase list and preserves last remote recipients during bootstrap', () => {
    const activeRecipientList: GlobalEmailRecipientList = {
      id: 'team-night',
      name: 'Turno noche',
      description: '',
      recipients: ['noche@hospital.cl'],
      scope: 'global',
      updatedAt: new Date(0).toISOString(),
      updatedByUid: null,
      updatedByEmail: null,
    };

    expect(
      resolveBootstrapRecipientSelection({
        recipientLists: [activeRecipientList],
        activeRecipientList,
        recipients: [],
        recipientsSource: 'default',
        syncError: null,
      })
    ).toEqual({
      recipientLists: [activeRecipientList],
      recipients: ['noche@hospital.cl'],
      recipientsSource: 'firebase',
      activeRecipientListId: 'team-night',
      lastRemoteRecipients: ['noche@hospital.cl'],
    });
  });

  it('falls back to the default list id when bootstrap has no active Firebase list', () => {
    expect(
      resolveBootstrapRecipientSelection({
        recipientLists: [],
        activeRecipientList: null,
        recipients: ['local@hospital.cl'],
        recipientsSource: 'local',
        syncError: 'sync error',
      })
    ).toEqual({
      recipientLists: [],
      recipients: ['local@hospital.cl'],
      recipientsSource: 'local',
      activeRecipientListId: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id,
      lastRemoteRecipients: null,
    });
  });
});
