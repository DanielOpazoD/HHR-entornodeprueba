import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addClinicalDocumentIndicationCatalogItem,
  createClinicalDocumentIndicationsCatalogTab,
  deleteClinicalDocumentIndicationCatalogItem,
  deleteClinicalDocumentIndicationsCatalogTab,
  getDefaultClinicalDocumentIndicationsCatalog,
  renameClinicalDocumentIndicationsCatalogTab,
  reorderClinicalDocumentIndicationsCatalogTab,
  replaceClinicalDocumentIndicationsCatalog,
  subscribeToClinicalDocumentIndicationsCatalog,
  updateClinicalDocumentIndicationCatalogItem,
} from '@/features/clinical-documents/services/clinicalDocumentIndicationsCatalogService';
import { useClinicalDocumentIndicationsCatalog } from '@/features/clinical-documents/hooks/useClinicalDocumentIndicationsCatalog';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';

vi.mock('@/services/utils/loggerScope', async () => {
  const { createLoggerScopeMock } = await import('@/tests/utils/loggerScopeMock');
  return createLoggerScopeMock();
});

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

vi.mock(
  '@/features/clinical-documents/services/clinicalDocumentIndicationsCatalogService',
  async () => {
    const actual = await vi.importActual<
      typeof import('@/features/clinical-documents/services/clinicalDocumentIndicationsCatalogService')
    >('@/features/clinical-documents/services/clinicalDocumentIndicationsCatalogService');

    return {
      ...actual,
      subscribeToClinicalDocumentIndicationsCatalog: vi.fn(),
      createClinicalDocumentIndicationsCatalogTab: vi.fn(),
      renameClinicalDocumentIndicationsCatalogTab: vi.fn(),
      deleteClinicalDocumentIndicationsCatalogTab: vi.fn(),
      reorderClinicalDocumentIndicationsCatalogTab: vi.fn(),
      addClinicalDocumentIndicationCatalogItem: vi.fn(),
      updateClinicalDocumentIndicationCatalogItem: vi.fn(),
      deleteClinicalDocumentIndicationCatalogItem: vi.fn(),
      replaceClinicalDocumentIndicationsCatalog: vi.fn(),
    };
  }
);

describe('useClinicalDocumentIndicationsCatalog', () => {
  const unsubscribe = vi.fn();
  const defaultCatalog = getDefaultClinicalDocumentIndicationsCatalog();
  const user = {
    uid: 'specialist-uid',
    email: 'especialista@hospital.cl',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    unsubscribe.mockReset();
    vi.mocked(subscribeToClinicalDocumentIndicationsCatalog).mockReturnValue(unsubscribe);
    vi.mocked(createClinicalDocumentIndicationsCatalogTab).mockResolvedValue(defaultCatalog);
    vi.mocked(renameClinicalDocumentIndicationsCatalogTab).mockResolvedValue(defaultCatalog);
    vi.mocked(deleteClinicalDocumentIndicationsCatalogTab).mockResolvedValue(defaultCatalog);
    vi.mocked(reorderClinicalDocumentIndicationsCatalogTab).mockResolvedValue(defaultCatalog);
    vi.mocked(addClinicalDocumentIndicationCatalogItem).mockResolvedValue(defaultCatalog);
    vi.mocked(updateClinicalDocumentIndicationCatalogItem).mockResolvedValue(defaultCatalog);
    vi.mocked(deleteClinicalDocumentIndicationCatalogItem).mockResolvedValue(defaultCatalog);
    vi.mocked(replaceClinicalDocumentIndicationsCatalog).mockResolvedValue(defaultCatalog);
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
  });

  it('stays idle when the personal catalog is not active', () => {
    const { result } = renderHook(() =>
      useClinicalDocumentIndicationsCatalog({
        user,
        isActive: false,
        canEdit: true,
      })
    );

    expect(result.current.indicationsCatalog.tabs).toEqual([
      { id: 'general', label: 'General', items: [] },
    ]);
    expect(subscribeToClinicalDocumentIndicationsCatalog).not.toHaveBeenCalled();
  });

  it('subscribes to the current user settings document when active', async () => {
    renderHook(() =>
      useClinicalDocumentIndicationsCatalog({
        user,
        isActive: true,
        canEdit: true,
      })
    );

    await waitFor(() => {
      expect(subscribeToClinicalDocumentIndicationsCatalog).toHaveBeenCalledWith(
        expect.any(Function),
        user
      );
    });
  });

  it('delegates local fallback to the catalog subscription service when Firestore is disabled', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);

    const { result } = renderHook(() =>
      useClinicalDocumentIndicationsCatalog({
        user,
        isActive: true,
        canEdit: true,
      })
    );

    await waitFor(() => {
      expect(result.current.indicationsCatalog.tabs).toEqual([
        { id: 'general', label: 'General', items: [] },
      ]);
    });
    expect(subscribeToClinicalDocumentIndicationsCatalog).toHaveBeenCalledWith(
      expect.any(Function),
      user
    );
  });

  it('cleans up the personal subscription for read-only access', async () => {
    const { unmount } = renderHook(() =>
      useClinicalDocumentIndicationsCatalog({
        user,
        isActive: true,
        canEdit: false,
      })
    );

    await waitFor(() => {
      expect(subscribeToClinicalDocumentIndicationsCatalog).toHaveBeenCalled();
    });

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('runs tab and indication mutations without specialty ids', async () => {
    const addedCatalog = {
      ...defaultCatalog,
      activeTabId: 'general',
      tabs: [
        {
          id: 'general',
          label: 'General',
          items: [{ id: 'item-1', text: 'Nueva', source: 'custom' as const }],
        },
      ],
      items: [{ id: 'item-1', text: 'Nueva', source: 'custom' as const }],
      updatedAt: '2026-05-07T12:00:00.000Z',
    };
    const updatedCatalog = {
      ...addedCatalog,
      tabs: [
        {
          id: 'general',
          label: 'General',
          items: [{ id: 'item-1', text: 'Actualizada', source: 'custom' as const }],
        },
      ],
      items: [{ id: 'item-1', text: 'Actualizada', source: 'custom' as const }],
      updatedAt: '2026-05-07T12:10:00.000Z',
    };
    const deletedCatalog = {
      ...updatedCatalog,
      tabs: [{ id: 'general', label: 'General', items: [] }],
      items: [],
      updatedAt: '2026-05-07T12:20:00.000Z',
    };
    const importedCatalog = {
      ...deletedCatalog,
      tabs: [
        {
          id: 'general',
          label: 'General',
          items: [{ id: 'item-2', text: 'Importada', source: 'custom' as const }],
        },
      ],
      items: [{ id: 'item-2', text: 'Importada', source: 'custom' as const }],
      updatedAt: '2026-05-07T12:30:00.000Z',
    };
    const createdTabCatalog = {
      ...defaultCatalog,
      activeTabId: 'postop',
      tabs: [
        { id: 'general', label: 'General', items: [] },
        { id: 'postop', label: 'Post operatorio', items: [] },
      ],
    };

    vi.mocked(createClinicalDocumentIndicationsCatalogTab).mockResolvedValueOnce(createdTabCatalog);
    vi.mocked(renameClinicalDocumentIndicationsCatalogTab).mockResolvedValueOnce(createdTabCatalog);
    vi.mocked(reorderClinicalDocumentIndicationsCatalogTab).mockResolvedValueOnce(
      createdTabCatalog
    );
    vi.mocked(deleteClinicalDocumentIndicationsCatalogTab).mockResolvedValueOnce(defaultCatalog);
    vi.mocked(addClinicalDocumentIndicationCatalogItem).mockResolvedValueOnce(addedCatalog);
    vi.mocked(updateClinicalDocumentIndicationCatalogItem).mockResolvedValueOnce(updatedCatalog);
    vi.mocked(deleteClinicalDocumentIndicationCatalogItem).mockResolvedValueOnce(deletedCatalog);
    vi.mocked(replaceClinicalDocumentIndicationsCatalog).mockResolvedValueOnce(importedCatalog);

    const { result } = renderHook(() =>
      useClinicalDocumentIndicationsCatalog({
        user,
        isActive: true,
        canEdit: true,
      })
    );

    await act(async () => {
      await expect(result.current.createTab('Post operatorio')).resolves.toBe(true);
      await expect(result.current.renameTab('postop', 'Post alta')).resolves.toBe(true);
      await expect(result.current.reorderTab('postop', 'left')).resolves.toBe(true);
      await expect(result.current.deleteTab('postop')).resolves.toBe(true);
      await expect(result.current.addCustomIndication('general', 'Nueva')).resolves.toBe(true);
      await expect(
        result.current.updateIndication('general', 'item-1', 'Actualizada')
      ).resolves.toBe(true);
      await expect(result.current.deleteIndication('general', 'item-1')).resolves.toBe(true);
      await expect(result.current.importCatalog({ tabs: [] })).resolves.toBe(true);
    });

    expect(createClinicalDocumentIndicationsCatalogTab).toHaveBeenCalledWith({
      ...user,
      label: 'Post operatorio',
    });
    expect(renameClinicalDocumentIndicationsCatalogTab).toHaveBeenCalledWith({
      ...user,
      tabId: 'postop',
      label: 'Post alta',
    });
    expect(reorderClinicalDocumentIndicationsCatalogTab).toHaveBeenCalledWith({
      ...user,
      tabId: 'postop',
      direction: 'left',
    });
    expect(deleteClinicalDocumentIndicationsCatalogTab).toHaveBeenCalledWith({
      ...user,
      tabId: 'postop',
    });
    expect(addClinicalDocumentIndicationCatalogItem).toHaveBeenCalledWith({
      ...user,
      tabId: 'general',
      text: 'Nueva',
    });
    expect(updateClinicalDocumentIndicationCatalogItem).toHaveBeenCalledWith({
      ...user,
      tabId: 'general',
      itemId: 'item-1',
      text: 'Actualizada',
    });
    expect(deleteClinicalDocumentIndicationCatalogItem).toHaveBeenCalledWith({
      ...user,
      tabId: 'general',
      itemId: 'item-1',
    });
    expect(replaceClinicalDocumentIndicationsCatalog).toHaveBeenCalledWith({
      ...user,
      catalog: { tabs: [] },
    });
    expect(result.current.indicationsCatalog).toEqual(importedCatalog);
    expect(result.current.isSavingCustomIndication).toBe(false);
    expect(result.current.customIndicationError).toBeNull();
  });

  it('surfaces a user-safe error when a personal mutation fails', async () => {
    vi.mocked(addClinicalDocumentIndicationCatalogItem).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() =>
      useClinicalDocumentIndicationsCatalog({
        user,
        isActive: true,
        canEdit: true,
      })
    );

    await act(async () => {
      await expect(result.current.addCustomIndication('general', 'Nueva')).resolves.toBe(false);
    });

    expect(result.current.isSavingCustomIndication).toBe(false);
    expect(result.current.customIndicationError).toBe(
      'No se pudo guardar la indicación en Firebase.'
    );
  });
});
