import { describe, expect, it } from 'vitest';
import { BedDefinition, BedType } from '@/types';
import {
    buildCensusBedRows,
    buildVisibleBeds,
    resolveVisibleBedTypes
} from '@/features/census/controllers/censusTableViewController';
import { DataFactory } from '@/tests/factories/DataFactory';

const TEST_BEDS: BedDefinition[] = [
    { id: 'R1', name: 'R1', type: BedType.UTI, isCuna: false },
    { id: 'R2', name: 'R2', type: BedType.MEDIA, isCuna: false },
    { id: 'E1', name: 'E1', type: BedType.MEDIA, isCuna: false, isExtra: true }
];

describe('censusTableViewController', () => {
    it('buildVisibleBeds keeps regular beds and enabled extra beds only', () => {
        const visibleBeds = buildVisibleBeds({
            allBeds: TEST_BEDS,
            activeExtraBeds: ['E1']
        });

        expect(visibleBeds.map((bed) => bed.id)).toEqual(['R1', 'R2', 'E1']);

        const visibleWithoutExtras = buildVisibleBeds({
            allBeds: TEST_BEDS,
            activeExtraBeds: []
        });

        expect(visibleWithoutExtras.map((bed) => bed.id)).toEqual(['R1', 'R2']);
    });

    it('buildCensusBedRows creates sub-row for clinical crib unless bed is blocked', () => {
        const bedsMap = {
            R1: DataFactory.createMockPatient('R1', {
                patientName: 'Paciente principal',
                clinicalCrib: DataFactory.createMockPatient('R1-cuna', {
                    patientName: 'RN clínico'
                })
            }),
            R2: DataFactory.createMockPatient('R2', {
                patientName: '',
                isBlocked: true,
                clinicalCrib: DataFactory.createMockPatient('R2-cuna', {
                    patientName: 'No debería mostrarse'
                })
            })
        };

        const result = buildCensusBedRows({
            visibleBeds: TEST_BEDS,
            beds: bedsMap
        });

        expect(result.occupiedRows.map((row) => row.id)).toEqual(['R1', 'R1-cuna', 'R2']);
        expect(result.emptyBeds.map((bed) => bed.id)).toEqual(['E1']);
    });

    it('resolveVisibleBedTypes applies only valid overrides', () => {
        const bedTypes = resolveVisibleBedTypes({
            visibleBeds: TEST_BEDS,
            overrides: {
                R1: BedType.UCI,
                R2: 'INVALID',
                E1: BedType.MEDIA
            }
        });

        expect(bedTypes.R1).toBe(BedType.UCI);
        expect(bedTypes.R2).toBe(BedType.MEDIA);
        expect(bedTypes.E1).toBe(BedType.MEDIA);
    });

    it('buildCensusBedRows treats undefined map as all-empty rows', () => {
        const result = buildCensusBedRows({
            visibleBeds: TEST_BEDS,
            beds: undefined
        });

        expect(result.occupiedRows).toEqual([]);
        expect(result.emptyBeds.map((bed) => bed.id)).toEqual(['R1', 'R2', 'E1']);
    });

    it('does not create orphan crib sub-row when primary bed is empty', () => {
        const bedsMap = {
            R1: DataFactory.createMockPatient('R1', {
                patientName: '',
                isBlocked: false,
                clinicalCrib: DataFactory.createMockPatient('R1-cuna', {
                    patientName: 'RN huérfano'
                })
            })
        };

        const result = buildCensusBedRows({
            visibleBeds: TEST_BEDS,
            beds: bedsMap
        });

        expect(result.occupiedRows).toEqual([]);
        expect(result.emptyBeds.map((bed) => bed.id)).toEqual(['R1', 'R2', 'E1']);
    });
});
