// The nurse, TENS and professionals catalogs follow one read, save and subscription contract.
// The same synthetic matrix runs through each catalog so a fix applied to one cannot miss another.
vi.unmock('@/services/repositories/CatalogRepository');

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import * as catalogService from '@/services/storage/indexeddb/indexedDbCatalogService';
import * as firestoreService from '@/services/storage/firestore';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { CatalogConflictError } from '@/services/repositories/contracts/catalogChanges';
import {
  CatalogRemoteSyncError,
  isCatalogExampleList,
} from '@/services/repositories/contracts/catalogContracts';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';

vi.mock('@/services/storage/indexeddb/indexedDbCatalogService', () => ({
  getCatalog: vi.fn(),
  getCatalogValues: vi.fn(),
  cacheCatalogValues: vi.fn(),
}));
vi.mock('@/services/storage/firestore', () => ({
  getNurseCatalogFromFirestore: vi.fn(),
  saveNurseCatalogToFirestore: vi.fn(),
  subscribeToNurseCatalog: vi.fn(() => () => {}),
  getTensCatalogFromFirestore: vi.fn(),
  saveTensCatalogToFirestore: vi.fn(),
  subscribeToTensCatalog: vi.fn(() => () => {}),
  getProfessionalsCatalogFromFirestore: vi.fn(),
  saveProfessionalsCatalogToFirestore: vi.fn(),
  subscribeToProfessionalsCatalog: vi.fn(() => () => {}),
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

type Item = string | ProfessionalCatalogItem;
type Listener = (items: Item[]) => void | Promise<void>;

interface CatalogCase {
  key: 'nurses' | 'tens' | 'professionals';
  get: () => Promise<Item[]>;
  save: (items: Item[], base: Item[]) => Promise<Item[] | void>;
  subscribe: (callback: (items: Item[]) => void) => () => void;
  remoteGet: ReturnType<typeof vi.fn>;
  remoteSave: ReturnType<typeof vi.fn>;
  remoteSubscribe: ReturnType<typeof vi.fn>;
  readLocal: ReturnType<typeof vi.fn>;
  /** Raw stored text, then what the catalog makes of it. */
  raw: Item[];
  normalized: Item[];
  /** A server-merged list that differs from what was sent. */
  accepted: Item[];
  emptyFallback: (value: Item[]) => boolean;
}

const prof = (name: string): ProfessionalCatalogItem => ({
  name,
  phone: '1',
  specialty: 'Cirugía',
});

const cases: CatalogCase[] = [
  {
    key: 'nurses',
    get: () => CatalogRepository.getNurses(),
    save: (items, base) => CatalogRepository.saveNurses(items as string[], base as string[]),
    subscribe: cb => CatalogRepository.subscribeNurses(cb),
    remoteGet: vi.mocked(firestoreService.getNurseCatalogFromFirestore),
    remoteSave: vi.mocked(firestoreService.saveNurseCatalogToFirestore),
    remoteSubscribe: vi.mocked(firestoreService.subscribeToNurseCatalog),
    readLocal: vi.mocked(catalogService.getCatalog),
    raw: [' Ana Pérez ', 'Ana Pérez', ''],
    normalized: ['Ana Pérez'],
    accepted: ['Ana Pérez', 'Rosa Hito'],
    emptyFallback: value =>
      isCatalogExampleList(value) && value.join() === 'Enfermero/a 1,Enfermero/a 2',
  },
  {
    key: 'tens',
    get: () => CatalogRepository.getTens(),
    save: (items, base) => CatalogRepository.saveTens(items as string[], base as string[]),
    subscribe: cb => CatalogRepository.subscribeTens(cb),
    remoteGet: vi.mocked(firestoreService.getTensCatalogFromFirestore),
    remoteSave: vi.mocked(firestoreService.saveTensCatalogToFirestore),
    remoteSubscribe: vi.mocked(firestoreService.subscribeToTensCatalog),
    readLocal: vi.mocked(catalogService.getCatalog),
    raw: [' Luis Rapu ', 'Luis Rapu', ''],
    normalized: ['Luis Rapu'],
    accepted: ['Luis Rapu', 'Mario Pakarati'],
    emptyFallback: value => isCatalogExampleList(value) && value.join() === 'TENS 1,TENS 2,TENS 3',
  },
  {
    key: 'professionals',
    get: () => CatalogRepository.getProfessionals(),
    save: (items, base) =>
      CatalogRepository.saveProfessionals(
        items as ProfessionalCatalogItem[],
        base as ProfessionalCatalogItem[]
      ),
    subscribe: cb => CatalogRepository.subscribeProfessionals(cb),
    remoteGet: vi.mocked(firestoreService.getProfessionalsCatalogFromFirestore),
    remoteSave: vi.mocked(firestoreService.saveProfessionalsCatalogToFirestore),
    remoteSubscribe: vi.mocked(firestoreService.subscribeToProfessionalsCatalog),
    readLocal: vi.mocked(catalogService.getCatalogValues),
    raw: [
      { ...prof('Dra. Tepano'), name: ' Dra. Tepano ' },
      { name: '' } as ProfessionalCatalogItem,
    ],
    normalized: [prof('Dra. Tepano')],
    accepted: [prof('Dra. Tepano'), prof('Dr. Atan')],
    emptyFallback: value => Array.isArray(value) && value.length === 0,
  },
];

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe.each(cases)('staff catalog contract: $key', c => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
    vi.mocked(catalogService.getCatalog).mockResolvedValue([]);
    vi.mocked(catalogService.getCatalogValues).mockResolvedValue([]);
    vi.mocked(catalogService.cacheCatalogValues).mockResolvedValue(undefined);
    c.remoteGet.mockResolvedValue([]);
    c.remoteSubscribe.mockImplementation(() => () => {});
  });

  it('reads the local copy first without opening the remote one', async () => {
    c.readLocal.mockResolvedValue(c.normalized);
    await expect(c.get()).resolves.toEqual(c.normalized);
    expect(c.readLocal).toHaveBeenCalledWith(c.key);
    expect(c.remoteGet).not.toHaveBeenCalled();
  });

  it('keeps a remote list in the local copy when the local one is empty', async () => {
    c.remoteGet.mockResolvedValue(c.normalized);
    await expect(c.get()).resolves.toEqual(c.normalized);
    expect(catalogService.cacheCatalogValues).toHaveBeenCalledWith(c.key, c.normalized, true);
  });

  it('reports a failed remote read instead of an empty list', async () => {
    const failure = new Error('synthetic read failure');
    c.remoteGet.mockRejectedValue(failure);
    await expect(c.get()).rejects.toBe(failure);
  });

  it('offers its own fallback when every source is empty', async () => {
    expect(c.emptyFallback(await c.get())).toBe(true);
  });

  it('offers the same fallback without opening the remote copy when sync is off', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);
    expect(c.emptyFallback(await c.get())).toBe(true);
    expect(c.remoteGet).not.toHaveBeenCalled();
  });

  it('saves the normalized list remotely and keeps what the server accepted', async () => {
    const accepted = c.accepted;
    c.remoteSave.mockResolvedValue(accepted);
    await expect(c.save(c.raw, [])).resolves.toEqual(accepted);
    expect(c.remoteSave).toHaveBeenCalledWith(c.normalized, []);
    expect(catalogService.cacheCatalogValues).toHaveBeenCalledWith(c.key, accepted, true);
  });

  it('keeps the normalized list locally when the server returns nothing', async () => {
    c.remoteSave.mockResolvedValue(undefined);
    await expect(c.save(c.raw, [])).resolves.toBeUndefined();
    expect(catalogService.cacheCatalogValues).toHaveBeenCalledWith(c.key, c.normalized, true);
  });

  it('keeps the current server list locally and rethrows a conflict', async () => {
    const conflict = new CatalogConflictError(c.raw);
    c.remoteSave.mockRejectedValue(conflict);
    await expect(c.save(c.normalized, [])).rejects.toBe(conflict);
    expect(catalogService.cacheCatalogValues).toHaveBeenCalledTimes(1);
    expect(catalogService.cacheCatalogValues).toHaveBeenCalledWith(c.key, c.normalized, true);
  });

  it('turns any other failed write into a sync error without touching the local copy', async () => {
    const cause = new Error('synthetic write failure');
    c.remoteSave.mockRejectedValue(cause);
    const error = await c.save(c.normalized, []).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CatalogRemoteSyncError);
    expect(catalogService.cacheCatalogValues).not.toHaveBeenCalled();
  });

  it('refuses to save while sync is off, without writing anywhere', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);
    const error = await c.save(c.normalized, []).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CatalogRemoteSyncError);
    expect(c.remoteSave).not.toHaveBeenCalled();
    expect(catalogService.cacheCatalogValues).not.toHaveBeenCalled();
  });

  it('normalizes and keeps each remote snapshot before telling the screen', async () => {
    let listener: Listener | undefined;
    c.remoteSubscribe.mockImplementation((cb: Listener) => {
      listener = cb;
      return () => {};
    });
    const callback = vi.fn();
    c.subscribe(callback);
    await listener?.(c.raw);
    expect(catalogService.cacheCatalogValues).toHaveBeenCalledWith(c.key, c.normalized, true);
    expect(callback).toHaveBeenCalledWith(c.normalized);
  });

  it('reads the local copy once, normalized, when sync is off', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);
    c.readLocal.mockResolvedValue(c.raw);
    const callback = vi.fn();
    c.subscribe(callback);
    await flush();
    expect(c.remoteSubscribe).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(c.normalized);
  });

  it('stays silent after unsubscribing from the local copy', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);
    c.readLocal.mockResolvedValue(c.raw);
    const callback = vi.fn();
    c.subscribe(callback)();
    await flush();
    expect(callback).not.toHaveBeenCalled();
  });

  it('passes a failed local read to the error handler', async () => {
    vi.mocked(isFirestoreEnabled).mockReturnValue(false);
    const failure = new Error('synthetic local failure');
    c.readLocal.mockRejectedValue(failure);
    const onError = vi.fn();
    const subscribe = {
      nurses: CatalogRepository.subscribeNurses,
      tens: CatalogRepository.subscribeTens,
      professionals: CatalogRepository.subscribeProfessionals,
    }[c.key] as (cb: (items: Item[]) => void, onError: (error: unknown) => void) => () => void;
    subscribe(vi.fn(), onError);
    await flush();
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('rejects a callback that is not a function', () => {
    expect(() => c.subscribe('not a function' as unknown as () => void)).toThrow();
  });
});
