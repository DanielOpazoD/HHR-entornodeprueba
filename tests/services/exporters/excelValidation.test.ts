import { describe, it, expect } from 'vitest';
import {
    validateExcelBuffer,
    validateExcelFilename,
    validateExcelExport,
    MIN_EXCEL_SIZE
} from '@/services/exporters/excelValidation';

describe('excelValidation', () => {
    describe('validateExcelBuffer', () => {
        it('should return invalid for null/undefined buffer', () => {
            expect(validateExcelBuffer(null)).toEqual({
                valid: false,
                error: 'El buffer del archivo es nulo o indefinido.'
            });
            expect(validateExcelBuffer(undefined)).toEqual({
                valid: false,
                error: 'El buffer del archivo es nulo o indefinido.'
            });
        });

        it('should return invalid for small buffer', () => {
            const buffer = new Uint8Array(100);
            const result = validateExcelBuffer(buffer);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('muy pequeño');
        });

        it('should return invalid for non-ZIP buffer', () => {
            const buffer = new Uint8Array(MIN_EXCEL_SIZE);
            buffer.set([0x00, 0x01, 0x02, 0x03], 0);
            const result = validateExcelBuffer(buffer);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('no es un archivo ZIP válido');
        });

        it('should return valid for correct ZIP magic bytes', () => {
            const buffer = new Uint8Array(MIN_EXCEL_SIZE);
            buffer.set([0x50, 0x4B, 0x03, 0x04], 0); // PK bytes
            const result = validateExcelBuffer(buffer);
            expect(result.valid).toBe(true);
        });

        it('should handle ArrayBuffer and Buffer types', () => {
            // ArrayBuffer
            const arrBuffer = new ArrayBuffer(MIN_EXCEL_SIZE);
            const view = new Uint8Array(arrBuffer);
            view.set([0x50, 0x4B, 0x03, 0x04], 0);
            expect(validateExcelBuffer(arrBuffer).valid).toBe(true);

            // Node.js Buffer
            const nodeBuffer = Buffer.alloc(MIN_EXCEL_SIZE);
            nodeBuffer.set([0x50, 0x4B, 0x03, 0x04], 0);
            expect(validateExcelBuffer(nodeBuffer).valid).toBe(true);
        });
    });

    describe('validateExcelFilename', () => {
        it('should return invalid for empty or non-string filename', () => {
            expect(validateExcelFilename(null as any).valid).toBe(false);
            expect(validateExcelFilename('').valid).toBe(false);
            expect(validateExcelFilename('   ').valid).toBe(false);
        });

        it('should return invalid for wrong extension', () => {
            expect(validateExcelFilename('report.pdf').valid).toBe(false);
            expect(validateExcelFilename('report.csv').valid).toBe(false);
        });

        it('should return valid for .xlsx extension', () => {
            expect(validateExcelFilename('report.xlsx').valid).toBe(true);
            expect(validateExcelFilename('REPORT.XLSX').valid).toBe(true);
        });
    });

    describe('validateExcelExport', () => {
        it('should validate both buffer and filename', () => {
            const buffer = new Uint8Array(MIN_EXCEL_SIZE);
            buffer.set([0x50, 0x4B, 0x03, 0x04], 0);

            // Valid
            expect(validateExcelExport(buffer, 'test.xlsx').valid).toBe(true);

            // Invalid buffer
            expect(validateExcelExport(new Uint8Array(0), 'test.xlsx').valid).toBe(false);

            // Invalid filename
            expect(validateExcelExport(buffer, 'test.txt').valid).toBe(false);
        });
    });
});
