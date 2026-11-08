import { beforeEach, describe, expect, it, vi } from 'vitest';

const setDoc = vi.fn();
const getDoc = vi.fn();
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, path: string, id: string) => `${path}/${id}`),
  setDoc: (...args: unknown[]) => setDoc(...args),
  getDoc: (...args: unknown[]) => getDoc(...args),
}));

vi.mock('@/constants/firestorePaths', () => ({
  getLabResultsPath: () => 'hospitals/test/labResults',
}));

vi.mock('@/services/repositories/repositoryFirestoreRuntime', () => ({
  defaultRepositoryFirestoreRuntime: {
    getDb: () => ({ id: 'db' }),
  },
}));

vi.mock('@/services/utils/loggerScope', async () => {
  const { createLoggerScopeMock } = await import('@/tests/utils/loggerScopeMock');
  return createLoggerScopeMock(loggerMocks);
});

import { getLabResults, saveLabResults } from '@/features/laboratory/services/labFirestoreService';
import type { SyslabExamDetail, SyslabExamItem } from '@/types/domain/labExamTypes';

describe('labFirestoreService', () => {
  const exams: SyslabExamItem[] = [
    {
      id: '43091921',
      link: 'http://10.4.69.90/syslab/detalleexamenes.php?id=43091921',
      date: '19/04/2026',
      time: '20:30:45',
      patientName: 'RAUL ARAKI',
      origin: 'HOSPITALIZADO',
      exams: ['QUIMICA/ORINA'],
    },
  ];

  const details: SyslabExamDetail[] = [
    {
      url: exams[0].link!,
      findings: [
        {
          section: 'QUIMICA/ORINA',
          analysis: 'Rel. Proteinuria/Creatininuria',
          result: '136,2',
          unit: '',
          refValue: '< 200,0',
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    setDoc.mockResolvedValue(undefined);
  });

  it('rejects a failed read instead of reporting a missing document', async () => {
    const error = new Error('cache unavailable');
    getDoc.mockRejectedValueOnce(error);
    await expect(getLabResults('11.111.111-1')).rejects.toBe(error);
  });

  it('returns null only for a successfully read missing document', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(getLabResults('11.111.111-1')).resolves.toBeNull();
  });

  it('rejects an invalid document instead of reporting no exams', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({}) });
    await expect(getLabResults('11.111.111-1')).rejects.toThrow('Invalid lab results document');
  });

  it('downgrades permission-denied cache writes to a warning', async () => {
    setDoc.mockRejectedValue({ code: 'permission-denied' });

    await saveLabResults('9.376.707-1', 'Raul Araki', details, exams);

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Lab results persisted only in memory because Firestore rejected the cache write',
      expect.objectContaining({
        code: 'permission-denied',
        rut: '9376707-1',
      })
    );
    expect(loggerMocks.error).not.toHaveBeenCalledWith(
      'Failed to save lab results to Firestore',
      expect.anything()
    );
  });
});
