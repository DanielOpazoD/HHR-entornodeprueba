import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useExamRequest } from '@/hooks/useExamRequest';
import { PatientData } from '@/types';

describe('useExamRequest', () => {
    const mockPatient: Partial<PatientData> = {
        patientName: 'Test Patient',
        insurance: 'Fonasa'
    };

    it('should initialize with default values', () => {
        const { result } = renderHook(() =>
            useExamRequest({ patient: mockPatient as PatientData })
        );

        expect(result.current.selectedExams.size).toBe(0);
        expect(result.current.procedencia).toBe('Hospitalización');
        expect(result.current.prevision).toBe('FONASA');
    });

    it('should toggle exam selection', () => {
        const { result } = renderHook(() =>
            useExamRequest({ patient: mockPatient as PatientData })
        );

        act(() => {
            result.current.toggleExam('HEMOGRAMA');
        });

        expect(result.current.selectedExams.has('HEMOGRAMA')).toBe(true);

        act(() => {
            result.current.toggleExam('HEMOGRAMA');
        });

        expect(result.current.selectedExams.has('HEMOGRAMA')).toBe(false);
    });

    it('should get selected count', () => {
        const { result } = renderHook(() =>
            useExamRequest({ patient: mockPatient as PatientData })
        );

        expect(result.current.getSelectedCount()).toBe(0);

        act(() => {
            result.current.toggleExam('HEMOGRAMA');
            result.current.toggleExam('GLICEMIA');
        });

        expect(result.current.getSelectedCount()).toBe(2);
    });

    it('should set procedencia', () => {
        const { result } = renderHook(() =>
            useExamRequest({ patient: mockPatient as PatientData })
        );

        act(() => {
            result.current.setProcedencia('Urgencia');
        });

        expect(result.current.procedencia).toBe('Urgencia');
    });

    it('should set prevision', () => {
        const { result } = renderHook(() =>
            useExamRequest({ patient: mockPatient as PatientData })
        );

        act(() => {
            result.current.setPrevision('ISAPRE');
        });

        expect(result.current.prevision).toBe('ISAPRE');
    });

    it('should reset when modal opens', async () => {
        const { result, rerender } = renderHook(
            ({ isOpen }) => useExamRequest({ patient: mockPatient as PatientData, isOpen }),
            { initialProps: { isOpen: false } }
        );

        act(() => {
            result.current.toggleExam('HEMOGRAMA');
            result.current.setProcedencia('Urgencia');
        });

        expect(result.current.selectedExams.has('HEMOGRAMA')).toBe(true);

        rerender({ isOpen: true });

        await waitFor(() => {
            expect(result.current.selectedExams.size).toBe(0);
        });
    });

    it('should have handlePrint function', () => {
        const { result } = renderHook(() =>
            useExamRequest({ patient: mockPatient as PatientData })
        );

        expect(typeof result.current.handlePrint).toBe('function');
    });
});
