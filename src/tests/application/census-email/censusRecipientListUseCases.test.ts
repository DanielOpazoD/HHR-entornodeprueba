import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeBootstrapCensusRecipientLists,
  executeCreateCensusRecipientList,
  executeDeleteCensusRecipientList,
  executeLoadCensusRecipientRuntimeState,
  executeRenameCensusRecipientList,
  executeSyncCensusRecipientList,
} from '@/application/census-email/censusRecipientListUseCases';
import * as emailRecipientListService from '@/services/email/emailRecipientListService';
import * as indexedDbSettingsService from '@/services/storage/indexeddb/indexedDbSettingsService';
import * as bootstrapController from '@/hooks/controllers/censusEmailRecipientsBootstrapController';
import type { CensusEmailBrowserRuntime } from '@/hooks/controllers/censusEmailBrowserRuntimeController';

vi.mock('@/services/email/emailRecipientListService', () => ({
  CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST: {
    id: 'census-default',
    name: 'Destinatarios predeterminados de censo diario',
    description: 'Lista global reutilizable para envios predeterminados de censo diario.',
  },
  areGlobalEmailRecipientsEqual: (left: string[] = [], right: string[] = []) =>
    JSON.stringify(left) === JSON.stringify(right),
  buildGlobalEmailRecipientListId: vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-')),
  deleteGlobalEmailRecipientList: vi.fn(),
  deleteGlobalEmailRecipientListWithResult: vi.fn().mockResolvedValue({
    status: 'success',
    data: { deleted: true },
    issues: [],
  }),
  saveGlobalEmailRecipientList: vi.fn(),
  saveGlobalEmailRecipientListWithResult: vi.fn().mockResolvedValue({
    status: 'success',
    data: { saved: true },
    issues: [],
  }),
}));

vi.mock('@/hooks/controllers/censusEmailRecipientsBootstrapController', () => ({
  resolveCensusRecipientsBootstrap: vi.fn(),
}));

vi.mock('@/services/storage/indexeddb/indexedDbSettingsService', () => ({
  getSetting: vi.fn(),
}));

describe('censusRecipientListUseCases', () => {
  const browserRuntime: CensusEmailBrowserRuntime = {
    getLegacyRecipients: () => null,
    clearLegacyRecipients: vi.fn(),
    writeClipboard: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps bootstrap as a success outcome', async () => {
    vi.mocked(bootstrapController.resolveCensusRecipientsBootstrap).mockResolvedValueOnce({
      recipients: ['a@test.com'],
      recipientsSource: 'firebase',
      recipientLists: [],
      activeRecipientList: null,
      syncError: null,
    });

    const result = await executeBootstrapCensusRecipientLists({
      canManageGlobalRecipientLists: true,
      browserRuntime,
      activeListStorageKey: 'key',
      user: null,
    });

    expect(result.status).toBe('success');
    expect(result.data?.recipients).toEqual(['a@test.com']);
  });

  it('loads stored runtime state when global management is disabled', async () => {
    vi.mocked(indexedDbSettingsService.getSetting)
      .mockResolvedValueOnce(['stored@test.com'])
      .mockResolvedValueOnce('custom-list');

    const result = await executeLoadCensusRecipientRuntimeState({
      canManageGlobalRecipientLists: false,
      browserRuntime,
      enabled: true,
      activeListStorageKey: 'active-key',
      recipientsStorageKey: 'recipients-key',
      user: null,
    });

    expect(result.status).toBe('success');
    expect(result.data).toMatchObject({
      recipients: ['stored@test.com'],
      activeRecipientListId: 'custom-list',
      recipientsSource: 'local',
    });
  });

  it('falls back to stored runtime state when bootstrap fails', async () => {
    vi.mocked(bootstrapController.resolveCensusRecipientsBootstrap).mockRejectedValueOnce(
      new Error('bootstrap failed')
    );
    vi.mocked(indexedDbSettingsService.getSetting).mockResolvedValueOnce(['fallback@test.com']);

    const result = await executeLoadCensusRecipientRuntimeState({
      canManageGlobalRecipientLists: true,
      browserRuntime,
      enabled: true,
      activeListStorageKey: 'active-key',
      recipientsStorageKey: 'recipients-key',
      user: null,
    });

    expect(result.status).toBe('success');
    expect(result.data).toMatchObject({
      recipients: ['fallback@test.com'],
      activeRecipientListId: 'census-default',
      recipientsSource: 'local',
    });
    expect(result.data?.recipientsSyncError).toBe('bootstrap failed');
  });

  it('keeps the stored runtime state when the UI is disabled even if management is allowed', async () => {
    vi.mocked(indexedDbSettingsService.getSetting)
      .mockResolvedValueOnce(['stored@test.com'])
      .mockResolvedValueOnce('custom-list');

    const result = await executeLoadCensusRecipientRuntimeState({
      canManageGlobalRecipientLists: true,
      browserRuntime,
      enabled: false,
      activeListStorageKey: 'active-key',
      recipientsStorageKey: 'recipients-key',
      user: null,
    });

    expect(bootstrapController.resolveCensusRecipientsBootstrap).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.data).toMatchObject({
      recipients: ['stored@test.com'],
      activeRecipientListId: 'custom-list',
      recipientsSource: 'local',
    });
  });

  it('creates a list through the application layer', async () => {
    vi.mocked(
      emailRecipientListService.saveGlobalEmailRecipientListWithResult
    ).mockResolvedValueOnce({ status: 'success', data: { saved: true }, issues: [] });

    const result = await executeCreateCensusRecipientList({
      canManageGlobalRecipientLists: true,
      name: 'Nueva Lista',
      recipients: ['a@test.com'],
      recipientLists: [],
      actor: { email: 'admin@test.com' },
    });

    expect(result.status).toBe('success');
    expect(result.data?.name).toBe('Nueva Lista');
  });

  it('renames a list through the application layer', async () => {
    vi.mocked(
      emailRecipientListService.saveGlobalEmailRecipientListWithResult
    ).mockResolvedValueOnce({ status: 'success', data: { saved: true }, issues: [] });

    const result = await executeRenameCensusRecipientList({
      canManageGlobalRecipientLists: true,
      activeList: {
        id: 'custom',
        name: 'Vieja',
        description: '',
        recipients: ['a@test.com'],
        scope: 'global',
        updatedAt: '',
        updatedByUid: null,
        updatedByEmail: null,
      },
      name: 'Nueva',
      recipients: ['a@test.com'],
      actor: { email: 'admin@test.com' },
    });

    expect(result.status).toBe('success');
    expect(result.data?.name).toBe('Nueva');
  });

  it('deletes a list through the application layer', async () => {
    vi.mocked(
      emailRecipientListService.deleteGlobalEmailRecipientListWithResult
    ).mockResolvedValueOnce({ status: 'success', data: { deleted: true }, issues: [] });

    const result = await executeDeleteCensusRecipientList({
      canManageGlobalRecipientLists: true,
      listId: 'custom',
      recipientLists: [
        {
          id: 'custom',
          name: 'Custom',
          description: '',
          recipients: ['a@test.com'],
          scope: 'global',
          updatedAt: '',
          updatedByUid: null,
          updatedByEmail: null,
        },
        {
          id: 'fallback',
          name: 'Fallback',
          description: '',
          recipients: ['b@test.com'],
          scope: 'global',
          updatedAt: '',
          updatedByUid: null,
          updatedByEmail: null,
        },
      ],
    });

    expect(result.status).toBe('success');
    expect(result.data.fallbackList?.id).toBe('fallback');
  });

  it('skips recipient sync when there is nothing to persist', async () => {
    const result = await executeSyncCensusRecipientList({
      canManageGlobalRecipientLists: true,
      recipientsReady: true,
      recipients: ['a@test.com'],
      lastRemoteRecipients: ['a@test.com'],
      recipientLists: [],
      activeRecipientListId: 'census-default',
      actor: null,
    });

    expect(result.status).toBe('success');
    expect(result.data.skipped).toBe(true);
  });
});
