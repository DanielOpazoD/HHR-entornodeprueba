import { describe, expect, it } from 'vitest';

import { buildUpcClinicalAnalytics } from '@/features/analytics/controllers/upcClinicalAnalyticsController';
import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const patient = (
  bedId: string,
  classification: 'UPC_UCI' | 'UPC_UTI',
  episode: string
): PatientData => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: `Paciente ${episode}`,
  rut: `RUT-${episode}`,
  age: '50',
  pathology: 'Diagnóstico de prueba',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-03-01',
  hasWristband: true,
  devices: [],
  surgicalComplication: false,
  isUPC: true,
  clinicalEpisodeId: episode,
  upcChecklist: {
    uciCriteria: classification === 'UPC_UCI' ? ['uci_vmi'] : [],
    utiCriteria: classification === 'UPC_UTI' ? ['uti_mon_cardiaca'] : [],
    classification,
    evaluatedAt: '2026-03-10T02:00:00.000Z',
  },
  cudyr: {
    changeClothes: 3,
    mobilization: 3,
    feeding: 3,
    elimination: 3,
    psychosocial: classification === 'UPC_UCI' ? 1 : 0,
    surveillance: 0,
    vitalSigns: 3,
    fluidBalance: 3,
    oxygenTherapy: 3,
    airway: 3,
    proInterventions: classification === 'UPC_UCI' ? 3 : 0,
    skinCare: classification === 'UPC_UCI' ? 3 : 0,
    pharmacology: classification === 'UPC_UCI' ? 1 : 0,
    invasiveElements: 0,
  },
});

const record = (date: string, beds: Record<string, PatientData>): DailyRecord =>
  ({ date, beds, discharges: [], transfers: [], cma: [] }) as DailyRecord;

const legacyPatient = (bedId: string, episode: string): PatientData => {
  const value = patient(bedId, 'UPC_UTI', episode);
  return { ...value, upcChecklist: undefined, isUPC: true };
};

describe('upcClinicalAnalyticsController', () => {
  it('separates structured UTI/UCI observations, unique patients and bed groups', () => {
    const analysis = buildUpcClinicalAnalytics([
      record('2026-03-10', { R1: patient('R1', 'UPC_UTI', 'episode-1') }),
      record('2026-03-11', {
        R1: patient('R1', 'UPC_UCI', 'episode-1'),
        NEO1: patient('NEO1', 'UPC_UTI', 'episode-2'),
      }),
    ]);

    expect(analysis).toMatchObject({
      uniquePatients: 2,
      uniqueUtiPatients: 2,
      uniqueUciPatients: 1,
      observations: 3,
      utiObservations: 2,
      uciObservations: 1,
      utiPercent: 66.7,
      uciPercent: 33.3,
      byBedGroup: [
        { key: 'adult_potential', uti: 1, uci: 1, total: 2 },
        { key: 'neonatal', uti: 1, uci: 0, total: 1 },
        { key: 'other', uti: 0, uci: 0, total: 0 },
      ],
    });
    expect(analysis.details[0]).toMatchObject({
      patientName: 'Paciente episode-1',
      classification: 'UPC_UTI',
      criteria: [
        'Monitorización cardíaca continua por riesgo arrítmico, inestabilidad eléctrica o hemodinámica',
      ],
    });
    expect(analysis.details[1]).toMatchObject({
      classification: 'UPC_UCI',
      criteria: ['Ventilación mecánica invasiva (VMI)'],
    });
  });

  it('assumes legacy UPC as UTI only before the cutoff and only in valid UPC beds', () => {
    const analysis = buildUpcClinicalAnalytics([
      record('2026-04-29', {
        R2: legacyPatient('R2', 'legacy-valid'),
        H6C1: legacyPatient('H6C1', 'legacy-invalid-bed'),
        H6C2: patient('H6C2', 'UPC_UCI', 'structured-invalid-bed'),
      }),
      record('2026-04-30', {
        R3: legacyPatient('R3', 'legacy-after-cutoff'),
      }),
    ]);

    expect(analysis).toMatchObject({
      uniquePatients: 1,
      observations: 1,
      utiObservations: 1,
      uciObservations: 0,
      assumedUtiObservations: 1,
    });
    expect(analysis.details).toHaveLength(1);
    expect(analysis.details[0]).toMatchObject({
      bedId: 'R2',
      classification: 'UPC_UTI',
      classificationSource: 'legacy_manual_upc',
      criteria: ['Registro manual “UPC” sin desglose UTI/UCI'],
    });
  });

  it('omits unidentifiable rows from totals and keeps records identified only by RUT', () => {
    const anonymous = {
      ...patient('R1', 'UPC_UCI', 'anonymous'),
      patientName: '',
      rut: '',
    };
    const rutOnly = {
      ...patient('R2', 'UPC_UTI', 'rut-only'),
      patientName: '',
      rut: '14.747.062-2',
    };

    const analysis = buildUpcClinicalAnalytics([
      record('2026-03-10', { R1: anonymous, R2: rutOnly }),
    ]);

    expect(analysis).toMatchObject({
      excludedUnidentifiedObservations: 1,
      observations: 1,
      uniquePatients: 1,
      utiObservations: 1,
      uciObservations: 0,
    });
    expect(analysis.details).toHaveLength(1);
    expect(analysis.details[0]).toMatchObject({ rut: '14.747.062-2', patientName: '' });
  });
});
