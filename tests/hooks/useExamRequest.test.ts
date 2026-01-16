/**
 * useExamRequest Hook Tests
 * Tests for the exam request form state management hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExamRequest } from '@/hooks/useExamRequest';
import { PatientData, PatientStatus, Specialty } from '@/types';

// Mock patient data
const mockPatient: PatientData = {
    bedId: 'X1',
    patientName: 'Juan Pérez',
    rut: '12.345.678-9',
    age: '45 años',
    pathology: 'Neumonía',
    status: PatientStatus.ESTABLE,
    hasWristband: true,
    admissionDate: '2026-01-01',
    insurance: 'Fonasa',
    biologicalSex: 'Masculino',
    specialty: Specialty.MEDICINA,
    admissionOrigin: 'Urgencias',
    origin: 'Residente',
    devices: [],
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    surgicalComplication: false,
    isUPC: false
};

describe('useExamRequest', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Initial State', () => {
        it('should initialize with empty selected exams', () => {
            const { result } = renderHook(() =>
                useExamRequest({ patient: mockPatient, isOpen: true })
            );

            expect(result.current.selectedExams.size).toBe(0);
        });

        it('should initialize procedencia as "Hospitalización"', () => {
            const { result } = renderHook(() =>
                useExamRequest({ patient: mockPatient, isOpen: true })
            );

            expect(result.current.procedencia).toBe('Hospitalización');
        });

        it('should initialize prevision from patient insurance', () => {
            const { result } = renderHook(() =>
                useExamRequest({ patient: mockPatient, isOpen: true })
            );

            expect(result.current.prevision).toBe('Fonasa');
        });

        it('should default prevision to FONASA if patient has no insurance', () => {
            const patientNoInsurance = { ...mockPatient, insurance: undefined };
            const { result } = renderHook(() =>
                useExamRequest({ patient: patientNoInsurance, isOpen: true })
            );

            expect(result.current.prevision).toBe('FONASA');
        });
    });

    describe('toggleExam', () => {
        it('should add exam to selectedExams when not selected', () => {
            const { result } = renderHook(() =>
                useExamRequest({ patient: mockPatient, isOpen: true })
            );

            act(() => {
                result.current.toggleExam('BIOQUIMICA|GLICEMIA');
            });

            expect(result.current.selectedExams.has('BIOQUIMICA|GLICEMIA')).toBe(true);
            expect(result.current.selectedExams.size).toBe(1);
        });

        it('should remove exam from selectedExams when already selected', () => {
            const { result } = renderHook(() =>
                useExamRequest({ patient: mockPatient, isOpen: true })
            );

            // Add exam
            act(() => {
                result.current.toggleExam('BIOQUIMICA|GLICEMIA');
            });

            // Remove exam
            act(() => {
                result.current.toggleExam('BIOQUIMICA|GLICEMIA');
            });

            expect(result.current.selectedExams.has('BIOQUIMICA|GLICEMIA')).toBe(false);
            expect(result.current.selectedExams.size).toBe(0);
        });

        it('should handle multiple exam selections', () => {
            const { result } = renderHook(() =>
                useExamRequest({ patient: mockPatient, isOpen: true })
            );

            act(() => {
                result.current.toggleExam('BIOQUIMICA|GLICEMIA');
                result.current.toggleExam('HEMATOLOGIA|HEMOGRAMA');
                result.current.toggleExam('COAGULACION|PROTROMBINA/ INR');
            });

            expect(result.current.selectedExams.size).toBe(3);
            expect(result.current.selectedExams.has('BIOQUIMICA|GLICEMIA')).toBe(true);
            expect(result.current.selectedExams.has('HEMATOLOGIA|HEMOGRAMA')).toBe(true);
            expect(result.current.selectedExams.has('COAGULACION|PROTROMBINA/ INR')).toBe(true);
        });
    });

    describe('setProcedencia', () => {
        it('should update procedencia value', () => {
            const { result } = renderHook(() =>
                useExamRequest({ patient: mockPatient, isOpen: true })
            );

            act(() => {
                result.current.setProcedencia('Urgencia');
            });

            expect(result.current.procedencia).toBe('Urgencia');
        });
    });

    describe('setPrevision', () => {
        it('should update prevision value', () => {
            const { result } = renderHook(() =>
                useExamRequest({ patient: mockPatient, isOpen: true })
            );

            act(() => {
                result.current.setPrevision('FONASA A');
            });

            expect(result.current.prevision).toBe('FONASA A');
        });
    });

    describe('getSelectedCount', () => {
        it('should return correct count of selected exams', () => {
            const { result } = renderHook(() =>
                useExamRequest({ patient: mockPatient, isOpen: true })
            );

            expect(result.current.getSelectedCount()).toBe(0);

            act(() => {
                result.current.toggleExam('BIOQUIMICA|GLICEMIA');
                result.current.toggleExam('HEMATOLOGIA|HEMOGRAMA');
            });

            expect(result.current.getSelectedCount()).toBe(2);
        });
    });

    describe('Reset on modal open', () => {
        it('should reset selectedExams when modal reopens', () => {
            const { result, rerender } = renderHook(
                ({ isOpen }) => useExamRequest({ patient: mockPatient, isOpen }),
                { initialProps: { isOpen: true } }
            );

            // Select some exams
            act(() => {
                result.current.toggleExam('BIOQUIMICA|GLICEMIA');
            });
            expect(result.current.selectedExams.size).toBe(1);

            // Close modal
            rerender({ isOpen: false });

            // Reopen modal - should reset
            rerender({ isOpen: true });
            expect(result.current.selectedExams.size).toBe(0);
        });
    });
});
