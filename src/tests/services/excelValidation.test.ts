/**
 * Tests for Excel Validation Utilities
 */

import { describe, it, expect } from 'vitest';
import {
    validateExcelBuffer,
    validateExcelFilename,
    validateExcelExport,
    MIN_EXCEL_SIZE
} from '@/services/exporters/excelValidation';

describe('excelValidation', () => {
    describe('validateExcelBuffer', () => {
        it('should reject null buffer', () => {
            const result = validateExcelBuffer(null);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('nulo');
        });

        it('should reject undefined buffer', () => {
            const result = validateExcelBuffer(undefined);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('nulo');
        });

        it('should reject buffer that is too small', () => {
            const smallBuffer = new ArrayBuffer(100);
            const result = validateExcelBuffer(smallBuffer);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('pequeño');
        });

        it('should reject buffer without ZIP magic bytes', () => {
            // Create a buffer large enough but without ZIP signature
            const buffer = new ArrayBuffer(MIN_EXCEL_SIZE + 1000);
            const view = new Uint8Array(buffer);
            view[0] = 0x00; // Not 'P'
            view[1] = 0x00; // Not 'K'

            const result = validateExcelBuffer(buffer);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('ZIP');
        });

        it('should accept valid XLSX buffer', () => {
            // Create a buffer with ZIP signature (PK)
            const buffer = new ArrayBuffer(MIN_EXCEL_SIZE + 1000);
            const view = new Uint8Array(buffer);
            view[0] = 0x50; // 'P'
            view[1] = 0x4B; // 'K'

            const result = validateExcelBuffer(buffer);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should work with Uint8Array', () => {
            const array = new Uint8Array(MIN_EXCEL_SIZE + 1000);
            array[0] = 0x50; // 'P'
            array[1] = 0x4B; // 'K'

            const result = validateExcelBuffer(array);
            expect(result.valid).toBe(true);
        });
    });

    describe('validateExcelFilename', () => {
        it('should reject null filename', () => {
            const result = validateExcelFilename(null);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('inválido');
        });

        it('should reject empty filename', () => {
            const result = validateExcelFilename('');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('inválido');
        });

        it('should reject filename without .xlsx extension', () => {
            const result = validateExcelFilename('report.pdf');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('.xlsx');
        });

        it('should reject filename without extension', () => {
            const result = validateExcelFilename('report');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('.xlsx');
        });

        it('should accept filename with .xlsx extension', () => {
            const result = validateExcelFilename('Censo Diario - Diciembre 2025.xlsx');
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should accept .XLSX uppercase extension', () => {
            const result = validateExcelFilename('Report.XLSX');
            expect(result.valid).toBe(true);
        });
    });

    describe('validateExcelExport', () => {
        it('should reject invalid buffer', () => {
            const result = validateExcelExport(null, 'report.xlsx');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('nulo');
        });

        it('should reject invalid filename', () => {
            const buffer = new ArrayBuffer(MIN_EXCEL_SIZE + 1000);
            const view = new Uint8Array(buffer);
            view[0] = 0x50;
            view[1] = 0x4B;

            const result = validateExcelExport(buffer, 'report.pdf');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('.xlsx');
        });

        it('should accept valid buffer and filename', () => {
            const buffer = new ArrayBuffer(MIN_EXCEL_SIZE + 1000);
            const view = new Uint8Array(buffer);
            view[0] = 0x50;
            view[1] = 0x4B;

            const result = validateExcelExport(buffer, 'report.xlsx');
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });
    });
});
