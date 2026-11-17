// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCensusRecipientsBootstrap } from '@/hooks/controllers/censusEmailRecipientsBootstrapController';

vi.mock('@/services/storage/indexeddb/indexedDbSettingsService', () => ({
  getSetting: vi.fn(),
  saveSetting: vi.fn(),
}));

vi.mock('@/services/email/emailRecipientListService', () => ({
  CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST: {
    id: 'census-default',
    name: 'Censo diario (predeterminado)',
    description: 'Lista global reutilizable para envios predeterminados de censo diario.',
  },
  ensureGlobalEmailRecipientList: vi.fn().mockResolvedValue(undefined),
  getGlobalEmailRecipientListsWithResult: vi.fn().mockResolvedValue({
    status: 'success',
    data: [],
    issues: [],
  }),
}));

import { getSetting, saveSetting } from '@/services/storage/indexeddb/indexedDbSettingsService';
import {
  ensureGlobalEmailRecipientList,
  getGlobalEmailRecipientListsWithResult,
} from '@/services/email/emailRecipientListService';

describe('censusEmailRecipientsBootstrapController', () => {
  const browserRuntime = {
    getLegacyRecipients: vi.fn(),
    clearLegacyRecipients: vi.fn(),
    getOrigin: vi.fn(() => 'http://localhost:3000'),
    writeClipboard: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns local recipients when user cannot manage global lists', async () => {
    vi.mocked(getSetting).mockResolvedValueOnce(['local@test.com']);

    const result = await resolveCensusRecipientsBootstrap({
      canManageGlobalRecipientLists: false,
      browserRuntime,
      activeListStorageKey: 'active',
      user: null,
    });

    expect(result.recipients).toEqual(['local@test.com']);
    expect(result.recipientsSource).toBe('local');
  });

  it('creates default global list when none exists', async () => {
    vi.mocked(getSetting)
      .mockResolvedValueOnce(['seed@test.com'])
      .mockResolvedValueOnce('census-default');
    vi.mocked(getGlobalEmailRecipientListsWithResult)
      .mockResolvedValueOnce({
        status: 'success',
        data: [],
        issues: [],
      } as never)
      .mockResolvedValueOnce({
        status: 'success',
        data: [
          {
            id: 'census-default',
            name: 'Global',
            description: null,
            recipients: ['seed@test.com'],
            scope: 'global',
            updatedAt: '2026-03-03T10:00:00.000Z',
            updatedByUid: null,
            updatedByEmail: null,
          },
        ],
        issues: [],
      } as never);

    const result = await resolveCensusRecipientsBootstrap({
      canManageGlobalRecipientLists: true,
      browserRuntime,
      activeListStorageKey: 'active',
      user: { email: 'admin@test.com', uid: '1' },
    });

    expect(ensureGlobalEmailRecipientList).toHaveBeenCalledWith(
      expect.objectContaining({
        listId: 'census-default',
        recipients: ['seed@test.com'],
      })
    );
    expect(result.recipientsSource).toBe('firebase');
    expect(result.activeRecipientList?.id).toBe('census-default');
  });

  it('migrates legacy browser recipients before creating firebase seed', async () => {
    vi.mocked(getSetting).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    vi.mocked(getGlobalEmailRecipientListsWithResult).mockResolvedValue({
      status: 'success',
      data: [],
      issues: [],
    } as never);
    browserRuntime.getLegacyRecipients.mockReturnValue(JSON.stringify(['legacy@test.com']));

    await resolveCensusRecipientsBootstrap({
      canManageGlobalRecipientLists: true,
      browserRuntime,
      activeListStorageKey: 'active',
      user: { email: 'admin@test.com', uid: '1' },
    });

    expect(saveSetting).toHaveBeenCalledWith('censusEmailRecipients', ['legacy@test.com']);
    expect(browserRuntime.clearLegacyRecipients).toHaveBeenCalled();
  });

  it('falls back to local recipients when firebase returns a failed outcome', async () => {
    vi.mocked(getSetting)
      .mockResolvedValueOnce(['local@test.com'])
      .mockResolvedValueOnce('census-default');
    vi.mocked(getGlobalEmailRecipientListsWithResult).mockResolvedValueOnce({
      status: 'failed',
      data: [],
      issues: [
        { message: 'firebase denied', userSafeMessage: 'No se pudo cargar la lista global.' },
      ],
      userSafeMessage: 'No se pudo cargar la lista global.',
    } as never);

    const result = await resolveCensusRecipientsBootstrap({
      canManageGlobalRecipientLists: true,
      browserRuntime,
      activeListStorageKey: 'active',
      user: { email: 'admin@test.com', uid: '1' },
    });

    expect(result.recipients).toEqual(['local@test.com']);
    expect(result.recipientsSource).toBe('local');
    expect(result.syncError).toContain('No se pudo cargar la lista global');
  });
});
