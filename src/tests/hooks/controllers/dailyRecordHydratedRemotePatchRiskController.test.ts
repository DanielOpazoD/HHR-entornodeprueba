import { describe, expect, it } from 'vitest';
import { classifyHydratedRemotePatchRisk } from '@/hooks/controllers/dailyRecordHydratedRemotePatchRiskController';
import { DataFactory } from '@/tests/factories/DataFactory';
import { PatientStatus } from '@/types/domain/patientClassification';

describe('dailyRecordHydratedRemotePatchRiskController', () => {
  it('allows independent clinical fields after remote hydration', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2026-05-16');
    const hydratedRecord = DataFactory.createMockDailyRecord('2026-05-16');
    previousRecord.beds.R1.pathology = 'Diagnóstico local';
    hydratedRecord.beds.R1.pathology = 'Diagnóstico remoto';

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R1.status': PatientStatus.GRAVE,
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('independent_field');
  });

  it('blocks same field and same clinical group patches after remote hydration', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2026-05-16');
    const hydratedRecord = DataFactory.createMockDailyRecord('2026-05-16');
    previousRecord.beds.R1.pathology = 'Diagnóstico local';
    hydratedRecord.beds.R1.pathology = 'Diagnóstico remoto';

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R1.pathology': 'Diagnóstico usuario',
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('same_field');

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R1.cie10Code': 'I10',
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('same_group');
  });

  it('blocks patches when the remote patient episode visibly changed', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2026-05-16');
    const hydratedRecord = DataFactory.createMockDailyRecord('2026-05-16');
    previousRecord.beds.R1.patientName = 'Paciente local';
    hydratedRecord.beds.R1.patientName = 'Paciente remoto';

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R1.status': PatientStatus.GRAVE,
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('episode_changed');
  });

  it('allows isolated clinicalEpisodeId repairs when visible episode data is unchanged', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2026-05-16');
    const hydratedRecord = DataFactory.createMockDailyRecord('2026-05-16');
    previousRecord.beds.R1.clinicalEpisodeId = 'episode-local';
    hydratedRecord.beds.R1.clinicalEpisodeId = 'episode-remote';

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R1.status': PatientStatus.GRAVE,
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('independent_field');
  });

  it('allows an empty-bed admission patch when Firebase already confirms the same new patient', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2026-05-16');
    const hydratedRecord = DataFactory.createMockDailyRecord('2026-05-16');
    hydratedRecord.lastUpdated = '2026-05-16T10:30:00.000Z';
    hydratedRecord.beds.R3 = DataFactory.createMockPatient('R3', {
      patientName: 'Paciente Nuevo',
      rut: '17.752.753-K',
      admissionDate: '2026-05-16',
      pathology: 'Diagnóstico inicial',
      specialty: 'Med Interna',
      status: PatientStatus.ESTABLE,
    });

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R3.patientName': 'Paciente Nuevo',
          'beds.R3.rut': '17.752.753-K',
          'beds.R3.admissionDate': '2026-05-16',
          'beds.R3.pathology': 'Diagnóstico inicial',
          'beds.R3.specialty': 'Med Interna',
          'beds.R3.status': PatientStatus.ESTABLE,
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('independent_field');
  });

  it('allows first status and specialty edits after Firebase confirms a newly created patient', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2026-05-16');
    const hydratedRecord = DataFactory.createMockDailyRecord('2026-05-16');
    hydratedRecord.lastUpdated = '2026-05-16T10:30:00.000Z';
    hydratedRecord.beds.R3 = DataFactory.createMockPatient('R3', {
      patientName: 'Paciente Nuevo',
      rut: '17.752.753-K',
      admissionDate: '2026-05-16',
      clinicalEpisodeId: 'episode-new',
      specialty: '',
      status: undefined,
    });

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R3.status': PatientStatus.ESTABLE,
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('independent_field');

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R3.specialty': 'Med Interna',
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('independent_field');
  });

  it('allows the first diagnosis edit after Firebase confirms a newly created patient', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2026-05-16');
    const hydratedRecord = DataFactory.createMockDailyRecord('2026-05-16');
    hydratedRecord.lastUpdated = '2026-05-16T10:30:00.000Z';
    hydratedRecord.beds.R3 = DataFactory.createMockPatient('R3', {
      patientName: 'Paciente Nuevo',
      rut: '17.752.753-K',
      admissionDate: '2026-05-16',
      clinicalEpisodeId: 'episode-new',
      pathology: '',
    });

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R3.pathology': 'Diagnóstico inicial',
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('independent_field');
  });

  it('blocks overwriting a hydrated diagnosis for a newly created patient', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2026-05-16');
    const hydratedRecord = DataFactory.createMockDailyRecord('2026-05-16');
    hydratedRecord.lastUpdated = '2026-05-16T10:30:00.000Z';
    hydratedRecord.beds.R3 = DataFactory.createMockPatient('R3', {
      patientName: 'Paciente Nuevo',
      rut: '17.752.753-K',
      admissionDate: '2026-05-16',
      clinicalEpisodeId: 'episode-new',
      pathology: 'Diagnóstico Firebase',
    });

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R3.pathology': 'Diagnóstico usuario',
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('episode_changed');
  });

  it('allows editing a newly created clinical crib after Firebase confirms it', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2026-05-16');
    previousRecord.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Madre',
      clinicalCrib: undefined,
    });
    const hydratedRecord = {
      ...previousRecord,
      lastUpdated: '2026-05-16T10:30:00.000Z',
      beds: {
        ...previousRecord.beds,
        R1: {
          ...previousRecord.beds.R1,
          clinicalCrib: DataFactory.createMockPatient('R1', {
            patientName: 'RN de Madre',
            bedMode: 'Cuna',
          }),
        },
      },
    };

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R1.clinicalCrib.patientName': 'RN actualizado',
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('independent_field');
  });

  it('allows clinical crib status and specialty edits after a crib diagnosis hydration', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2026-05-16');
    previousRecord.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Madre',
      clinicalCrib: DataFactory.createMockPatient('R1', {
        patientName: 'RN de Madre',
        bedMode: 'Cuna',
        pathology: 'Diagnóstico local',
      }),
    });
    const hydratedRecord = {
      ...previousRecord,
      lastUpdated: '2026-05-16T10:30:00.000Z',
      beds: {
        ...previousRecord.beds,
        R1: {
          ...previousRecord.beds.R1,
          clinicalCrib: {
            ...previousRecord.beds.R1.clinicalCrib!,
            pathology: 'Diagnóstico Firebase',
          },
        },
      },
    };

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R1.clinicalCrib.status': PatientStatus.ESTABLE,
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('independent_field');

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R1.clinicalCrib.specialty': 'Neonatología',
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('independent_field');

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R1.clinicalCrib.cie10Code': 'P22',
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('same_group');
  });

  it('allows full-bed move patches after self-confirmed remote hydration', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2026-05-16');
    previousRecord.beds.R2 = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente trasladado',
      rut: '12.345.678-9',
      clinicalEpisodeId: 'episode-r2',
    });
    previousRecord.beds.R3.location = 'Sala R3';
    const hydratedRecord = {
      ...previousRecord,
      lastUpdated: '2026-05-16T10:30:00.000Z',
    };

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R3': {
            ...previousRecord.beds.R2,
            bedId: 'R3',
            location: previousRecord.beds.R3.location,
          },
          'beds.R2': {
            ...previousRecord.beds.R2,
            patientName: '',
            rut: '',
            clinicalEpisodeId: undefined,
          },
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('independent_field');
  });

  it('blocks full-bed move patches when the hydrated source bed changed remotely', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2026-05-16');
    previousRecord.beds.R2 = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente local',
      rut: '12.345.678-9',
      clinicalEpisodeId: 'episode-local',
    });
    const hydratedRecord = DataFactory.createMockDailyRecord('2026-05-16');
    hydratedRecord.beds.R2 = {
      ...previousRecord.beds.R2,
      patientName: 'Paciente remoto',
      clinicalEpisodeId: 'episode-remoto',
    };

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          'beds.R3': {
            ...previousRecord.beds.R2,
            bedId: 'R3',
            location: previousRecord.beds.R3.location,
          },
          'beds.R2': {
            ...previousRecord.beds.R2,
            patientName: '',
            rut: '',
            clinicalEpisodeId: undefined,
          },
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('episode_changed');
  });

  it('allows movement patches when hydration did not change movement lists or source bed', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2026-05-16');
    previousRecord.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Alta',
      rut: '12.345.678-9',
      clinicalEpisodeId: 'episode-alta',
    });
    const hydratedRecord = {
      ...previousRecord,
      lastUpdated: '2026-05-16T10:30:00.000Z',
    };
    const emptyBed = DataFactory.createMockPatient('R1', {
      patientName: '',
      rut: '',
      clinicalEpisodeId: undefined,
    });
    const discharge = DataFactory.createMockDischarge({
      id: 'discharge-1',
      bedId: 'R1',
      patientName: 'Paciente Alta',
      rut: '12.345.678-9',
      clinicalEpisodeId: 'episode-alta',
    });

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          discharges: [discharge],
          'beds.R1': emptyBed,
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('independent_field');
  });

  it('blocks movement patches when Firebase changed the same movement list first', () => {
    const previousRecord = DataFactory.createMockDailyRecord('2026-05-16');
    const hydratedRecord = {
      ...previousRecord,
      lastUpdated: '2026-05-16T10:30:00.000Z',
      cma: [DataFactory.createMockCMA({ id: 'remote-cma-1' })],
    };

    expect(
      classifyHydratedRemotePatchRisk({
        attemptedPatch: {
          cma: [DataFactory.createMockCMA({ id: 'local-cma-1' })],
        },
        previousRecord,
        hydratedRecord,
      })
    ).toBe('movement_changed');
  });
});
