import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/storage/firestore', () => ({
  firestoreDb: {
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    subscribeQuery: vi.fn(),
  },
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

import { firestoreDb } from '@/services/storage/firestore';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { ClinicalDocumentRepository } from '@/services/repositories/ClinicalDocumentRepository';

import { buildDoc } from './clinicalDocumentRepositoryFixture';

describe('ClinicalDocumentRepository local recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);
  });
  it('keeps failed local writes authoritative through reads, subscriptions and recovery', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);
    const episode = 'recovery__2026-03-01';
    const document = buildDoc('recovery', episode, '2026-03-05T10:00:00.000Z');
    const callback = vi.fn();
    const unsubscribe = ClinicalDocumentRepository.subscribeByEpisode(episode, callback, 'hhr');
    await ClinicalDocumentRepository.createDraft(document, 'hhr');
    const persist = vi.mocked(localStorage.setItem).getMockImplementation()!;
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    try {
      const edited = { ...document, title: 'Latest draft' };
      await ClinicalDocumentRepository.saveDraft(edited, 'hhr');
      await expect(ClinicalDocumentRepository.get(document.id, 'hhr')).resolves.toMatchObject({
        title: 'Latest draft',
      });
      expect(callback).toHaveBeenLastCalledWith([
        expect.objectContaining({ title: 'Latest draft' }),
      ]);
      await expect(ClinicalDocumentRepository.listByEpisodeKeys([episode], 'hhr')).resolves.toEqual(
        [expect.objectContaining({ title: 'Latest draft' })]
      );
      await ClinicalDocumentRepository.delete(document.id, 'hhr');
      await expect(ClinicalDocumentRepository.get(document.id, 'hhr')).resolves.toBeNull();
      expect(callback).toHaveBeenLastCalledWith([]);
      const fromOtherTab = JSON.parse(
        localStorage.getItem('hhr_clinical_documents_local_v1') || '{}'
      );
      fromOtherTab.hhr.other = { ...document, id: 'other', title: 'Other tab edit' };
      fromOtherTab.otherHospital = { separate: { ...document, id: 'separate' } };
      persist('hhr_clinical_documents_local_v1', JSON.stringify(fromOtherTab));
      await expect(ClinicalDocumentRepository.get('other', 'hhr')).resolves.toMatchObject({
        title: 'Other tab edit',
      });
      write.mockImplementation(persist);
      await ClinicalDocumentRepository.createDraft({ ...document, id: 'recovered' }, 'hhr');
      await expect(ClinicalDocumentRepository.get(document.id, 'hhr')).resolves.toBeNull();
      const stored = JSON.parse(localStorage.getItem('hhr_clinical_documents_local_v1') || '{}');
      expect(stored.hhr.recovery).toBeUndefined();
      expect(stored.hhr.recovered.id).toBe('recovered');
      expect(stored.hhr.other.title).toBe('Other tab edit');
      expect(stored.otherHospital.separate.id).toBe('separate');
      expect(firestoreDb.setDoc).not.toHaveBeenCalled();
    } finally {
      write.mockImplementation(persist);
      unsubscribe();
    }
  });

  it('retains the last readable local document when storage becomes inaccessible', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);
    const document = buildDoc('last-readable', 'read__2026-03-01', '2026-03-05T10:00:00.000Z');
    await ClinicalDocumentRepository.createDraft(document, 'hhr');
    await ClinicalDocumentRepository.get(document.id, 'hhr');
    const read = vi.mocked(localStorage.getItem).getMockImplementation()!;
    const storageRead = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });
    try {
      await expect(ClinicalDocumentRepository.get(document.id, 'hhr')).resolves.toMatchObject({
        id: document.id,
      });
      await ClinicalDocumentRepository.saveDraft({ ...document, title: 'Still writable' }, 'hhr');
    } finally {
      storageRead.mockImplementation(read);
    }
    await expect(ClinicalDocumentRepository.get(document.id, 'hhr')).resolves.toMatchObject({
      title: 'Still writable',
    });
  });

  it('retries a pending deletion when storage recovers without an unrelated write', async () => {
    const document = buildDoc('retry-delete', 'delete__2026-03-01', '2026-03-05T10:00:00.000Z');
    await ClinicalDocumentRepository.createDraft(document, 'hhr');
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
      throw new Error('quota');
    });
    await ClinicalDocumentRepository.delete(document.id, 'hhr');
    await expect(ClinicalDocumentRepository.get(document.id, 'hhr')).resolves.toBeNull();
    await ClinicalDocumentRepository.delete(document.id, 'hhr');
    expect(
      JSON.parse(localStorage.getItem('hhr_clinical_documents_local_v1') || '{}').hhr[document.id]
    ).toBeUndefined();
  });

  it('treats prototype-shaped hospital and document identifiers as ordinary keys', async () => {
    const document = buildDoc('__proto__', 'keys__2026-03-01', '2026-03-05T10:00:00.000Z');
    await ClinicalDocumentRepository.createDraft(document, '__proto__');
    await expect(ClinicalDocumentRepository.get(document.id, '__proto__')).resolves.toMatchObject({
      id: '__proto__',
    });
    expect(Object.prototype).not.toHaveProperty('episodeKey');
    await ClinicalDocumentRepository.delete(document.id, '__proto__');
    await expect(ClinicalDocumentRepository.get(document.id, '__proto__')).resolves.toBeNull();
  });
});
