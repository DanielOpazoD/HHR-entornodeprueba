/**
 * Tests for auditSummaryGenerator.ts
 * Tests the human-readable summary generation for audit logs
 */

import { describe, it, expect } from 'vitest';
import { generateSummary } from '@/services/admin/utils/auditSummaryGenerator';
import { AuditAction } from '@/types/audit';

describe('auditSummaryGenerator', () => {
    describe('generateSummary', () => {
        describe('Patient actions', () => {
            it('should generate summary for PATIENT_ADMITTED', () => {
                const summary = generateSummary(
                    'PATIENT_ADMITTED',
                    { patientName: 'Juan Pérez', pathology: 'Neumonía', bedId: 'UTI-01' },
                    'UTI-01'
                );
                expect(summary).toContain('Ingreso');
                expect(summary).toContain('Juan Pérez');
                expect(summary).toContain('Neumonía');
                expect(summary).toContain('UTI-01');
            });

            it('should generate summary for PATIENT_ADMITTED without pathology', () => {
                const summary = generateSummary(
                    'PATIENT_ADMITTED',
                    { patientName: 'María López', bedId: 'M-02' },
                    'M-02'
                );
                expect(summary).toContain('Ingreso');
                expect(summary).toContain('María López');
                expect(summary).not.toContain('Dx:');
            });

            it('should generate summary for PATIENT_DISCHARGED', () => {
                const summary = generateSummary(
                    'PATIENT_DISCHARGED',
                    { patientName: 'Pedro García', status: 'Vivo' },
                    'UTI-03'
                );
                expect(summary).toContain('Alta');
                expect(summary).toContain('Pedro García');
                expect(summary).toContain('Vivo');
            });

            it('should generate summary for PATIENT_TRANSFERRED', () => {
                const summary = generateSummary(
                    'PATIENT_TRANSFERRED',
                    { patientName: 'Ana Martínez', destination: 'Hospital Regional' },
                    'M-05'
                );
                expect(summary).toContain('Traslado');
                expect(summary).toContain('Ana Martínez');
                expect(summary).toContain('Hospital Regional');
            });

            it('should generate summary for PATIENT_MODIFIED', () => {
                const summary = generateSummary(
                    'PATIENT_MODIFIED',
                    { patientName: 'Carlos Ruiz', changes: { pathology: {}, specialty: {} } },
                    'UTI-02'
                );
                expect(summary).toContain('Editó Ficha');
                expect(summary).toContain('Carlos Ruiz');
                expect(summary).toContain('pathology');
            });

            it('should generate summary for PATIENT_CLEARED', () => {
                const summary = generateSummary(
                    'PATIENT_CLEARED',
                    { patientName: 'Luis Soto', bedId: 'M-10' },
                    'M-10'
                );
                expect(summary).toContain('Limpieza Cama');
                expect(summary).toContain('M-10');
            });

            it('should generate summary for PATIENT_VIEWED', () => {
                const summary = generateSummary(
                    'PATIENT_VIEWED',
                    { patientName: 'Rosa Díaz' },
                    'UTI-01'
                );
                expect(summary).toContain('visualizada');
                expect(summary).toContain('Rosa Díaz');
            });
        });

        describe('Daily record actions', () => {
            it('should generate summary for DAILY_RECORD_CREATED', () => {
                const summary = generateSummary(
                    'DAILY_RECORD_CREATED',
                    {},
                    '2026-01-15'
                );
                expect(summary).toContain('Registro creado');
                expect(summary).toContain('2026-01-15');
            });

            it('should generate summary for DAILY_RECORD_CREATED with copy source', () => {
                const summary = generateSummary(
                    'DAILY_RECORD_CREATED',
                    { copiedFrom: '2026-01-14' },
                    '2026-01-15'
                );
                expect(summary).toContain('desde 2026-01-14');
            });

            it('should generate summary for DAILY_RECORD_DELETED', () => {
                const summary = generateSummary(
                    'DAILY_RECORD_DELETED',
                    {},
                    '2026-01-15'
                );
                expect(summary).toContain('Eliminación');
                expect(summary).toContain('2026-01-15');
            });
        });

        describe('CUDYR and Handoff actions', () => {
            it('should generate summary for CUDYR_MODIFIED', () => {
                const summary = generateSummary(
                    'CUDYR_MODIFIED',
                    { patientName: 'Test Patient', changes: { mobilization: {} } },
                    'M-01'
                );
                expect(summary).toContain('CUDYR');
                expect(summary).toContain('Test Patient');
            });

            it('should generate summary for NURSE_HANDOFF_MODIFIED', () => {
                const summary = generateSummary(
                    'NURSE_HANDOFF_MODIFIED',
                    { patientName: 'Test Patient', shift: 'day' },
                    'M-01'
                );
                expect(summary).toContain('Nota Enfermería');
                expect(summary).toContain('Largo');
            });

            it('should generate summary for MEDICAL_HANDOFF_MODIFIED', () => {
                const summary = generateSummary(
                    'MEDICAL_HANDOFF_MODIFIED',
                    { patientName: 'Test Patient' },
                    'M-01'
                );
                expect(summary).toContain('Evolución Médica');
            });

            it('should generate summary for HANDOFF_NOVEDADES_MODIFIED', () => {
                const summary = generateSummary(
                    'HANDOFF_NOVEDADES_MODIFIED',
                    { shift: 'night' },
                    '2026-01-15'
                );
                expect(summary).toContain('Novedades');
            });
        });

        describe('View actions', () => {
            it('should generate summary for VIEW_CUDYR', () => {
                const summary = generateSummary('VIEW_CUDYR', {}, '');
                expect(summary).toContain('Vista');
                expect(summary).toContain('CUDYR');
            });

            it('should generate summary for VIEW_NURSING_HANDOFF', () => {
                const summary = generateSummary('VIEW_NURSING_HANDOFF', {}, '');
                expect(summary).toContain('Entrega Enfermería');
            });

            it('should generate summary for VIEW_MEDICAL_HANDOFF', () => {
                const summary = generateSummary('VIEW_MEDICAL_HANDOFF', {}, '');
                expect(summary).toContain('Entrega Médica');
            });
        });

        describe('User actions', () => {
            it('should generate summary for USER_LOGIN', () => {
                const summary = generateSummary('USER_LOGIN', {}, 'user@example.com');
                expect(summary).toContain('Inicio de sesión');
            });

            it('should generate summary for USER_LOGOUT', () => {
                const summary = generateSummary(
                    'USER_LOGOUT',
                    { durationFormatted: '1h 30m' },
                    'user@example.com'
                );
                expect(summary).toContain('Cierre de sesión');
                expect(summary).toContain('1h 30m');
            });
        });

        describe('Bed actions', () => {
            it('should generate summary for BED_BLOCKED', () => {
                const summary = generateSummary(
                    'BED_BLOCKED',
                    { bedId: 'UTI-05', reason: 'Mantención' },
                    'UTI-05'
                );
                expect(summary).toContain('bloqueada');
                expect(summary).toContain('UTI-05');
                expect(summary).toContain('Mantención');
            });

            it('should generate summary for BED_UNBLOCKED', () => {
                const summary = generateSummary(
                    'BED_UNBLOCKED',
                    { bedId: 'UTI-05' },
                    'UTI-05'
                );
                expect(summary).toContain('desbloqueada');
            });

            it('should generate summary for EXTRA_BED_TOGGLED active', () => {
                const summary = generateSummary(
                    'EXTRA_BED_TOGGLED',
                    { bedId: 'EXTRA-01', active: true },
                    'EXTRA-01'
                );
                expect(summary).toContain('Activada');
                expect(summary).toContain('cama extra');
            });

            it('should generate summary for EXTRA_BED_TOGGLED inactive', () => {
                const summary = generateSummary(
                    'EXTRA_BED_TOGGLED',
                    { bedId: 'EXTRA-01', active: false },
                    'EXTRA-01'
                );
                expect(summary).toContain('Desactivada');
            });
        });

        describe('Medical signature', () => {
            it('should generate summary for MEDICAL_HANDOFF_SIGNED', () => {
                const summary = generateSummary(
                    'MEDICAL_HANDOFF_SIGNED',
                    { doctorName: 'Dr. García' },
                    '2026-01-15'
                );
                expect(summary).toContain('firmada');
                expect(summary).toContain('Dr. García');
            });
        });

        describe('Default case', () => {
            it('should return action name for unknown actions', () => {
                const summary = generateSummary(
                    'UNKNOWN_ACTION' as AuditAction,
                    {},
                    ''
                );
                expect(summary).toBe('UNKNOWN_ACTION');
            });
        });

        describe('Edge cases', () => {
            it('should handle missing patientName', () => {
                const summary = generateSummary('PATIENT_ADMITTED', {}, 'UTI-01');
                expect(summary).toContain('Paciente');
            });

            it('should handle missing bedId in details', () => {
                const summary = generateSummary('PATIENT_ADMITTED', {}, 'M-10');
                expect(summary).toContain('M-10');
            });
        });
    });
});
