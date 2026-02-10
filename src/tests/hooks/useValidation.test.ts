import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useValidation } from '@/hooks/useValidation';
import { DailyRecord, PatientData } from '@/types';

describe('useValidation', () => {
    const mockRecord: Partial<DailyRecord> = {
        date: '2024-12-28',
        beds: {
            'R1': { bedId: 'R1', patientName: 'Test Patient', admissionDate: '2024-12-01' } as PatientData,
            'R2': { bedId: 'R2', patientName: '', isBlocked: false } as PatientData,
            'R3': { bedId: 'R3', patientName: '', isBlocked: true } as PatientData
        }
    };

    describe('canMovePatient', () => {
        it('should return false when no record is loaded', () => {
            const { result } = renderHook(() => useValidation());
            const check = result.current.canMovePatient('R1', 'R2', null);
            expect(check.canMove).toBe(false);
            expect(check.reason).toBe('No hay registro cargado');
        });

        it('should return false when target bed is occupied', () => {
            const { result } = renderHook(() => useValidation());
            const check = result.current.canMovePatient('R2', 'R1', mockRecord as DailyRecord);
            expect(check.canMove).toBe(false);
            expect(check.reason).toBe('La cama de destino ya está ocupada');
        });

        it('should return false when target bed is blocked', () => {
            const { result } = renderHook(() => useValidation());
            const check = result.current.canMovePatient('R1', 'R3', mockRecord as DailyRecord);
            expect(check.canMove).toBe(false);
            expect(check.reason).toBe('La cama de destino está bloqueada');
        });

        it('should return true when target bed is empty and not blocked', () => {
            const { result } = renderHook(() => useValidation());
            const check = result.current.canMovePatient('R1', 'R2', mockRecord as DailyRecord);
            expect(check.canMove).toBe(true);
        });
    });

    describe('canDischargePatient', () => {
        it('should return true when patient has name and admission date', () => {
            const { result } = renderHook(() => useValidation());
            const patient = { patientName: 'Test Patient', admissionDate: '2024-12-01' } as PatientData;
            expect(result.current.canDischargePatient(patient)).toBe(true);
        });

        it('should return false when patient has no name', () => {
            const { result } = renderHook(() => useValidation());
            const patient = { patientName: '', admissionDate: '2024-12-01' } as PatientData;
            expect(result.current.canDischargePatient(patient)).toBe(false);
        });

        it('should return false when patient has no admission date', () => {
            const { result } = renderHook(() => useValidation());
            const patient = { patientName: 'Test', admissionDate: '' } as PatientData;
            expect(result.current.canDischargePatient(patient)).toBe(false);
        });
    });

    describe('validateRecordSchema', () => {
        it('should return isValid true for valid minimal record', () => {
            const { result } = renderHook(() => useValidation());
            const validRecord = {
                date: '2024-12-28',
                beds: {},
                discharges: [],
                transfers: [],
                cma: []
            } as unknown as DailyRecord;
            const validation = result.current.validateRecordSchema(validRecord);
            expect(validation.isValid).toBeDefined();
        });
    });
});
