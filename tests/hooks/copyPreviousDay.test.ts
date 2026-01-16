/**
 * Tests for Copy Previous Day Functionality
 * Verifies that copying from previous day works correctly.
 */

import { describe, it, expect, vi } from 'vitest';
import { DailyRecord, PatientData, Specialty, PatientStatus, CudyrScore } from '../../types';

// Simulate the copy logic from DailyRecordRepository
const copyPatientsFromPrevious = (
    prevRecord: DailyRecord,
    newDate: string
): Partial<DailyRecord> => {
    const newBeds: Record<string, PatientData> = {};

    Object.keys(prevRecord.beds).forEach(bedId => {
        const prevPatient = prevRecord.beds[bedId];

        if (prevPatient.patientName || prevPatient.isBlocked) {
            // Deep copy patient
            const copiedPatient = JSON.parse(JSON.stringify(prevPatient));
            newBeds[bedId] = {
                ...copiedPatient,
                // Reset CUDYR for new day
                cudyr: undefined,
            };
        } else {
            // Empty bed
            newBeds[bedId] = {
                bedId,
                patientName: '',
                rut: '',
                age: '',
                admissionDate: '',
                pathology: '',
                specialty: Specialty.EMPTY,
                status: PatientStatus.EMPTY,
                hasWristband: false,
                devices: [],
                surgicalComplication: false,
                isUPC: false,
                bedMode: prevPatient.bedMode || 'Cama',
                hasCompanionCrib: prevPatient.hasCompanionCrib || false,
                isBlocked: false,
            };
        }
    });

    return {
        date: newDate,
        beds: newBeds,
        discharges: [], // New day starts with no discharges
        transfers: [], // New day starts with no transfers
        cma: [], // New day starts with no CMA
        activeExtraBeds: [...(prevRecord.activeExtraBeds || [])],
    };
};

describe('Copy Previous Day', () => {
    const createPatient = (name: string, bedId: string): PatientData => ({
        bedId,
        patientName: name,
        rut: '12345678-9',
        pathology: 'Test Pathology',
        age: '40',
        insurance: 'Fonasa',
        origin: 'Residente',
        isRapanui: true,
        bedMode: 'Cama',
        hasCompanionCrib: false,
        isBlocked: false,
        admissionDate: '2024-01-01',
        specialty: Specialty.MEDICINA,
        status: PatientStatus.ESTABLE,
        hasWristband: true,
        devices: [],
        surgicalComplication: false,
        isUPC: false,
        cudyr: {
            changeClothes: 1,
            mobilization: 1,
            feeding: 1,
            elimination: 1,
            psychosocial: 1,
            surveillance: 1,
            vitalSigns: 1,
            fluidBalance: 1,
            oxygenTherapy: 1,
            airway: 1,
            proInterventions: 1,
            skinCare: 1,
            pharmacology: 1,
            invasiveElements: 1
        },
    });

    const createEmptyBed = (bedId: string): PatientData => ({
        bedId,
        patientName: '',
        rut: '',
        age: '',
        admissionDate: '',
        pathology: '',
        specialty: Specialty.EMPTY,
        status: PatientStatus.EMPTY,
        hasWristband: false,
        devices: [],
        surgicalComplication: false,
        isUPC: false,
        bedMode: 'Cama',
        hasCompanionCrib: false,
        isBlocked: false,
    });

    describe('Patient Copying', () => {
        it('should copy occupied beds to new day', () => {
            const prevRecord: DailyRecord = {
                date: '2024-12-22',
                beds: {
                    'bed-1': createPatient('Juan', 'bed-1'),
                    'bed-2': createPatient('María', 'bed-2'),
                    'bed-3': createEmptyBed('bed-3'),
                },
                discharges: [],
                transfers: [],
                cma: [],
                lastUpdated: '',
                nurses: [],
                activeExtraBeds: [],
            };

            const newDay = copyPatientsFromPrevious(prevRecord, '2024-12-23');

            expect(newDay.beds?.['bed-1'].patientName).toBe('Juan');
            expect(newDay.beds?.['bed-2'].patientName).toBe('María');
            expect(newDay.beds?.['bed-3'].patientName).toBe('');
        });

        it('should reset CUDYR scores for new day', () => {
            const prevRecord: DailyRecord = {
                date: '2024-12-22',
                beds: {
                    'bed-1': createPatient('Juan', 'bed-1'),
                },
                discharges: [],
                transfers: [],
                cma: [],
                lastUpdated: '',
                nurses: [],
                activeExtraBeds: [],
            };

            const newDay = copyPatientsFromPrevious(prevRecord, '2024-12-23');

            expect(newDay.beds?.['bed-1'].cudyr).toBeUndefined();
        });

        it('should copy blocked beds status', () => {
            const prevRecord: DailyRecord = {
                date: '2024-12-22',
                beds: {
                    'bed-1': { ...createEmptyBed('bed-1'), isBlocked: true },
                },
                discharges: [],
                transfers: [],
                cma: [],
                lastUpdated: '',
                nurses: [],
                activeExtraBeds: [],
            };

            const newDay = copyPatientsFromPrevious(prevRecord, '2024-12-23');

            // Blocked beds should be copied
            expect(newDay.beds?.['bed-1'].isBlocked).toBe(true);
        });

        it('should preserve bed mode (Cama/Cuna)', () => {
            const prevRecord: DailyRecord = {
                date: '2024-12-22',
                beds: {
                    'bed-1': { ...createPatient('Bebé', 'bed-1'), bedMode: 'Cuna' },
                },
                discharges: [],
                transfers: [],
                cma: [],
                lastUpdated: '',
                nurses: [],
                activeExtraBeds: [],
            };

            const newDay = copyPatientsFromPrevious(prevRecord, '2024-12-23');

            expect(newDay.beds?.['bed-1'].bedMode).toBe('Cuna');
        });
    });

    describe('Movement Lists', () => {
        it('should start new day with empty discharges', () => {
            const prevRecord: DailyRecord = {
                date: '2024-12-22',
                beds: {},
                discharges: [{ id: 'old', patientName: 'Old' } as any],
                transfers: [],
                cma: [],
                lastUpdated: '',
                nurses: [],
                activeExtraBeds: [],
            };

            const newDay = copyPatientsFromPrevious(prevRecord, '2024-12-23');

            expect(newDay.discharges?.length).toBe(0);
        });

        it('should start new day with empty transfers', () => {
            const prevRecord: DailyRecord = {
                date: '2024-12-22',
                beds: {},
                discharges: [],
                transfers: [{ id: 'old', patientName: 'Old' } as any],
                cma: [],
                lastUpdated: '',
                nurses: [],
                activeExtraBeds: [],
            };

            const newDay = copyPatientsFromPrevious(prevRecord, '2024-12-23');

            expect(newDay.transfers?.length).toBe(0);
        });

        it('should start new day with empty CMA', () => {
            const prevRecord: DailyRecord = {
                date: '2024-12-22',
                beds: {},
                discharges: [],
                transfers: [],
                cma: [{ id: 'old', patientName: 'Old' } as any],
                lastUpdated: '',
                nurses: [],
                activeExtraBeds: [],
            };

            const newDay = copyPatientsFromPrevious(prevRecord, '2024-12-23');

            expect(newDay.cma?.length).toBe(0);
        });
    });

    describe('Extra Beds', () => {
        it('should copy active extra beds', () => {
            const prevRecord: DailyRecord = {
                date: '2024-12-22',
                beds: {},
                discharges: [],
                transfers: [],
                cma: [],
                lastUpdated: '',
                nurses: [],
                activeExtraBeds: ['extra-1', 'extra-2'],
            };

            const newDay = copyPatientsFromPrevious(prevRecord, '2024-12-23');

            expect(newDay.activeExtraBeds).toContain('extra-1');
            expect(newDay.activeExtraBeds).toContain('extra-2');
        });
    });
});
