import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    loadTableConfig,
    saveTableConfig,
    getDefaultConfig,
    DEFAULT_COLUMN_WIDTHS,
    DEFAULT_PAGE_MARGIN
} from '@/services/storage/tableConfigService';
import { getDoc, setDoc } from 'firebase/firestore';

vi.mock('firebase/firestore', async () => {
    const actual = await vi.importActual('firebase/firestore');
    return {
        ...actual,
        getDoc: vi.fn(),
        setDoc: vi.fn(),
        onSnapshot: vi.fn(),
        doc: vi.fn(() => ({ id: 'mock-doc' })),
        collection: vi.fn()
    };
});

describe('tableConfigService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    describe('getDefaultConfig', () => {
        it('should return default values', () => {
            const config = getDefaultConfig();
            expect(config.columns).toEqual(DEFAULT_COLUMN_WIDTHS);
            expect(config.pageMargin).toBe(DEFAULT_PAGE_MARGIN);
            expect(config.version).toBe(1);
        });
    });

    describe('loadTableConfig', () => {
        it('should return default config if document does not exist', async () => {
            vi.mocked(getDoc).mockResolvedValue({
                exists: () => false
            } as any);

            const config = await loadTableConfig();
            expect(config.columns).toEqual(DEFAULT_COLUMN_WIDTHS);
            expect(config.pageMargin).toBe(DEFAULT_PAGE_MARGIN);
        });

        it('should return merged config if document exists', async () => {
            const mockData = {
                columns: { bed: 100 },
                pageMargin: 20,
                version: 1
            };

            vi.mocked(getDoc).mockResolvedValue({
                exists: () => true,
                data: () => mockData
            } as any);

            const config = await loadTableConfig();
            expect(config.columns.bed).toBe(100);
            expect(config.columns.name).toBe(DEFAULT_COLUMN_WIDTHS.name); // from defaults
            expect(config.pageMargin).toBe(20);
        });

        it('should handle errors by returning default config', async () => {
            vi.mocked(getDoc).mockRejectedValue(new Error('Firestore error'));

            const config = await loadTableConfig();
            expect(config.columns).toEqual(DEFAULT_COLUMN_WIDTHS);
        });
    });

    describe('saveTableConfig', () => {
        it('should call setDoc with config and timestamp', async () => {
            const config = getDefaultConfig();
            await saveTableConfig(config);

            expect(setDoc).toHaveBeenCalled();
            const calledArg = vi.mocked(setDoc).mock.calls[0][1] as any;
            expect(calledArg).toMatchObject({
                columns: config.columns,
                pageMargin: config.pageMargin
            });
            expect(calledArg.lastUpdated).toBeDefined();
        });
    });

    describe('importTableConfig', () => {
        it('should parse valid JSON file and return config', async () => {
            const mockConfig = getDefaultConfig();
            const file = new File([JSON.stringify(mockConfig)], 'config.json', { type: 'application/json' });

            const mockConfigString = JSON.stringify(mockConfig);
            vi.stubGlobal('FileReader', class {
                readAsText = vi.fn(function (this: any) {
                    setTimeout(() => {
                        if (this.onload) this.onload({ target: { result: mockConfigString } });
                    }, 0);
                });
                onload: any = null;
                onerror: any = null;
            });

            const { importTableConfig } = await import('@/services/storage/tableConfigService');
            const result = await importTableConfig(file);

            expect(result.columns).toEqual(mockConfig.columns);
            expect(result.pageMargin).toBe(mockConfig.pageMargin);
        });

        it('should throw error for invalid JSON', async () => {
            const file = new File(['invalid'], 'config.json', { type: 'application/json' });

            vi.stubGlobal('FileReader', class {
                readAsText = vi.fn(function (this: any) {
                    setTimeout(() => {
                        if (this.onload) this.onload({ target: { result: 'invalid' } });
                    }, 0);
                });
                onload: any = null;
                onerror: any = null;
            });

            const { importTableConfig } = await import('@/services/storage/tableConfigService');
            await expect(importTableConfig(file)).rejects.toThrow('Invalid JSON file');
        });
    });
});
