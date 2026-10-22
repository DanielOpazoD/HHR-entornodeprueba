import type { AuditLogEntry } from '@/types/audit';

/** A synthetic hospital day (22-10-2026, Rapa Nui UTC-5): no real people or patients. */
const at = (clock: string) => `2026-10-22T${clock}:00.000Z`;

const ANA = {
  userId: 'ana.soto@hospital.test',
  userDisplayName: 'Ana Soto',
  sessionId: 'conn-ana',
  device: 'Chrome · Windows',
  ipAddress: '190.20.1.15',
};
const LUIS = {
  userId: 'luis.rojas@hospital.test',
  userDisplayName: 'Dr. Luis Rojas',
  sessionId: 'conn-luis',
  device: 'Edge · Windows',
  ipAddress: '190.20.1.22',
};
const PAZ = {
  userId: 'paz.tuki@hospital.test',
  userDisplayName: 'Paz Tuki',
  sessionId: 'conn-paz',
  device: 'Safari · iOS',
  ipAddress: '181.43.9.7',
};

let sequence = 0;
const event = (
  actor: typeof ANA,
  clock: string,
  entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'userId'>
): AuditLogEntry => ({
  id: `story-${(sequence += 1)}`,
  timestamp: at(clock),
  ...actor,
  ...entry,
});

const patient = (name: string, rut: string, bedId: string) => ({ patientName: name, rut, bedId });
const JOSE = patient('José Pakarati', '12.345.678-5', 'H3C2');
const MARIA = patient('María Hey', '9.876.543-2', 'H1C1');
const RN = patient('RN Hey', '9.876.543-2', 'H1C1-crib');

export const AUDIT_TRAIL_STORY_LOGS: AuditLogEntry[] = [
  event(ANA, '12:02', {
    action: 'USER_LOGIN',
    entityType: 'user',
    entityId: ANA.userId,
    details: { start: 'sign_in' },
  }),
  event(ANA, '12:10', {
    action: 'PATIENT_ADMITTED',
    entityType: 'patient',
    entityId: 'H3C2',
    details: JOSE,
  }),
  event(ANA, '12:14', {
    action: 'PATIENT_DIAGNOSIS_CHANGED',
    entityType: 'patient',
    entityId: 'H3C2',
    details: { ...JOSE, changes: { diagnosis: { old: 'Neumonía', new: 'Neumonía grave' } } },
  }),
  event(ANA, '12:16', {
    action: 'PATIENT_MODIFIED',
    entityType: 'patient',
    entityId: 'H3C2',
    details: { ...JOSE, changes: { insurance: { old: 'Fonasa A', new: 'Fonasa B' } } },
  }),
  event(ANA, '13:40', {
    action: 'CUDYR_MODIFIED',
    entityType: 'patient',
    entityId: 'H1C1-crib',
    details: { ...RN, changes: { feeding: { old: 1, new: 3 }, vitalSigns: { old: 2, new: 3 } } },
  }),
  event(ANA, '14:05', {
    action: 'NURSE_HANDOFF_MODIFIED',
    entityType: 'patient',
    entityId: 'H1C1',
    details: {
      ...MARIA,
      shift: 'day',
      changes: {
        handoffNoteDayShift: {
          old: 'Estable, sin fiebre.',
          new: 'Estable, sin fiebre. Se retira vía venosa periférica; queda con alimentación oral completa.',
        },
      },
    },
  }),
  event(ANA, '15:05', {
    action: 'CONNECTION_INTERRUPTED',
    entityType: 'user',
    entityId: ANA.userId,
    details: { offlineFrom: at('14:57'), offlineTo: at('15:05'), durationSeconds: 480 },
  }),
  event(ANA, '17:30', {
    action: 'USER_LOGOUT',
    entityType: 'user',
    entityId: ANA.userId,
    details: { reason: 'manual', startedAt: at('12:02'), durationSeconds: 19_680 },
  }),
  event(LUIS, '13:00', {
    action: 'USER_LOGIN',
    entityType: 'user',
    entityId: LUIS.userId,
    details: { start: 'sign_in' },
  }),
  event(LUIS, '13:05', {
    action: 'VIEW_PATIENT',
    entityType: 'patient',
    entityId: 'H3C2',
    details: JOSE,
  }),
  event(LUIS, '13:12', {
    action: 'VIEW_PATIENT',
    entityType: 'patient',
    entityId: 'H3C2',
    details: JOSE,
  }),
  event(LUIS, '13:20', {
    action: 'MEDICAL_HANDOFF_MODIFIED',
    entityType: 'patient',
    entityId: 'H3C2',
    details: {
      ...JOSE,
      changes: {
        medicalHandoffNote: {
          old: '',
          new: 'Inicia ceftriaxona. Control de gases mañana.',
        },
      },
    },
  }),
  event(LUIS, '16:45', {
    action: 'PATIENT_DISCHARGED',
    entityType: 'discharge',
    entityId: 'H1C1',
    details: { ...MARIA, status: 'Vivo · domicilio' },
  }),
  event(LUIS, '16:58', {
    action: 'PATIENT_CLEARED',
    entityType: 'patient',
    entityId: 'H4C1',
    details: patient('Pedro Atán', '15.555.444-1', 'H4C1'),
  }),
  event(PAZ, '19:30', {
    action: 'USER_LOGIN',
    entityType: 'user',
    entityId: PAZ.userId,
    details: { start: 'resume' },
  }),
  event(PAZ, '19:42', {
    action: 'PATIENT_BED_CHANGED',
    entityType: 'patient',
    entityId: 'H2C3',
    details: {
      ...patient('José Pakarati', '12.345.678-5', 'H2C3'),
      movementKind: 'move',
      sourceBed: 'H3C2',
      targetBed: 'H2C3',
    },
  }),
  event(PAZ, '20:15', {
    action: 'CONFLICT_AUTO_MERGED',
    entityType: 'dailyRecord',
    entityId: '2026-10-22',
    details: {
      entryCount: 2,
      assessment: { riskLevel: 'low', reviewRecommended: false },
      conflictResolutionSummary: {
        truthSource: 'authority_intent_invariants',
        lastWriteWins: false,
        mergedPaths: ['beds.H2C3.pathology'],
        blockedPaths: ['beds.H2C3.patientName'],
      },
      snapshotRecovery: { status: 'saved', snapshotIds: ['snap-1'] },
    },
  }),
];
