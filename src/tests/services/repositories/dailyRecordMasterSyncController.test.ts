import { describe, expect, it } from 'vitest';
import {
  buildAdmissionHospitalizationAppendPayload,
  buildAdmissionHospitalizationSyncPlan,
  buildAdmissionPatientMasterPatch,
  buildDischargeHospitalizationAppendPayload,
  buildDischargeHospitalizationSyncPlan,
  buildDischargePatientMasterPatch,
  buildEgresoRealtimeEvent,
  buildIngresoRealtimeEvent,
  buildPatientMasterSeed,
  resolveAdmissionBackfillAppendPayload,
  buildTransferHospitalizationSyncPlan,
  buildTransferHospitalizationAppendPayload,
  buildTrasladoRealtimeEvent,
} from '@/services/repositories/dailyRecordMasterSyncController';

describe('dailyRecordMasterSyncController', () => {
  it('builds normalized patient master seed', () => {
    expect(
      buildPatientMasterSeed({
        rut: '1-9',
        fullName: 'Paciente',
        birthDate: null,
        forecast: 'FONASA',
        gender: null,
      })
    ).toEqual({
      rut: '1-9',
      fullName: 'Paciente',
      birthDate: undefined,
      forecast: 'FONASA',
      gender: undefined,
    });
  });

  it('captures the Rayen encId as lastClinicalEpisodeId when present, omits it otherwise', () => {
    expect(
      buildPatientMasterSeed({ rut: '1-9', fullName: 'Paciente', clinicalEpisodeId: '141181' })
    ).toMatchObject({ rut: '1-9', lastClinicalEpisodeId: '141181' });

    // Absent / stub (e.g. a discharge that lost the id) → no key, so a merge write never clobbers a
    // previously captured id.
    expect(buildPatientMasterSeed({ rut: '1-9', fullName: 'Paciente' })).not.toHaveProperty(
      'lastClinicalEpisodeId'
    );
    expect(
      buildPatientMasterSeed({ rut: '1-9', fullName: 'Paciente', clinicalEpisodeId: null })
    ).not.toHaveProperty('lastClinicalEpisodeId');
  });

  it('builds realtime hospitalization events with fallback diagnosis', () => {
    expect(
      buildIngresoRealtimeEvent({ date: '2026-04-14', diagnosis: null, bedName: 'R1' })
    ).toEqual({
      id: '2026-04-14-ingreso-rt',
      type: 'Ingreso',
      date: '2026-04-14',
      diagnosis: 'S/D',
      bedName: 'R1',
    });

    expect(
      buildEgresoRealtimeEvent({ date: '2026-04-14', diagnosis: 'Dx', bedName: 'R2' })
    ).toEqual({
      id: '2026-04-14-egreso-rt',
      type: 'Egreso',
      date: '2026-04-14',
      diagnosis: 'Dx',
      bedName: 'R2',
    });

    expect(
      buildTrasladoRealtimeEvent({
        date: '2026-04-14',
        diagnosis: 'Dx',
        bedName: 'R3',
        receivingCenter: 'Base',
      })
    ).toEqual({
      id: '2026-04-14-traslado-rt',
      type: 'Traslado',
      date: '2026-04-14',
      diagnosis: 'Dx',
      bedName: 'R3',
      receivingCenter: 'Base',
    });
  });

  it('builds master patches for admission and discharge state', () => {
    expect(buildAdmissionPatientMasterPatch('2026-04-14')).toEqual({
      lastAdmission: '2026-04-14',
    });
    expect(buildAdmissionPatientMasterPatch(null)).toEqual({});
    expect(buildDischargePatientMasterPatch({ date: '2026-04-14', status: 'Fallecido' })).toEqual({
      lastDischarge: '2026-04-14',
      vitalStatus: 'Fallecido',
    });
  });

  it('builds append payloads for admission, discharge, and transfer syncs', () => {
    expect(
      buildAdmissionHospitalizationAppendPayload({
        rut: '1-9',
        fullName: 'Paciente',
        birthDate: null,
        forecast: 'FONASA',
        gender: 'F',
        date: '2026-04-14',
        diagnosis: 'Dx',
        bedName: 'R1',
      })
    ).toEqual({
      patient: {
        rut: '1-9',
        fullName: 'Paciente',
        birthDate: undefined,
        forecast: 'FONASA',
        gender: 'F',
      },
      event: {
        id: '2026-04-14-ingreso-rt',
        type: 'Ingreso',
        date: '2026-04-14',
        diagnosis: 'Dx',
        bedName: 'R1',
      },
      extra: {
        lastAdmission: '2026-04-14',
      },
    });

    expect(
      buildDischargeHospitalizationAppendPayload({
        rut: '1-9',
        fullName: 'Paciente',
        forecast: 'FONASA',
        date: '2026-04-14',
        diagnosis: 'Dx',
        bedName: 'R1',
        status: 'Fallecido',
      })
    ).toEqual({
      patient: {
        rut: '1-9',
        fullName: 'Paciente',
        birthDate: undefined,
        forecast: 'FONASA',
        gender: undefined,
      },
      event: {
        id: '2026-04-14-egreso-rt',
        type: 'Egreso',
        date: '2026-04-14',
        diagnosis: 'Dx',
        bedName: 'R1',
      },
      extra: {
        lastDischarge: '2026-04-14',
        vitalStatus: 'Fallecido',
      },
    });

    expect(
      buildTransferHospitalizationAppendPayload({
        rut: '1-9',
        fullName: 'Paciente',
        date: '2026-04-14',
        diagnosis: 'Dx',
        bedName: 'R1',
        receivingCenter: 'Base',
      })
    ).toEqual({
      patient: {
        rut: '1-9',
        fullName: 'Paciente',
        birthDate: undefined,
        forecast: undefined,
        gender: undefined,
      },
      event: {
        id: '2026-04-14-traslado-rt',
        type: 'Traslado',
        date: '2026-04-14',
        diagnosis: 'Dx',
        bedName: 'R1',
        receivingCenter: 'Base',
      },
    });
  });

  it('builds an admission sync plan only when bed patients carry rut and admission date', () => {
    expect(
      buildAdmissionHospitalizationSyncPlan({
        rut: '1-9',
        patientName: 'Paciente',
        birthDate: null,
        insurance: 'FONASA',
        biologicalSex: 'F',
        admissionDate: '2026-04-14',
        pathology: 'Dx',
        bedId: 'R1',
      })
    ).toEqual({
      appendPayload: {
        patient: {
          rut: '1-9',
          fullName: 'Paciente',
          birthDate: undefined,
          forecast: 'FONASA',
          gender: 'F',
        },
        event: {
          id: '2026-04-14-ingreso-rt',
          type: 'Ingreso',
          date: '2026-04-14',
          diagnosis: 'Dx',
          bedName: 'R1',
        },
        extra: {
          lastAdmission: '2026-04-14',
        },
      },
    });

    expect(
      buildAdmissionHospitalizationSyncPlan({
        rut: '1-9',
        patientName: 'Paciente',
        admissionDate: null,
      })
    ).toBeNull();
  });

  it('resolves realtime admission backfill payloads only when the patient is missing from current beds', () => {
    expect(
      resolveAdmissionBackfillAppendPayload({
        existingBedPatientRuts: new Set(['1-9']),
        rut: '1-9',
        fullName: 'Paciente',
        admissionDate: '2026-04-14',
        diagnosis: 'Dx',
        bedName: 'R1',
      })
    ).toBeNull();

    expect(
      resolveAdmissionBackfillAppendPayload({
        existingBedPatientRuts: new Set(),
        rut: '1-9',
        fullName: 'Paciente',
        admissionDate: '2026-04-14',
        diagnosis: 'Dx',
        bedName: 'R1',
      })
    ).toEqual({
      patient: {
        rut: '1-9',
        fullName: 'Paciente',
        birthDate: undefined,
        forecast: undefined,
        gender: undefined,
      },
      event: {
        id: '2026-04-14-ingreso-rt',
        type: 'Ingreso',
        date: '2026-04-14',
        diagnosis: 'Dx',
        bedName: 'R1',
      },
      extra: {
        lastAdmission: '2026-04-14',
      },
    });
  });

  it('builds discharge and transfer sync plans with optional admission backfill payloads', () => {
    expect(
      buildDischargeHospitalizationSyncPlan({
        existingBedPatientRuts: new Set(),
        recordDate: '2026-04-14',
        discharge: {
          rut: '1-9',
          patientName: 'Paciente',
          insurance: 'FONASA',
          diagnosis: 'Dx',
          bedName: 'R1',
          status: 'Fallecido',
          admissionDate: '2026-04-10',
        },
      })
    ).toEqual({
      appendPayload: {
        patient: {
          rut: '1-9',
          fullName: 'Paciente',
          birthDate: undefined,
          forecast: 'FONASA',
          gender: undefined,
        },
        event: {
          id: '2026-04-14-egreso-rt',
          type: 'Egreso',
          date: '2026-04-14',
          diagnosis: 'Dx',
          bedName: 'R1',
        },
        extra: {
          lastDischarge: '2026-04-14',
          vitalStatus: 'Fallecido',
        },
      },
      admissionBackfillPayload: {
        patient: {
          rut: '1-9',
          fullName: 'Paciente',
          birthDate: undefined,
          forecast: undefined,
          gender: undefined,
        },
        event: {
          id: '2026-04-10-ingreso-rt',
          type: 'Ingreso',
          date: '2026-04-10',
          diagnosis: 'Dx',
          bedName: 'R1',
        },
        extra: {
          lastAdmission: '2026-04-10',
        },
      },
    });

    expect(
      buildTransferHospitalizationSyncPlan({
        existingBedPatientRuts: new Set(['1-9']),
        recordDate: '2026-04-14',
        transfer: {
          rut: '1-9',
          patientName: 'Paciente',
          diagnosis: 'Dx',
          bedName: 'R1',
          receivingCenter: 'Base',
          admissionDate: '2026-04-10',
        },
      })
    ).toEqual({
      appendPayload: {
        patient: {
          rut: '1-9',
          fullName: 'Paciente',
          birthDate: undefined,
          forecast: undefined,
          gender: undefined,
        },
        event: {
          id: '2026-04-14-traslado-rt',
          type: 'Traslado',
          date: '2026-04-14',
          diagnosis: 'Dx',
          bedName: 'R1',
          receivingCenter: 'Base',
        },
      },
      admissionBackfillPayload: null,
    });
  });
});
