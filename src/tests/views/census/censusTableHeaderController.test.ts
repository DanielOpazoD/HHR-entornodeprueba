import { describe, expect, it } from 'vitest';
import { CENSUS_HEADER_COLUMNS } from '@/features/census/controllers/censusTableHeaderController';

describe('censusTableHeaderController', () => {
    it('keeps a stable ordered schema for all non-action headers', () => {
        expect(CENSUS_HEADER_COLUMNS.map((column) => column.key)).toEqual([
            'bed',
            'type',
            'name',
            'rut',
            'age',
            'diagnosis',
            'specialty',
            'status',
            'admission',
            'dmi',
            'cqx',
            'upc'
        ]);
    });

    it('includes metadata for tooltip and visual border exceptions', () => {
        const dmiColumn = CENSUS_HEADER_COLUMNS.find((column) => column.key === 'dmi');
        const upcColumn = CENSUS_HEADER_COLUMNS.find((column) => column.key === 'upc');

        expect(dmiColumn?.title).toBe('Dispositivos médicos invasivos');
        expect(upcColumn?.className).toBe('border-r-0');
    });
});
