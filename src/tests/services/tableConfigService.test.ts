import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadTableConfig,
  saveTableConfig,
  getDefaultConfig,
  DEFAULT_COLUMN_WIDTHS,
  DEFAULT_PAGE_MARGIN,
  CURRENT_TABLE_CONFIG_VERSION,
  cacheTableConfigLocally,
  getInitialTableConfig,
} from '@/services/storage/tableConfigService';
import { getDoc, setDoc } from 'firebase/firestore';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');
  return {
    ...actual,
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    onSnapshot: vi.fn(),
    doc: vi.fn(() => ({ id: 'mock-doc' })),
    collection: vi.fn(),
  };
});

describe('tableConfigService', () => {
  type FirestoreDocResult = Awaited<ReturnType<typeof getDoc>>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  describe('getDefaultConfig', () => {
    it('should return default values', () => {
      const config = getDefaultConfig();
      expect(config.columns).toEqual(DEFAULT_COLUMN_WIDTHS);
      expect(config.pageMargin).toBe(DEFAULT_PAGE_MARGIN);
      expect(config.version).toBe(CURRENT_TABLE_CONFIG_VERSION);
    });
  });

  describe('getInitialTableConfig', () => {
    it('hydrates the initial table config from the local last-known cache', () => {
      const cachedConfig = {
        ...getDefaultConfig(),
        columns: {
          ...DEFAULT_COLUMN_WIDTHS,
          name: 96,
          diagnosis: 118,
        },
        pageMargin: 18,
      };

      cacheTableConfigLocally(cachedConfig);

      const config = getInitialTableConfig();

      expect(config.columns.name).toBe(96);
      expect(config.columns.diagnosis).toBe(118);
      expect(config.pageMargin).toBe(18);
    });

    it('falls back to defaults when the local table config cache is invalid', () => {
      window.localStorage.setItem('hhr.tableConfig.lastKnown', '{invalid');

      const config = getInitialTableConfig();

      expect(config.columns).toEqual(DEFAULT_COLUMN_WIDTHS);
      expect(config.pageMargin).toBe(DEFAULT_PAGE_MARGIN);
    });
  });

  describe('loadTableConfig', () => {
    it('should return default config if document does not exist', async () => {
      vi.mocked(getDoc).mockResolvedValue({
        exists: () => false,
      } as unknown as FirestoreDocResult);

      const config = await loadTableConfig();
      expect(config.columns).toEqual(DEFAULT_COLUMN_WIDTHS);
      expect(config.pageMargin).toBe(DEFAULT_PAGE_MARGIN);
    });

    it('should return merged config if document exists', async () => {
      const mockData = {
        columns: { bed: 100, type: 54, upc: 52 },
        pageMargin: 20,
        version: 1,
      };

      vi.mocked(getDoc).mockResolvedValue({
        exists: () => true,
        data: () => mockData,
      } as unknown as FirestoreDocResult);

      const config = await loadTableConfig();
      expect(config.columns.bed).toBe(28);
      expect(config.columns.name).toBe(DEFAULT_COLUMN_WIDTHS.name); // from defaults
      expect(config.columns.type).toBe(28);
      expect(config.columns.upc).toBe(22);
      expect(config.pageMargin).toBe(20);
      expect(config.version).toBe(CURRENT_TABLE_CONFIG_VERSION);
    });

    it('should handle errors by returning default config', async () => {
      const consoleSpies = suppressConsole(['error']);
      vi.mocked(getDoc).mockRejectedValue(new Error('Firestore error'));

      try {
        const config = await loadTableConfig();
        expect(config.columns).toEqual(DEFAULT_COLUMN_WIDTHS);
      } finally {
        restoreConsole(consoleSpies);
      }
    });
  });

  describe('saveTableConfig', () => {
    it('should call setDoc with config and timestamp', async () => {
      const config = getDefaultConfig();
      await saveTableConfig(config);

      expect(setDoc).toHaveBeenCalled();
      const calledArg = vi.mocked(setDoc).mock.calls[0][1] as Record<string, unknown>;
      expect(calledArg).toMatchObject({
        columns: config.columns,
        pageMargin: config.pageMargin,
      });
      expect(calledArg.lastUpdated).toBeDefined();
    });
  });

  describe('importTableConfig', () => {
    it('should parse valid JSON file and return config', async () => {
      const mockConfig = getDefaultConfig();
      const file = new File([JSON.stringify(mockConfig)], 'config.json', {
        type: 'application/json',
      });

      const mockConfigString = JSON.stringify(mockConfig);
      vi.stubGlobal(
        'FileReader',
        class {
          onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
          onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

          readAsText = vi.fn(() => {
            this.onload?.({
              target: { result: mockConfigString } as EventTarget & FileReader,
            } as ProgressEvent<FileReader>);
          });
        }
      );

      const { importTableConfig } = await import('@/services/storage/tableConfigService');
      const result = await importTableConfig(file);

      expect(result.columns).toEqual(mockConfig.columns);
      expect(result.pageMargin).toBe(mockConfig.pageMargin);
    });

    it('should throw error for invalid JSON', async () => {
      const file = new File(['invalid'], 'config.json', { type: 'application/json' });

      vi.stubGlobal(
        'FileReader',
        class {
          onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
          onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

          readAsText = vi.fn(() => {
            this.onload?.({
              target: { result: 'invalid' } as EventTarget & FileReader,
            } as ProgressEvent<FileReader>);
          });
        }
      );

      const { importTableConfig } = await import('@/services/storage/tableConfigService');
      await expect(importTableConfig(file)).rejects.toThrow('Invalid JSON file');
    });
  });
});
