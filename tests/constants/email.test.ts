/**
 * Tests for email.ts
 * 
 * These tests protect the email format from regressions.
 * The email format is critical for institutional communication.
 */
import { describe, it, expect } from 'vitest';
import { buildCensusEmailSubject, buildCensusEmailBody, CENSUS_DEFAULT_RECIPIENTS } from '@/constants/email';

describe('Email Constants', () => {
    describe('CENSUS_DEFAULT_RECIPIENTS', () => {
        it('should be an empty array by default (no hardcoded emails)', () => {
            expect(CENSUS_DEFAULT_RECIPIENTS).toBeInstanceOf(Array);
            expect(CENSUS_DEFAULT_RECIPIENTS).toHaveLength(0);
        });
    });

    describe('buildCensusEmailSubject', () => {
        it('should include "Censo diario pacientes hospitalizados"', () => {
            const subject = buildCensusEmailSubject('2025-12-28');
            expect(subject).toContain('Censo diario pacientes hospitalizados');
        });

        it('should include formatted date DD-MM-YYYY', () => {
            const subject = buildCensusEmailSubject('2025-12-28');
            expect(subject).toContain('28-12-2025');
        });
    });

    describe('buildCensusEmailBody', () => {
        it('should start with "Estimados:"', () => {
            const body = buildCensusEmailBody('2025-12-28');
            expect(body).toMatch(/^Estimados:/);
        });

        it('should contain the date in Spanish format', () => {
            const body = buildCensusEmailBody('2025-12-28');
            expect(body).toContain('28 de diciembre de 2025');
        });

        it('should contain "Saludos cordiales,"', () => {
            const body = buildCensusEmailBody('2025-12-28');
            expect(body).toContain('Saludos cordiales,');
        });

        it('should contain Unicode separator', () => {
            const body = buildCensusEmailBody('2025-12-28');
            expect(body).toContain('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        });

        it('should contain "Hospital Hanga Roa"', () => {
            const body = buildCensusEmailBody('2025-12-28');
            expect(body).toContain('Hospital Hanga Roa');
        });

        it('should contain "Anexo MINSAL 328388"', () => {
            const body = buildCensusEmailBody('2025-12-28');
            expect(body).toContain('Anexo MINSAL 328388');
        });

        it('should contain "Enfermería - Servicio Hospitalizados"', () => {
            const body = buildCensusEmailBody('2025-12-28');
            expect(body).toContain('Enfermería - Servicio Hospitalizados');
        });

        it('should include encryption PIN when provided', () => {
            const body = buildCensusEmailBody('2025-12-28', undefined, '123456');
            expect(body).toContain('Clave Excel: 123456');
        });

        it('should not include encryption PIN line when not provided', () => {
            const body = buildCensusEmailBody('2025-12-28');
            expect(body).not.toContain('Clave Excel:');
        });

        it('should include nurse signature when provided', () => {
            const body = buildCensusEmailBody('2025-12-28', 'María López / Juan Pérez');
            expect(body).toContain('María López / Juan Pérez');
        });

        it('should have correct order: body, PIN, farewell, separator, signature', () => {
            const body = buildCensusEmailBody('2025-12-28', 'Test Nurse', '999999');

            const bodyIndex = body.indexOf('Junto con saludar');
            const pinIndex = body.indexOf('Clave Excel: 999999');
            const farewellIndex = body.indexOf('Saludos cordiales');
            const separatorIndex = body.indexOf('━━━');
            const signatureIndex = body.indexOf('Test Nurse');

            expect(bodyIndex).toBeLessThan(pinIndex);
            expect(pinIndex).toBeLessThan(farewellIndex);
            expect(farewellIndex).toBeLessThan(separatorIndex);
            expect(separatorIndex).toBeLessThan(signatureIndex);
        });
    });
});
