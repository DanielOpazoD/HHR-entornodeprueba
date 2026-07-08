import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addClinicalDocumentIndicationCatalogItem,
  createClinicalDocumentIndicationsCatalogService,
  createClinicalDocumentIndicationsCatalogTab,
  deleteClinicalDocumentIndicationCatalogItem,
  deleteClinicalDocumentIndicationsCatalogTab,
  getDefaultClinicalDocumentIndicationsCatalog,
  normalizeClinicalDocumentIndicationsCatalog,
  renameClinicalDocumentIndicationsCatalogTab,
  reorderClinicalDocumentIndicationsCatalogTab,
  replaceClinicalDocumentIndicationsCatalog,
  subscribeToClinicalDocumentIndicationsCatalog,
  updateClinicalDocumentIndicationCatalogItem,
} from '@/features/clinical-documents/services/clinicalDocumentIndicationsCatalogService';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

const repository = {
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  subscribeDoc: vi.fn(),
};

describe('clinicalDocumentIndicationsCatalogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
  });

  it('starts every specialist with a General personal indications tab', () => {
    const catalog = getDefaultClinicalDocumentIndicationsCatalog('2026-05-07T12:00:00.000Z');

    expect(catalog.updatedAt).toBe('2026-05-07T12:00:00.000Z');
    expect(catalog.activeTabId).toBe('general');
    expect(catalog.tabs).toEqual([{ id: 'general', label: 'General', items: [] }]);
    expect(catalog.items).toEqual([]);
  });

  it('migrates a legacy flat personal list into the General tab', () => {
    const catalog = normalizeClinicalDocumentIndicationsCatalog(
      {
        uid: 'specialist-uid',
        email: 'especialista@hospital.cl',
        updatedAt: '2026-05-07T12:00:00.000Z',
        items: [
          { id: 'a', text: '  Control con equipo tratante  ', source: 'default' },
          { id: 'b', text: 'Control con equipo tratante', source: 'custom' },
          'Reposo relativo',
        ],
      },
      { uid: 'specialist-uid', email: 'especialista@hospital.cl' }
    );

    expect(catalog.activeTabId).toBe('general');
    expect(catalog.tabs).toEqual([
      {
        id: 'general',
        label: 'General',
        items: [
          expect.objectContaining({ id: 'a', text: 'Control con equipo tratante' }),
          expect.objectContaining({ text: 'Reposo relativo' }),
        ],
      },
    ]);
    expect(catalog.items).toEqual(catalog.tabs[0].items);
  });

  it('normalizes named personal tabs and keeps active tab valid', () => {
    const catalog = normalizeClinicalDocumentIndicationsCatalog(
      {
        activeTabId: 'postop',
        tabs: [
          {
            id: 'postop',
            label: '  Post operatorio  ',
            items: [{ id: 'a', text: 'Control herida', source: 'custom' }],
          },
          {
            id: 'farmacos',
            label: 'Fármacos',
            items: ['Paracetamol según dolor'],
          },
        ],
      },
      { uid: 'specialist-uid', email: 'especialista@hospital.cl' }
    );

    expect(catalog.activeTabId).toBe('postop');
    expect(catalog.tabs.map(tab => tab.label)).toEqual(['Post operatorio', 'Fármacos']);
    expect(catalog.items).toEqual([expect.objectContaining({ text: 'Control herida' })]);
  });

  it('persists a personal indication under the selected tab', async () => {
    repository.getDoc.mockResolvedValueOnce({
      clinicalDocumentIndicationsProfile: {
        uid: 'specialist-uid',
        email: 'especialista@hospital.cl',
        activeTabId: 'postop',
        tabs: [{ id: 'postop', label: 'Post operatorio', items: [] }],
      },
    });
    const service = createClinicalDocumentIndicationsCatalogService(repository);

    const catalog = await service.addItem({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      tabId: 'postop',
      text: 'Control en policlínico',
    });

    expect(repository.setDoc).toHaveBeenCalledWith(
      'userSettings',
      'specialist-uid',
      {
        clinicalDocumentIndicationsProfile: expect.objectContaining({
          uid: 'specialist-uid',
          email: 'especialista@hospital.cl',
          activeTabId: 'postop',
          tabs: [
            expect.objectContaining({
              id: 'postop',
              items: [
                expect.objectContaining({ text: 'Control en policlínico', source: 'custom' }),
              ],
            }),
          ],
        }),
      },
      { merge: true }
    );
    expect(catalog.tabs[0].items).toEqual([
      expect.objectContaining({ text: 'Control en policlínico', source: 'custom' }),
    ]);
  });

  it('does not persist no-op catalog mutations', async () => {
    repository.getDoc.mockResolvedValue({
      clinicalDocumentIndicationsProfile: {
        uid: 'specialist-uid',
        email: 'especialista@hospital.cl',
        activeTabId: 'postop',
        tabs: [
          {
            id: 'postop',
            label: 'Post operatorio',
            items: [{ id: 'item-a', text: 'Control en policlínico', source: 'custom' }],
          },
        ],
      },
    });
    const service = createClinicalDocumentIndicationsCatalogService(repository);

    await service.createTab({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      label: '   ',
    });
    await service.addItem({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      tabId: 'postop',
      text: 'Control   en policlínico',
    });

    expect(repository.setDoc).not.toHaveBeenCalled();
  });

  it('creates, renames, deletes and reorders personal tabs', async () => {
    repository.getDoc.mockResolvedValue({
      clinicalDocumentIndicationsProfile: {
        uid: 'specialist-uid',
        email: 'especialista@hospital.cl',
        activeTabId: 'general',
        tabs: [
          { id: 'general', label: 'General', items: [] },
          { id: 'farmacos', label: 'Fármacos', items: [] },
        ],
      },
    });
    const service = createClinicalDocumentIndicationsCatalogService(repository);

    const created = await service.createTab({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      label: 'Post operatorio',
    });
    expect(created.tabs.map(tab => tab.label)).toContain('Post operatorio');

    const renamed = await service.renameTab({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      tabId: 'farmacos',
      label: 'Medicamentos',
    });
    expect(renamed.tabs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'farmacos', label: 'Medicamentos' })])
    );

    const reordered = await service.reorderTab({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      tabId: 'farmacos',
      direction: 'left',
    });
    expect(reordered.tabs.map(tab => tab.id)).toEqual(['farmacos', 'general']);

    const deleted = await service.deleteTab({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      tabId: 'farmacos',
    });
    expect(deleted.tabs.map(tab => tab.id)).toEqual(['general']);
  });

  it('updates and deletes personal indications within a tab', async () => {
    repository.getDoc.mockResolvedValue({
      clinicalDocumentIndicationsProfile: {
        uid: 'specialist-uid',
        email: 'especialista@hospital.cl',
        activeTabId: 'postop',
        tabs: [
          {
            id: 'postop',
            label: 'Post operatorio',
            items: [
              { id: 'item-a', text: 'Control original', source: 'custom' },
              { id: 'item-b', text: 'Curación diaria', source: 'custom' },
            ],
          },
        ],
      },
    });
    const service = createClinicalDocumentIndicationsCatalogService(repository);

    const updated = await service.updateItem({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      tabId: 'postop',
      itemId: 'item-a',
      text: 'Control actualizado',
    });
    expect(updated.tabs[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'item-a', text: 'Control actualizado' }),
      ])
    );

    const deleted = await service.deleteItem({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      tabId: 'postop',
      itemId: 'item-b',
    });
    expect(deleted.tabs[0].items.some(item => item.id === 'item-b')).toBe(false);
  });

  it('subscribes only to the current user settings document', () => {
    const unsubscribe = vi.fn();
    const callback = vi.fn();
    repository.subscribeDoc.mockImplementationOnce((_collection, _id, onData) => {
      onData({
        clinicalDocumentIndicationsProfile: {
          uid: 'specialist-uid',
          email: 'especialista@hospital.cl',
          tabs: [
            {
              id: 'general',
              label: 'General',
              items: [{ id: 'item-a', text: 'Alta con analgesia', source: 'custom' }],
            },
          ],
        },
      });
      return unsubscribe;
    });
    const service = createClinicalDocumentIndicationsCatalogService(repository);

    const returnedUnsubscribe = service.subscribe(callback, {
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
    });

    expect(repository.subscribeDoc).toHaveBeenCalledWith(
      'userSettings',
      'specialist-uid',
      expect.any(Function)
    );
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'specialist-uid',
        tabs: [
          expect.objectContaining({
            items: [expect.objectContaining({ text: 'Alta con analgesia' })],
          }),
        ],
      })
    );
    returnedUnsubscribe();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the public helpers scoped by uid instead of hospital specialty', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);

    await createClinicalDocumentIndicationsCatalogTab({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      label: 'Post operatorio',
    });
    await renameClinicalDocumentIndicationsCatalogTab({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      tabId: 'general',
      label: 'General actualizado',
    });
    await reorderClinicalDocumentIndicationsCatalogTab({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      tabId: 'general',
      direction: 'right',
    });
    await deleteClinicalDocumentIndicationsCatalogTab({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      tabId: 'general',
    });
    await addClinicalDocumentIndicationCatalogItem({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      tabId: 'general',
      text: 'Control por medicina interna',
    });
    await updateClinicalDocumentIndicationCatalogItem({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      tabId: 'general',
      itemId: 'item-a',
      text: 'Control actualizado',
    });
    await deleteClinicalDocumentIndicationCatalogItem({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      tabId: 'general',
      itemId: 'item-a',
    });
    await replaceClinicalDocumentIndicationsCatalog({
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
      catalog: { tabs: [{ id: 'general', label: 'General', items: [] }] },
    });

    const unsubscribe = subscribeToClinicalDocumentIndicationsCatalog(vi.fn(), {
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
    });
    unsubscribe();
  });
});
