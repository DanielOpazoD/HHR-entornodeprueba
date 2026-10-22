import * as fs from 'node:fs';
import * as path from 'node:path';
import { vi } from 'vitest';

export const FIXED_ISO_TIMESTAMP = '2026-01-15T10:30:00.000Z';

export const readSource = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

vi.mock('file-saver', () => ({
  saveAs: vi.fn(),
}));

vi.mock('@/services/repositories/dailyRecordRepositoryReadService', () => ({
  getForDate: vi.fn(),
}));

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getAllRecords: vi.fn(),
}));
