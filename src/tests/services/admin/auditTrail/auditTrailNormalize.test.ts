import { describe, expect, it } from 'vitest';
import {
  normalizeAuditTrailEvent,
  normalizeAuditTrailEvents,
  parseAuditTrailTimestamp,
} from '@/services/admin/auditTrail/auditTrailNormalize';
import { auditLog, patientDetails } from './auditTrailFixtures';

const normalize = (overrides: Parameters<typeof auditLog>[0]) => {
  const event = normalizeAuditTrailEvent(auditLog(overrides));
  if (!event) throw new Error('expected an event');
  return event;
};

describe('audit trail normalization', () => {
  it('turns a single-field edit into "field: before → after"', () => {
    const event = normalize({
      details: patientDetails('Paciente Sintético', {
        rut: '12.345.678-5',
        changes: { age: { old: 40, new: 41 } },
      }),
    });

    expect(event).toMatchObject({
      category: 'change',
      status: 'ok',
      label: 'Edad',
      changes: [{ field: 'Edad', before: '40', after: '41' }],
      patient: { name: 'Paciente Sintético', document: '12.345.678-5', bedId: 'H1C1' },
      actor: { name: 'Enfermera Uno', email: 'enfermera.uno@hospital.test' },
    });
  });

  it('keeps every field of a multi-field edit and dates as day-month-year', () => {
    const event = normalize({
      details: patientDetails('Paciente Sintético', {
        changes: {
          admissionDate: { old: '2026-10-20', new: '2026-10-21' },
          insurance: { old: 'Fonasa', new: '' },
        },
      }),
    });

    expect(event.label).toBe('Edición');
    expect(event.changes).toEqual([
      { field: 'Fecha de ingreso', before: '20-10-2026', after: '21-10-2026' },
      { field: 'Previsión', before: 'Fonasa', after: undefined },
    ]);
  });

  it('shows a bed move as the bed change itself', () => {
    const event = normalize({
      action: 'PATIENT_BED_CHANGED',
      details: patientDetails('Paciente Sintético', {
        movementKind: 'move',
        sourceBed: 'H1C1',
        targetBed: 'H2C3',
      }),
    });

    expect(event.label).toBe('Cambio de cama');
    expect(event.changes[0]).toEqual({ field: 'Cama', before: 'H1C1', after: 'H2C3' });
    expect(event.patient?.bedId).toBe('H2C3');
  });

  it('labels CUDYR items and truncates long handoff notes', () => {
    const cudyr = normalize({
      action: 'CUDYR_MODIFIED',
      entityId: 'H2C1-crib',
      details: {
        patientName: 'RN Sintético',
        bedId: 'H2C1-crib',
        changes: { mobilization: { old: 1, new: 3 } },
      },
    });
    expect(cudyr.changes).toEqual([{ field: 'Movilización', before: '1', after: '3' }]);
    expect(cudyr.patient?.bedId).toBe('H2C1 · cuna');

    const note = normalize({
      action: 'NURSE_HANDOFF_MODIFIED',
      details: patientDetails('Paciente Sintético', {
        shift: 'night',
        changes: { note: { old: 'Estable', new: 'x'.repeat(400) } },
      }),
    });
    expect(note.detail).toBe('Turno noche');
    expect(note.changes[0].after).toHaveLength(281);
    expect(note.changes[0].after?.endsWith('…')).toBe(true);
  });

  it('keeps edits that ended where they began without repeating the event name', () => {
    const note = normalize({
      action: 'MEDICAL_HANDOFF_MODIFIED',
      details: patientDetails('Paciente Sintético', { reverted: ['medicalHandoffNote'] }),
    });
    expect(note.changes).toEqual([]);
    expect(note.detail).toBe('Revertido');

    const cudyr = normalize({
      action: 'CUDYR_MODIFIED',
      details: patientDetails('Paciente Sintético', {
        changes: { mobilization: { old: 1, new: 3 } },
        reverted: ['feeding'],
      }),
    });
    expect(cudyr.changes).toEqual([{ field: 'Movilización', before: '1', after: '3' }]);
    expect(cudyr.detail).toBe('Revertido: Alimentación');
  });

  it('expands device changes one device at a time', () => {
    const event = normalize({
      details: patientDetails('Paciente Sintético', {
        changes: {
          deviceDetails: {
            CVC: { old: 'N/A', new: { installationDate: '2026-10-21', notes: 'yugular' } },
            SNG: { old: { installationDate: '2026-10-01' }, new: 'Eliminado' },
          },
        },
      }),
    });

    expect(event.changes).toEqual([
      { field: 'Dispositivo CVC', before: undefined, after: 'instalado 21-10-2026 · yugular' },
      { field: 'Dispositivo SNG', before: 'instalado 01-10-2026', after: 'Retirado' },
    ]);
  });

  it('names connection events by how they started or ended', () => {
    expect(
      normalize({ action: 'USER_LOGIN', entityType: 'user', details: { start: 'resume' } }).label
    ).toBe('Reconexión');
    expect(normalize({ action: 'USER_LOGIN', entityType: 'user' }).label).toBe('Inicio de sesión');
    const closed = normalize({
      action: 'USER_LOGOUT',
      entityType: 'user',
      details: { reason: 'closed', durationSeconds: 3_900 },
    });
    expect(closed).toMatchObject({
      category: 'connection',
      label: 'Desconexión',
      detail: '1 h 05 m',
      patient: undefined,
    });
    expect(
      normalize({ action: 'USER_LOGOUT', entityType: 'user', details: { reason: 'automatic' } })
        .label
    ).toBe('Cierre automático');
  });

  it('groups outcomes into recorded, automatic and review', () => {
    expect(normalize({ action: 'CONFLICT_AUTO_MERGED' }).status).toBe('auto');
    expect(normalize({ action: 'PATIENT_CLEARED' }).status).toBe('review');
    expect(normalize({ details: { syncStatus: 'needs_review' } }).status).toBe('review');
    expect(normalize({ details: { resolution: 'already_applied' } }).status).toBe('auto');
  });

  it('explains why an automatic merge kept each value and flags the ones to review', () => {
    const merge = (assessment: Record<string, unknown>) =>
      normalize({
        action: 'CONFLICT_AUTO_MERGED',
        entityType: 'dailyRecord',
        entityId: '2026-10-22',
        details: {
          entryCount: 2,
          assessment,
          conflictResolutionSummary: {
            truthSource: 'authority_intent_invariants',
            lastWriteWins: false,
            mergedPaths: ['beds.H1C1.pathology'],
            blockedPaths: ['beds.H2C1.patientName'],
          },
          snapshotRecovery: { status: 'saved', snapshotIds: ['s1'] },
        },
      });

    const routine = merge({ riskLevel: 'low', reviewRecommended: false });
    expect(routine).toMatchObject({
      label: 'Conflicto conciliado',
      detail: '2 decisiones · riesgo bajo',
      status: 'auto',
    });
    expect(routine.notes).toEqual([
      'Verdad elegida por autoridad transaccional, intención clínica e invariantes; no por el último navegador',
      'Fusionado: H1C1 · Diagnóstico',
      'Protegido: H2C1 · Nombre',
    ]);
    expect(merge({ riskLevel: 'high', reviewRecommended: true }).status).toBe('review');
  });

  it('reads Firestore timestamps and names server-only actions', () => {
    expect(parseAuditTrailTimestamp({ seconds: 1_760_000_000 })).toBe(1_760_000_000_000);
    expect(parseAuditTrailTimestamp('no es fecha')).toBeNull();
    const drive = normalize({
      action: 'CLINICAL_DOCUMENT_DRIVE_EXPORTED' as never,
      timestamp: { toDate: () => new Date('2026-10-22T15:00:00.000Z') } as never,
    });
    expect(drive).toMatchObject({ category: 'access', label: 'Documento enviado a Drive' });
    expect(drive.at).toBe(Date.parse('2026-10-22T15:00:00.000Z'));
  });

  it('keeps the newborn apart from the mother and never rewrites a passport', () => {
    const events = normalizeAuditTrailEvents([
      auditLog({ details: patientDetails('Madre Sintética', { rut: '33.333.333-3' }) }),
      auditLog({ details: patientDetails('RN Sintético', { rut: '33.333.333-3' }) }),
      auditLog({ details: patientDetails('Paciente Pasaporte', { rut: 'AB1234567' }) }),
    ]);

    const keys = new Set(events.map(event => event.patient?.key));
    expect(keys.size).toBe(3);
    expect(
      events.find(event => event.patient?.name === 'Paciente Pasaporte')?.patient
    ).toMatchObject({ document: 'AB1234567' });
  });

  it('separates two people who share a name but not a document', () => {
    const events = normalizeAuditTrailEvents([
      auditLog({ details: patientDetails('Juan Sintético', { rut: '11.111.111-1' }) }),
      auditLog({
        timestamp: '2026-10-22T15:00:00.000Z',
        details: patientDetails('Juan Sintético', { rut: '22.222.222-2' }),
      }),
      auditLog({
        timestamp: '2026-10-22T16:00:00.000Z',
        patientIdentifier: '22222***-*',
        details: patientDetails('Juan Sintético'),
      }),
    ]);

    const keys = events.map(event => event.patient?.key);
    expect(new Set(keys).size).toBe(2);
    // The masked event joins the most recent full document of that name.
    expect(keys[0]).toBe(
      keys.find((_, index) => events[index].patient?.document === '22.222.222-2')
    );
  });

  it('uses one display name per staff member and drops duplicate documents', () => {
    const events = normalizeAuditTrailEvents([
      auditLog({ id: 'a', userDisplayName: 'Daniel Opazo' }),
      auditLog({ id: 'b', userDisplayName: 'Daniel Opazo Damiani' }),
      auditLog({ id: 'c', userDisplayName: 'Daniel Opazo Damiani' }),
      auditLog({ id: 'c', userDisplayName: 'Daniel Opazo Damiani' }),
      auditLog({ id: 'd', userId: 'mobile-qr-upload', userDisplayName: undefined }),
    ]);

    expect(events).toHaveLength(4);
    expect(new Set(events.slice(0, 3).map(event => event.actor.name))).toEqual(
      new Set(['Daniel Opazo Damiani'])
    );
    expect(events.find(event => event.id === 'd')?.actor.name).toBe('Carga móvil QR');
  });
});
