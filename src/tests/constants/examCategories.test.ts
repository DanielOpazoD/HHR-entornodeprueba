/**
 * Exam Categories Constants Tests
 * Tests for exam categories structure and data integrity.
 */

import { describe, it, expect } from 'vitest';
import {
    EXAM_CATEGORIES,
    PROCEDENCIA_OPTIONS,
    FONASA_LEVELS,
    ExamCategory
} from '@/constants/examCategories';

describe('EXAM_CATEGORIES', () => {
    it('should have 10 categories', () => {
        expect(EXAM_CATEGORIES).toHaveLength(10);
    });

    it('should have all required category properties', () => {
        EXAM_CATEGORIES.forEach((category: ExamCategory) => {
            expect(category).toHaveProperty('id');
            expect(category).toHaveProperty('name');
            expect(category).toHaveProperty('exams');
            expect(Array.isArray(category.exams)).toBe(true);
            expect(category.exams.length).toBeGreaterThan(0);
        });
    });

    it('should have unique category IDs', () => {
        const ids = EXAM_CATEGORIES.map(c => c.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
    });

    describe('Bioquimica Category', () => {
        const bioquimica = EXAM_CATEGORIES.find(c => c.id === 'bioquimica');

        it('should exist', () => {
            expect(bioquimica).toBeDefined();
        });

        it('should have tube information', () => {
            expect(bioquimica?.tube).toBe('TUBO AMARILLO – ROJO');
        });

        it('should include common biochemistry exams', () => {
            expect(bioquimica?.exams).toContain('GLICEMIA');
            expect(bioquimica?.exams).toContain('CREATININA');
            expect(bioquimica?.exams).toContain('UREMIA');
        });
    });

    describe('Hematologia Category', () => {
        const hematologia = EXAM_CATEGORIES.find(c => c.id === 'hematologia');

        it('should exist', () => {
            expect(hematologia).toBeDefined();
        });

        it('should have TUBO LILA', () => {
            expect(hematologia?.tube).toBe('TUBO LILA');
        });

        it('should include HEMOGRAMA', () => {
            expect(hematologia?.exams).toContain('HEMOGRAMA');
        });
    });

    describe('Coagulacion Category', () => {
        const coagulacion = EXAM_CATEGORIES.find(c => c.id === 'coagulacion');

        it('should exist', () => {
            expect(coagulacion).toBeDefined();
        });

        it('should have TUBO CELESTE', () => {
            expect(coagulacion?.tube).toBe('TUBO CELESTE');
        });

        it('should include INR test', () => {
            expect(coagulacion?.exams).toContain('PROTROMBINA/ INR');
        });
    });

    describe('Categories without tube specification', () => {
        it('should exist for microbiologicos', () => {
            const micro = EXAM_CATEGORIES.find(c => c.id === 'microbiologicos');
            expect(micro).toBeDefined();
            expect(micro?.tube).toBeUndefined();
        });

        it('should exist for parasitologia', () => {
            const para = EXAM_CATEGORIES.find(c => c.id === 'parasitologia');
            expect(para).toBeDefined();
            expect(para?.tube).toBeUndefined();
        });
    });
});

describe('PROCEDENCIA_OPTIONS', () => {
    it('should have 6 options', () => {
        expect(PROCEDENCIA_OPTIONS).toHaveLength(6);
    });

    it('should include Hospitalización', () => {
        expect(PROCEDENCIA_OPTIONS).toContain('Hospitalización');
    });

    it('should include Urgencia', () => {
        expect(PROCEDENCIA_OPTIONS).toContain('Urgencia');
    });

    it('should include Policlínico', () => {
        expect(PROCEDENCIA_OPTIONS).toContain('Policlínico');
    });
});

describe('FONASA_LEVELS', () => {
    it('should have 4 levels (A, B, C, D)', () => {
        expect(FONASA_LEVELS).toHaveLength(4);
        expect(FONASA_LEVELS).toContain('A');
        expect(FONASA_LEVELS).toContain('B');
        expect(FONASA_LEVELS).toContain('C');
        expect(FONASA_LEVELS).toContain('D');
    });
});
