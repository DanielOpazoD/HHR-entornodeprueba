import { describe, expect, it } from 'vitest';
import { excerptAroundChange } from '@/services/admin/auditTextExcerpt';
import { compactAuditDetails } from '@/services/admin/auditDetailsCompaction';
import { normalizeAuditTrailEvent } from '@/services/admin/auditTrail/auditTrailNormalize';

const note = (length: number) =>
  Array.from({ length }, (_, index) => 'Paciente estable sin fiebre. '[index % 29]).join('');

describe('long text changes', () => {
  it('keeps short texts whole', () => {
    expect(excerptAroundChange('Estable', 'Grave', 50)).toEqual({
      before: 'Estable',
      after: 'Grave',
    });
  });

  it('cuts both sides around the first difference, from the same offset', () => {
    const before = note(1_200);
    const after = `${before} Se agrega antibiótico.`;

    const excerpt = excerptAroundChange(before, after, 280);

    expect(excerpt.after.endsWith('Se agrega antibiótico.')).toBe(true);
    expect(excerpt.before.startsWith('…')).toBe(true);
    expect(excerpt.before).not.toBe(excerpt.after);
    expect(excerpt.after.length).toBeLessThanOrEqual(282);
  });

  it('stores an edit at the end of a long note and still shows what changed', () => {
    const before = note(1_200);
    const after = `${before} NUEVO`;
    const stored = compactAuditDetails({
      patientName: 'Paciente Sintético',
      changes: { handoffNoteDayShift: { old: before, new: after } },
    });
    const change = (stored.changes as Record<string, { old: string; new: string }>)
      .handoffNoteDayShift;
    expect(change.old).not.toBe(change.new);
    expect(change.new.endsWith('NUEVO')).toBe(true);

    const event = normalizeAuditTrailEvent({
      id: 'note-1',
      timestamp: '2026-10-22T14:00:00.000Z',
      userId: 'enfermera@hospital.test',
      action: 'NURSE_HANDOFF_MODIFIED',
      entityType: 'patient',
      entityId: 'H1C1',
      details: stored,
    });
    expect(event?.changes).toHaveLength(1);
    expect(event?.changes[0].after?.endsWith('NUEVO')).toBe(true);
  });

  it('shows an edit beyond the first 280 characters of a shown note', () => {
    const before = note(290);
    const event = normalizeAuditTrailEvent({
      id: 'note-2',
      timestamp: '2026-10-22T14:00:00.000Z',
      userId: 'enfermera@hospital.test',
      action: 'MEDICAL_HANDOFF_MODIFIED',
      entityType: 'patient',
      entityId: 'H1C1',
      details: { changes: { medicalHandoffNote: { old: before, new: `${before} y control` } } },
    });
    expect(event?.changes[0].after?.endsWith('y control')).toBe(true);
  });
});
