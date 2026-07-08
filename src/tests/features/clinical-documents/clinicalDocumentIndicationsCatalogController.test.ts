import { describe, expect, it } from 'vitest';

import {
  applyClinicalDocumentIndicationsAddItem,
  applyClinicalDocumentIndicationsCreateTab,
  applyClinicalDocumentIndicationsDeleteItem,
  applyClinicalDocumentIndicationsDeleteTab,
  applyClinicalDocumentIndicationsRenameTab,
  applyClinicalDocumentIndicationsUpdateItem,
  getDefaultClinicalDocumentIndicationsCatalog,
} from '@/features/clinical-documents/controllers/clinicalDocumentIndicationsCatalogController';

describe('clinicalDocumentIndicationsCatalogController', () => {
  it('documents the personal indications action flow without persistence concerns', () => {
    const started = getDefaultClinicalDocumentIndicationsCatalog('2026-05-08T10:00:00.000Z', {
      uid: 'specialist-uid',
      email: 'especialista@hospital.cl',
    });

    const withPostopTab = applyClinicalDocumentIndicationsCreateTab(started, '  Post operatorio  ');
    expect(withPostopTab.activeTabId).toBe('post-operatorio');
    expect(withPostopTab.items).toEqual([]);

    const withItem = applyClinicalDocumentIndicationsAddItem(withPostopTab, {
      tabId: 'post-operatorio',
      text: '  Control en policlínico  ',
      now: '2026-05-08T10:01:00.000Z',
      idSuffix: 'abc123',
    });
    expect(withItem.items).toEqual([
      expect.objectContaining({
        id: 'custom-control-en-policlinico-abc123',
        text: 'Control en policlínico',
        source: 'custom',
        createdAt: '2026-05-08T10:01:00.000Z',
      }),
    ]);

    const duplicateIgnored = applyClinicalDocumentIndicationsAddItem(withItem, {
      tabId: 'post-operatorio',
      text: 'Control   en policlínico',
      now: '2026-05-08T10:02:00.000Z',
      idSuffix: 'def456',
    });
    expect(duplicateIgnored.tabs).toEqual(withItem.tabs);

    const renamed = applyClinicalDocumentIndicationsRenameTab(
      duplicateIgnored,
      'post-operatorio',
      'Post alta'
    );
    expect(renamed.tabs.find(tab => tab.id === 'post-operatorio')?.label).toBe('Post alta');

    const updated = applyClinicalDocumentIndicationsUpdateItem(renamed, {
      tabId: 'post-operatorio',
      itemId: 'custom-control-en-policlinico-abc123',
      text: 'Control por medicina interna',
    });
    expect(updated.items).toEqual([
      expect.objectContaining({ text: 'Control por medicina interna' }),
    ]);

    const itemDeleted = applyClinicalDocumentIndicationsDeleteItem(updated, {
      tabId: 'post-operatorio',
      itemId: 'custom-control-en-policlinico-abc123',
    });
    expect(itemDeleted.items).toEqual([]);

    const tabDeleted = applyClinicalDocumentIndicationsDeleteTab(itemDeleted, 'post-operatorio');
    expect(tabDeleted.activeTabId).toBe('general');
    expect(tabDeleted.tabs.map(tab => tab.id)).toEqual(['general']);
    expect(tabDeleted.items).toEqual([]);
  });
});
