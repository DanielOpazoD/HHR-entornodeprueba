import { describe, it, expect, vi } from 'vitest';
import { createWorkbook, BORDER_THIN, HEADER_FILL } from '@/services/exporters/excelUtils';

// Mock ExcelJS
vi.mock('exceljs', () => ({
  Workbook: class MockWorkbook {
    xlsx = { writeBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)) };
  },
}));

vi.mock('exceljs/dist/exceljs.min.js', () => ({
  Workbook: class MockWorkbook {
    xlsx = { writeBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)) };
  },
}));

describe('excelUtils', () => {
  describe('createWorkbook', () => {
    it('should create a new workbook', async () => {
      const workbook = await createWorkbook();
      expect(workbook).toBeDefined();
    });
  });

  describe('constants', () => {
    it('should export BORDER_THIN constant', () => {
      expect(BORDER_THIN).toBeDefined();
      expect(BORDER_THIN.top.style).toBe('thin');
    });

    it('should export HEADER_FILL constant', () => {
      expect(HEADER_FILL).toBeDefined();
      expect(HEADER_FILL.type).toBe('pattern');
    });
  });
});
