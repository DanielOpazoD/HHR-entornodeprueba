import { expect, it, vi } from 'vitest';
import { ClinicalDocumentRepository } from '@/services/repositories/ClinicalDocumentRepository';
import { defaultClinicalDocumentPort } from '@/application/ports/clinicalDocumentPort';
vi.mock('@/services/repositories/ClinicalDocumentRepository', () => ({
  ClinicalDocumentRepository: { get: vi.fn(), listByEpisode: vi.fn() },
}));
it.each(['get', 'listByEpisode'] as const)(
  '%s preserves rejection and hospital identity',
  async method => {
    const error = new Error('synthetic read failure');
    vi.mocked(ClinicalDocumentRepository[method]).mockRejectedValueOnce(error);
    await expect(
      defaultClinicalDocumentPort[method]('synthetic-id', 'synthetic-hospital')
    ).rejects.toBe(error);
    expect(ClinicalDocumentRepository[method]).toHaveBeenCalledWith(
      'synthetic-id',
      'synthetic-hospital'
    );
  }
);
