/**
 * Tests for beds.ts constants
 * Tests bed configuration and filtering
 */

import { describe, it, expect } from 'vitest';
import {
    BEDS,
    HOSPITAL_CAPACITY,
    EXTRA_BEDS,
    REGULAR_BEDS,
    UTI_BEDS,
    MEDIA_BEDS,
} from '@/constants/beds';
import { BedType } from '@/types';

describe('beds constants', () => {
    describe('HOSPITAL_CAPACITY', () => {
        it('should be 18', () => {
            expect(HOSPITAL_CAPACITY).toBe(18);
        });
    });

    describe('BEDS array', () => {
        it('should have correct total count', () => {
            expect(BEDS.length).toBe(23); // 18 regular + 5 extra
        });

        it('should have unique IDs', () => {
            const ids = BEDS.map(b => b.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(BEDS.length);
        });

        it('should have all required properties', () => {
            BEDS.forEach(bed => {
                expect(bed.id).toBeDefined();
                expect(bed.name).toBeDefined();
                expect(bed.type).toBeDefined();
                expect(typeof bed.isCuna).toBe('boolean');
            });
        });
    });

    describe('UTI_BEDS', () => {
        it('should have 4 UTI beds', () => {
            expect(UTI_BEDS.length).toBe(4);
        });

        it('should all be UTI type', () => {
            UTI_BEDS.forEach(bed => {
                expect(bed.type).toBe(BedType.UTI);
            });
        });

        it('should include R1, R2, R3, R4', () => {
            const ids = UTI_BEDS.map(b => b.id);
            expect(ids).toContain('R1');
            expect(ids).toContain('R2');
            expect(ids).toContain('R3');
            expect(ids).toContain('R4');
        });
    });

    describe('MEDIA_BEDS', () => {
        it('should have 14 MEDIA beds (excluding extra)', () => {
            expect(MEDIA_BEDS.length).toBe(14);
        });

        it('should all be MEDIA type', () => {
            MEDIA_BEDS.forEach(bed => {
                expect(bed.type).toBe(BedType.MEDIA);
            });
        });

        it('should not include extra beds', () => {
            MEDIA_BEDS.forEach(bed => {
                expect(bed.isExtra).toBeFalsy();
            });
        });

        it('should include NEO beds', () => {
            const ids = MEDIA_BEDS.map(b => b.id);
            expect(ids).toContain('NEO1');
            expect(ids).toContain('NEO2');
        });

        it('should include hospitalization beds', () => {
            const ids = MEDIA_BEDS.map(b => b.id);
            expect(ids).toContain('H1C1');
            expect(ids).toContain('H6C2');
        });
    });

    describe('EXTRA_BEDS', () => {
        it('should have 5 extra beds', () => {
            expect(EXTRA_BEDS.length).toBe(5);
        });

        it('should all have isExtra true', () => {
            EXTRA_BEDS.forEach(bed => {
                expect(bed.isExtra).toBe(true);
            });
        });

        it('should include E1 through E5', () => {
            const ids = EXTRA_BEDS.map(b => b.id);
            expect(ids).toContain('E1');
            expect(ids).toContain('E2');
            expect(ids).toContain('E3');
            expect(ids).toContain('E4');
            expect(ids).toContain('E5');
        });
    });

    describe('REGULAR_BEDS', () => {
        it('should have 18 regular beds', () => {
            expect(REGULAR_BEDS.length).toBe(18);
        });

        it('should not include extra beds', () => {
            REGULAR_BEDS.forEach(bed => {
                expect(bed.isExtra).toBeFalsy();
            });
        });

        it('should equal HOSPITAL_CAPACITY', () => {
            expect(REGULAR_BEDS.length).toBe(HOSPITAL_CAPACITY);
        });
    });

    describe('Bed relationships', () => {
        it('REGULAR_BEDS + EXTRA_BEDS should equal BEDS', () => {
            expect(REGULAR_BEDS.length + EXTRA_BEDS.length).toBe(BEDS.length);
        });

        it('UTI_BEDS + MEDIA_BEDS should equal REGULAR_BEDS', () => {
            expect(UTI_BEDS.length + MEDIA_BEDS.length).toBe(REGULAR_BEDS.length);
        });
    });
});
