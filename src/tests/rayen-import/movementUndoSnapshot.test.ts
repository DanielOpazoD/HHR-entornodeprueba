import { describe, expect, it } from 'vitest';
import { buildMovementUndoSnapshot } from '@/utils/movementUndoSnapshot';

describe('buildMovementUndoSnapshot', () => {
  it('excluye el caché de sincronización y conserva los datos clínicos visibles', () => {
    const patient = {
      patientName: 'Paciente Egresada',
      rut: '11.111.111-1',
      clinicalSyncCheckpoint: { version: 3, fingerprintVersion: 1, sources: {} },
      vitalSignsHistory: [{ takenAt: '2026-08-31T08:00:00', pa: '120/80' }],
      evaluationScores: { braden: [{ score: 17 }] },
      deviceDetails: { 'VVP#1': { installationDate: '2026-08-30' } },
    };

    const snapshot = buildMovementUndoSnapshot(patient);

    expect(snapshot).not.toHaveProperty('clinicalSyncCheckpoint');
    expect(snapshot.vitalSignsHistory).toEqual(patient.vitalSignsHistory);
    expect(snapshot.evaluationScores).toEqual(patient.evaluationScores);
    expect(snapshot.deviceDetails).toEqual(patient.deviceDetails);
    // Copia profunda: mutar el snapshot no toca al paciente en cama.
    snapshot.vitalSignsHistory[0].pa = 'mutado';
    expect(patient.vitalSignsHistory[0].pa).toBe('120/80');
  });
});
