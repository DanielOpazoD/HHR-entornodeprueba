import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockSearchPatients = vi.fn();

vi.mock('@/services/repositories/PatientMasterRepository', () => ({
  searchPatients: (...args: unknown[]) => mockSearchPatients(...args),
}));

import { searchMasterPatients } from '@/application/census/searchMasterPatientsUseCase';

describe('searchMasterPatientsUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a successful outcome with empty data for whitespace-only queries without calling the repository', async () => {
    const outcome = await searchMasterPatients('   ');
    expect(outcome.status).toBe('success');
    expect(outcome.data).toEqual([]);
    expect(mockSearchPatients).not.toHaveBeenCalled();
  });

  it('forwards a trimmed query and explicit limit to the repository and wraps results in a successful outcome', async () => {
    mockSearchPatients.mockResolvedValueOnce([
      { rut: '1-9', fullName: 'Paciente', createdAt: 1, updatedAt: 1 },
    ]);

    const outcome = await searchMasterPatients('  isut litus  ', 25);

    expect(outcome.status).toBe('success');
    expect(outcome.data).toEqual([
      { rut: '1-9', fullName: 'Paciente', createdAt: 1, updatedAt: 1 },
    ]);
    expect(mockSearchPatients).toHaveBeenCalledWith('isut litus', 25);
  });

  it('uses the default limit when no limit is provided', async () => {
    mockSearchPatients.mockResolvedValueOnce([]);

    const outcome = await searchMasterPatients('isut');

    expect(outcome.status).toBe('success');
    expect(outcome.data).toEqual([]);
    expect(mockSearchPatients).toHaveBeenCalledWith('isut', 20);
  });

  it('clamps out-of-range limit values before querying the repository', async () => {
    mockSearchPatients.mockResolvedValueOnce([]);

    await searchMasterPatients('isut', 9999);
    expect(mockSearchPatients).toHaveBeenCalledWith('isut', 100);
  });

  it('returns a validation failure when the search query exceeds maximum length', async () => {
    const tooLongQuery = 'x'.repeat(121);

    const outcome = await searchMasterPatients(tooLongQuery);

    expect(outcome.status).toBe('failed');
    expect(outcome.issues[0]).toEqual(
      expect.objectContaining({
        kind: 'validation',
        code: 'census/master-patient-search-invalid-query',
      })
    );
    expect(mockSearchPatients).not.toHaveBeenCalled();
  });

  it('returns a failed outcome with user-safe messaging when repository search fails', async () => {
    mockSearchPatients.mockRejectedValueOnce(new Error('firestore unavailable'));

    const outcome = await searchMasterPatients('isut');

    expect(outcome.status).toBe('failed');
    expect(outcome.data).toEqual([]);
    expect(outcome.retryable).toBe(true);
    expect(outcome.issues[0]).toEqual(
      expect.objectContaining({
        kind: 'unknown',
        code: 'census/master-patient-search-failed',
      })
    );
  });
});
