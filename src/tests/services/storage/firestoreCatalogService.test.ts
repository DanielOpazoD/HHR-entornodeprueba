import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

const { mockGetDb, runtimeReady } = vi.hoisted(() => ({
  mockGetDb: vi.fn(() => ({ runtime: 'db' })),
  runtimeReady: Promise.resolve(),
}));

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');
  return {
    ...actual,
    doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
    getDoc: vi.fn(),
    onSnapshot: vi.fn(),
    setDoc: vi.fn(),
  };
});

vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: {
    getDb: mockGetDb,
    ready: runtimeReady,
  },
}));

vi.mock('@/constants/firestorePaths', () => ({
  COLLECTIONS: {
    HOSPITALS: 'hospitals',
  },
  HOSPITAL_COLLECTIONS: {
    SETTINGS: 'settings',
  },
  SETTINGS_DOCS: {
    NURSES: 'nurses_catalog',
    TENS: 'tens_catalog',
  },
  getActiveHospitalId: vi.fn(() => 'hanga_roa'),
}));

vi.mock('@/services/storage/firestore/firestoreShared', () => ({
  readStringCatalogFromSnapshot: vi.fn(
    (
      docSnap: { exists: () => boolean; data: () => Record<string, unknown> | undefined },
      legacyField: 'nurses' | 'tens'
    ) => {
      if (!docSnap.exists()) return [];
      const data = docSnap.data() || {};
      return (data.list as string[]) || (data[legacyField] as string[]) || [];
    }
  ),
}));

vi.mock('@/services/repositories/contracts/catalogContracts', () => ({
  normalizeProfessionalCatalog: vi.fn((items: unknown) => items ?? []),
  normalizeStringCatalog: vi.fn((values: string[]) =>
    values.map(value => value.trim()).filter(Boolean)
  ),
}));

import { getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import {
  getNurseCatalogFromFirestore,
  getProfessionalsCatalogFromFirestore,
  getTensCatalogFromFirestore,
  saveNurseCatalogToFirestore,
  saveProfessionalsCatalogToFirestore,
  saveTensCatalogToFirestore,
  subscribeToNurseCatalog,
  subscribeToProfessionalsCatalog,
  subscribeToTensCatalog,
} from '@/services/storage/firestore/firestoreCatalogService';

describe('firestoreCatalogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gets nurse and tens catalogs, propagating read errors', async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ list: ['Nurse A'] }),
    } as never);
    await expect(getNurseCatalogFromFirestore()).resolves.toEqual(['Nurse A']);

    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ tens: ['TENS A'] }),
    } as never);
    await expect(getTensCatalogFromFirestore()).resolves.toEqual(['TENS A']);

    vi.mocked(getDoc).mockRejectedValueOnce(new Error('offline'));
    await expect(getNurseCatalogFromFirestore()).rejects.toThrow('offline');

    expect(mockGetDb).toHaveBeenCalled();
  });

  it('saves normalized nurse, tens and professional catalogs', async () => {
    await saveNurseCatalogToFirestore([' Nurse A ', '']);
    expect(vi.mocked(setDoc).mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        list: ['Nurse A'],
        nurses: ['Nurse A'],
      })
    );

    await saveTensCatalogToFirestore([' TENS A ']);
    expect(vi.mocked(setDoc).mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        list: ['TENS A'],
        tens: ['TENS A'],
      })
    );

    await saveProfessionalsCatalogToFirestore([{ name: 'Dr. A', specialty: 'Medicina' }] as never);
    expect(vi.mocked(setDoc).mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        list: [{ name: 'Dr. A', specialty: 'Medicina' }],
      })
    );
  });

  it('gets and subscribes professionals catalog, including empty/error states', async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ list: [{ name: 'Dr. A' }] }),
    } as never);
    await expect(getProfessionalsCatalogFromFirestore()).resolves.toEqual([{ name: 'Dr. A' }]);

    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => false,
      data: () => undefined,
    } as never);
    await expect(getProfessionalsCatalogFromFirestore()).resolves.toEqual([]);

    const nurseCallback = vi.fn();
    vi.mocked(onSnapshot).mockImplementationOnce((...args: unknown[]) => {
      const onNext = args[1] as (snapshot: unknown) => void;
      onNext({ exists: () => true, data: () => ({ list: ['Nurse A'] }) });
      return vi.fn();
    });
    subscribeToNurseCatalog(nurseCallback);
    await waitFor(() => {
      expect(nurseCallback).toHaveBeenCalledWith(['Nurse A']);
    });

    const tensCallback = vi.fn();
    const tensError = vi.fn();
    vi.mocked(onSnapshot).mockImplementationOnce((...args: unknown[]) => {
      const onError = args[2] as (error: unknown) => void;
      onError(new Error('boom'));
      return vi.fn();
    });
    subscribeToTensCatalog(tensCallback, tensError);
    await waitFor(() => {
      expect(tensError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
      expect(tensCallback).not.toHaveBeenCalled();
    });

    const professionalsCallback = vi.fn();
    vi.mocked(onSnapshot).mockImplementationOnce((...args: unknown[]) => {
      const onNext = args[1] as (snapshot: unknown) => void;
      onNext({ exists: () => true, data: () => ({ list: [{ name: 'Dr. B' }] }) });
      return vi.fn();
    });
    subscribeToProfessionalsCatalog(professionalsCallback);
    await waitFor(() => {
      expect(professionalsCallback).toHaveBeenCalledWith([{ name: 'Dr. B' }]);
    });

    expect(mockGetDb).toHaveBeenCalled();
  });
});

it.each([
  getNurseCatalogFromFirestore,
  getTensCatalogFromFirestore,
  getProfessionalsCatalogFromFirestore,
])('propagates point read failures and preserves genuine absence', async read => {
  vi.mocked(getDoc).mockRejectedValueOnce(new Error('synthetic read failure'));
  await expect(read()).rejects.toThrow('synthetic read failure');
  vi.mocked(getDoc).mockResolvedValueOnce({ exists: () => false, data: () => undefined } as never);
  await expect(read()).resolves.toEqual([]);
});
