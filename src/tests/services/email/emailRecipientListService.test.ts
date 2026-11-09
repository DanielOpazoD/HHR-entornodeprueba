import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  areGlobalEmailRecipientsEqual,
  buildGlobalEmailRecipientListId,
  CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST,
  getGlobalEmailRecipientLists,
  getGlobalEmailRecipientList,
  getGlobalEmailRecipientListsWithResult,
  getGlobalEmailRecipientListWithResult,
  normalizeGlobalEmailRecipients,
  saveGlobalEmailRecipientList,
  saveGlobalEmailRecipientListWithResult,
  subscribeToGlobalEmailRecipientList,
  subscribeToGlobalEmailRecipientLists,
  deleteGlobalEmailRecipientListWithResult,
  deleteGlobalEmailRecipientList,
} from '@/services/email/emailRecipientListService';

vi.mock('@/services/storage/firestore', () => ({
  firestoreDb: {
    getDoc: vi.fn().mockResolvedValue(null),
    getDocs: vi.fn().mockResolvedValue([]),
    setDoc: vi.fn().mockResolvedValue(undefined),
    subscribeDoc: vi.fn().mockImplementation((_path, _id, _callback) => vi.fn()),
    subscribeQuery: vi.fn().mockImplementation((_path, _options, _callback) => vi.fn()),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

import { firestoreDb } from '@/services/storage/firestore';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

describe('emailRecipientListService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes recipients and removes invalid or duplicate entries', () => {
    expect(
      normalizeGlobalEmailRecipients([' A@MAIL.COM ', 'bad-email', 'a@mail.com', '', 1] as unknown)
    ).toEqual(['a@mail.com']);
  });

  it('compares recipient lists after normalization', () => {
    expect(areGlobalEmailRecipientsEqual(['A@mail.com'], ['a@mail.com'])).toBe(true);
    expect(areGlobalEmailRecipientsEqual(['a@mail.com'], ['b@mail.com'])).toBe(false);
  });

  it('builds unique ids from user-provided names', () => {
    expect(buildGlobalEmailRecipientListId('Lista Jefatura', ['lista-jefatura'])).toBe(
      'lista-jefatura-2'
    );
  });

  it('fetches and normalizes a global list', async () => {
    vi.mocked(firestoreDb.getDoc).mockResolvedValueOnce({
      name: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.name,
      recipients: ['A@MAIL.COM', 'invalid'],
      updatedAt: '2026-03-02T10:00:00.000Z',
    });

    const result = await getGlobalEmailRecipientList(CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id);

    expect(firestoreDb.getDoc).toHaveBeenCalledWith(
      'emailRecipientLists',
      CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id,
        recipients: ['a@mail.com'],
      })
    );
  });

  it('returns a failed outcome when global list loading throws', async () => {
    vi.mocked(firestoreDb.getDoc).mockRejectedValueOnce(new Error('boom'));

    const result = await getGlobalEmailRecipientListWithResult('missing');

    expect(result.status).toBe('failed');
    expect(result.issues[0]?.userSafeMessage).toContain('No se pudo cargar');
  });

  it('persists a normalized global list', async () => {
    await saveGlobalEmailRecipientList({
      listId: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id,
      name: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.name,
      description: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.description,
      recipients: ['A@MAIL.COM', 'a@mail.com', 'bad-email'],
      updatedByUid: 'user-1',
      updatedByEmail: 'admin@test.com',
    });

    expect(firestoreDb.setDoc).toHaveBeenCalledWith(
      'emailRecipientLists',
      CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id,
      expect.objectContaining({
        recipients: ['a@mail.com'],
        updatedByUid: 'user-1',
        updatedByEmail: 'admin@test.com',
      })
    );
  });

  it('returns a typed save failure when persistence fails', async () => {
    vi.mocked(firestoreDb.setDoc).mockRejectedValueOnce(new Error('boom'));

    const result = await saveGlobalEmailRecipientListWithResult({
      listId: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id,
      name: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.name,
      description: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.description,
      recipients: ['a@mail.com'],
    });

    expect(result.status).toBe('failed');
    expect(result.data.saved).toBe(false);
  });

  it('throws userSafeMessage from the save wrapper when persistence fails', async () => {
    vi.mocked(firestoreDb.setDoc).mockRejectedValueOnce(new Error('boom'));

    await expect(
      saveGlobalEmailRecipientList({
        listId: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id,
        name: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.name,
        description: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.description,
        recipients: ['a@mail.com'],
      })
    ).rejects.toThrow('No se pudo guardar la lista global de destinatarios.');
  });

  it('subscribes to normalized updates', () => {
    const onUpdate = vi.fn();
    let capturedCallback: ((data: unknown) => void) | undefined;

    vi.mocked(firestoreDb.subscribeDoc).mockImplementation((_path, _id, callback) => {
      capturedCallback = callback as (data: unknown) => void;
      return vi.fn();
    });

    subscribeToGlobalEmailRecipientList(CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id, onUpdate);
    capturedCallback?.({
      name: 'Lista',
      recipients: ['A@MAIL.COM', 'bad-email'],
      updatedAt: '2026-03-02T10:00:00.000Z',
    });

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: ['a@mail.com'],
      })
    );
  });

  it('lists normalized recipient lists from the collection', async () => {
    vi.mocked(firestoreDb.getDocs).mockResolvedValueOnce([
      {
        id: 'lista-1',
        name: 'Lista 1',
        recipients: ['A@MAIL.COM'],
        updatedAt: '2026-03-02T10:00:00.000Z',
      },
    ]);

    const result = await getGlobalEmailRecipientLists();
    expect(result).toEqual([
      expect.objectContaining({
        id: 'lista-1',
        recipients: ['a@mail.com'],
      }),
    ]);
  });

  it('returns a typed list failure when collection loading throws', async () => {
    vi.mocked(firestoreDb.getDocs).mockRejectedValueOnce(new Error('boom'));

    const result = await getGlobalEmailRecipientListsWithResult();

    expect(result.status).toBe('failed');
    expect(result.data).toEqual([]);
  });

  it('reports a failed list load as a failure, and a denied one as degraded (not mailed)', async () => {
    vi.mocked(firestoreDb.getDocs).mockRejectedValueOnce(new Error('boom'));
    await getGlobalEmailRecipientListsWithResult();
    expect(vi.mocked(recordOperationalTelemetry).mock.calls.at(-1)?.[0]).toMatchObject({
      operation: 'get_global_email_recipient_lists',
      status: 'failed',
    });

    vi.mocked(firestoreDb.getDocs).mockRejectedValueOnce(
      Object.assign(new Error('Missing or insufficient permissions.'), {
        code: 'permission-denied',
      })
    );
    const denied = await getGlobalEmailRecipientListsWithResult();
    expect(denied.status).toBe('failed');
    expect(vi.mocked(recordOperationalTelemetry).mock.calls.at(-1)?.[0]).toMatchObject({
      operation: 'get_global_email_recipient_lists',
      status: 'degraded',
    });
  });

  it('returns a typed delete failure when deletion throws', async () => {
    vi.mocked(firestoreDb.deleteDoc).mockRejectedValueOnce(new Error('boom'));

    const result = await deleteGlobalEmailRecipientListWithResult('lista-1');

    expect(result.status).toBe('failed');
    expect(result.data.deleted).toBe(false);
  });

  it('throws userSafeMessage from the delete wrapper when deletion fails', async () => {
    vi.mocked(firestoreDb.deleteDoc).mockRejectedValueOnce(new Error('boom'));

    await expect(deleteGlobalEmailRecipientList('lista-1')).rejects.toThrow(
      'No se pudo eliminar la lista global de destinatarios.'
    );
  });

  it('subscribes to list collection updates', () => {
    const onUpdate = vi.fn();
    let capturedCallback: ((data: unknown[]) => void) | undefined;

    vi.mocked(firestoreDb.subscribeQuery).mockImplementation((_path, _options, callback) => {
      capturedCallback = callback as (data: unknown[]) => void;
      return vi.fn();
    });

    subscribeToGlobalEmailRecipientLists(onUpdate);
    capturedCallback?.([
      {
        id: 'lista-1',
        name: 'Lista 1',
        recipients: ['A@MAIL.COM'],
        updatedAt: '2026-03-02T10:00:00.000Z',
      },
    ]);

    expect(onUpdate).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'lista-1',
        recipients: ['a@mail.com'],
      }),
    ]);
  });
});
