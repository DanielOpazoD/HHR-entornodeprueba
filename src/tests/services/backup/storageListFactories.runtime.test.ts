// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const listAllMock = vi.fn();

vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage: unknown, path: string) => ({ fullPath: path })),
  listAll: (...args: unknown[]) => listAllMock(...args),
  getMetadata: vi.fn(),
  getDownloadURL: vi.fn(),
}));

import { createListMonths, createListYears } from '@/services/backup/storageListFactories';

describe('storageListFactories runtime injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists years through an injected storage runtime', async () => {
    listAllMock.mockResolvedValue({
      prefixes: [{ name: '2026' }, { name: '2025' }],
    });

    const listYears = createListYears('entregas-enfermeria');
    await expect(
      listYears({
        ready: Promise.resolve(),
        getStorage: vi.fn().mockResolvedValue({ custom: true } as never),
      })
    ).resolves.toEqual(['2026', '2025']);
  });

  it('lists months through an injected storage runtime', async () => {
    listAllMock.mockResolvedValue({
      prefixes: [{ name: '02' }, { name: '01' }],
    });

    const listMonths = createListMonths('entregas-enfermeria');
    await expect(
      listMonths('2026', {
        ready: Promise.resolve(),
        getStorage: vi.fn().mockResolvedValue({ custom: true } as never),
      })
    ).resolves.toEqual([
      { number: '02', name: 'Febrero' },
      { number: '01', name: 'Enero' },
    ]);
  });
});
