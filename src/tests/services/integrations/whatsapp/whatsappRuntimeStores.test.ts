import { beforeEach, describe, expect, it, vi } from 'vitest';

const collectionMock = vi.fn();
const docMock = vi.fn();
const getDocMock = vi.fn();
const setDocMock = vi.fn();
const addDocMock = vi.fn();
const onSnapshotMock = vi.fn();
const queryMock = vi.fn();
const orderByMock = vi.fn();
const limitMock = vi.fn();

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    collection: (...args: unknown[]) => collectionMock(...args),
    doc: (...args: unknown[]) => docMock(...args),
    getDoc: (...args: unknown[]) => getDocMock(...args),
    setDoc: (...args: unknown[]) => setDocMock(...args),
    addDoc: (...args: unknown[]) => addDocMock(...args),
    onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
    query: (...args: unknown[]) => queryMock(...args),
    orderBy: (...args: unknown[]) => orderByMock(...args),
    limit: (...args: unknown[]) => limitMock(...args),
  };
});

import { createWhatsAppShiftStore } from '@/services/integrations/whatsapp/whatsappShiftStore';
import {
  createWhatsAppTemplatesStore,
  getDefaultTemplates,
  WHATSAPP_TEMPLATES_READ_ERROR,
  WHATSAPP_TEMPLATES_SAVE_ERROR,
} from '@/services/integrations/whatsapp/whatsappTemplatesStore';
import {
  createWhatsAppConfigStore,
  WHATSAPP_CONFIG_READ_ERROR,
  WHATSAPP_CONFIG_SAVE_ERROR,
} from '@/services/integrations/whatsapp/whatsappConfigStore';
import { createWhatsAppLoggingStore } from '@/services/integrations/whatsapp/whatsappLogging';

describe('whatsapp runtime stores', () => {
  const runtime = {
    getDb: () => ({ name: 'custom-whatsapp-db' }) as never,
    ready: Promise.resolve(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    collectionMock.mockImplementation((...args: unknown[]) => ({ kind: 'collection', args }));
    docMock.mockImplementation((...args: unknown[]) => ({ kind: 'doc', args }));
    queryMock.mockImplementation((...args: unknown[]) => ({ kind: 'query', args }));
    orderByMock.mockImplementation((...args: unknown[]) => ({ kind: 'orderBy', args }));
    limitMock.mockImplementation((...args: unknown[]) => ({ kind: 'limit', args }));
    onSnapshotMock.mockReturnValue(() => undefined);
    setDocMock.mockResolvedValue(undefined);
    addDocMock.mockResolvedValue(undefined);
  });

  it('uses the injected runtime for shift subscriptions and saves', async () => {
    const shiftStore = createWhatsAppShiftStore(runtime);

    shiftStore.subscribeToCurrentShift(() => undefined);
    await shiftStore.saveManualShift('Envío turno del 01/03/2026 hasta el 07/03/2026');

    expect(collectionMock).toHaveBeenCalledWith(runtime.getDb(), 'shifts', 'weekly', 'data');
    expect(setDocMock).toHaveBeenCalled();
  });

  it('uses the injected runtime for template reads and writes', async () => {
    const templatesStore = createWhatsAppTemplatesStore(runtime);
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ templates: [{ id: 't1', name: 'Test', content: 'Body', type: 'custom' }] }),
    });

    const templates = await templatesStore.getMessageTemplates();
    await templatesStore.saveMessageTemplates(templates);

    expect(docMock).toHaveBeenCalledWith(runtime.getDb(), 'whatsapp', 'templates');
    expect(setDocMock).toHaveBeenCalled();
    expect(templates).toHaveLength(1);
  });

  it('uses the injected runtime for config reads and writes', async () => {
    const configStore = createWhatsAppConfigStore(runtime);
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ enabled: true, status: 'connected' }),
    });

    const config = await configStore.getWhatsAppConfig();
    await configStore.updateWhatsAppConfig({ enabled: false });

    expect(docMock).toHaveBeenCalledWith(runtime.getDb(), 'whatsapp', 'config');
    expect(setDocMock).toHaveBeenCalled();
    expect(config).toEqual({ enabled: true, status: 'connected' });
  });

  it('throws instead of handing out defaults when a template read fails', async () => {
    const templatesStore = createWhatsAppTemplatesStore(runtime);
    getDocMock.mockRejectedValue(new Error('permission-denied'));

    await expect(templatesStore.getMessageTemplates()).rejects.toThrow(
      WHATSAPP_TEMPLATES_READ_ERROR
    );
  });

  it('serves the default templates only when none were saved yet', async () => {
    const templatesStore = createWhatsAppTemplatesStore(runtime);
    getDocMock.mockResolvedValue({ exists: () => false });

    await expect(templatesStore.getMessageTemplates()).resolves.toEqual(getDefaultTemplates());
  });

  it('throws when a template or config save fails', async () => {
    setDocMock.mockRejectedValue(new Error('unavailable'));

    await expect(createWhatsAppTemplatesStore(runtime).saveMessageTemplates([])).rejects.toThrow(
      WHATSAPP_TEMPLATES_SAVE_ERROR
    );
    await expect(
      createWhatsAppConfigStore(runtime).updateWhatsAppConfig({ enabled: false })
    ).rejects.toThrow(WHATSAPP_CONFIG_SAVE_ERROR);
  });

  it('throws instead of handing out defaults when a config read fails', async () => {
    getDocMock.mockRejectedValue(new Error('permission-denied'));

    await expect(createWhatsAppConfigStore(runtime).getWhatsAppConfig()).rejects.toThrow(
      WHATSAPP_CONFIG_READ_ERROR
    );
  });

  it('uses the injected runtime for operation logs', async () => {
    const loggingStore = createWhatsAppLoggingStore(runtime);

    await loggingStore.logWhatsAppOperation({
      type: 'HANDOFF_SENT',
      method: 'MANUAL',
      success: true,
    });

    expect(collectionMock).toHaveBeenCalledWith(runtime.getDb(), 'whatsappLogs');
    expect(addDocMock).toHaveBeenCalled();
  });
});
