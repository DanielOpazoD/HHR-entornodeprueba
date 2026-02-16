import { describe, expect, it } from 'vitest';
import { calculateMinsalStats } from '@/services/calculations/minsalStatsCalculator';
import { Specialty, PatientStatus, type DailyRecord, type PatientData } from '@/types';
import { BEDS } from '@/constants';

const createBeds = (): Record<string, PatientData> => {
  const beds: Record<string, PatientData> = {};

  BEDS.forEach((bed, index) => {
    const hasPatient = index === 0;
    beds[bed.id] = {
      bedId: bed.id,
      bedName: bed.name,
      isBlocked: false,
      patientName: hasPatient ? 'Paciente Demo' : '',
      rut: hasPatient ? '11.111.111-1' : '',
      pathology: hasPatient ? 'Diagnóstico' : '',
      specialty: hasPatient ? Specialty.MEDICINA : Specialty.EMPTY,
      status: hasPatient ? PatientStatus.ESTABLE : PatientStatus.EMPTY,
      admissionDate: hasPatient ? '2026-02-01' : '',
      admissionTime: hasPatient ? '08:00' : '',
      age: hasPatient ? '45' : '',
      bedMode: 'Cama',
      hasCompanionCrib: false,
      hasWristband: true,
      devices: [],
      surgicalComplication: false,
      isUPC: false,
    };
  });

  return beds;
};

describe('calculateMinsalStats transfer method breakdown', () => {
  it('counts Aerocardal and FACH transfers and exposes traceability lists by specialty', () => {
    const record: DailyRecord = {
      date: '2026-02-10',
      beds: createBeds(),
      discharges: [],
      transfers: [
        {
          id: 't1',
          bedName: 'UTI 1',
          bedId: 'bed-1',
          bedType: 'UTI',
          patientName: 'Paciente A',
          rut: '11.111.111-1',
          diagnosis: 'Diag A',
          time: '10:00',
          evacuationMethod: 'Aerocardal',
          receivingCenter: 'Centro A',
          originalData: {
            ...createBeds()[BEDS[0].id],
            patientName: 'Paciente A',
            rut: '11.111.111-1',
            specialty: Specialty.MEDICINA,
          },
        },
        {
          id: 't2',
          bedName: 'UTI 2',
          bedId: 'bed-2',
          bedType: 'UTI',
          patientName: 'Paciente B',
          rut: '22.222.222-2',
          diagnosis: 'Diag B',
          time: '11:00',
          evacuationMethod: 'Avión FACH',
          receivingCenter: 'Centro B',
          originalData: {
            ...createBeds()[BEDS[0].id],
            patientName: 'Paciente B',
            rut: '22.222.222-2',
            specialty: Specialty.MEDICINA,
          },
        },
      ],
      cma: [],
      lastUpdated: '2026-02-10T10:00:00.000Z',
      nurses: ['', ''],
      activeExtraBeds: [],
    };

    const stats = calculateMinsalStats([record], '2026-02-01', '2026-02-28');
    const medicina = stats.porEspecialidad.find(item => item.specialty === Specialty.MEDICINA);

    expect(medicina).toBeDefined();
    expect(medicina?.traslados).toBe(2);
    expect(medicina?.aerocardal).toBe(1);
    expect(medicina?.aerocardalList).toHaveLength(1);
    expect(medicina?.aerocardalList?.[0]?.name).toBe('Paciente A');
    expect(medicina?.fach).toBe(1);
    expect(medicina?.fachList).toHaveLength(1);
    expect(medicina?.fachList?.[0]?.name).toBe('Paciente B');
  });

  it('treats legacy "FACH" label as FACH transfer', () => {
    const record: DailyRecord = {
      date: '2026-02-10',
      beds: createBeds(),
      discharges: [],
      transfers: [
        {
          id: 't3',
          bedName: 'UTI 3',
          bedId: 'bed-3',
          bedType: 'UTI',
          patientName: 'Paciente C',
          rut: '33.333.333-3',
          diagnosis: 'Diag C',
          time: '12:00',
          evacuationMethod: 'FACH',
          receivingCenter: 'Centro C',
          originalData: {
            ...createBeds()[BEDS[0].id],
            patientName: 'Paciente C',
            rut: '33.333.333-3',
            specialty: Specialty.MEDICINA,
          },
        },
      ],
      cma: [],
      lastUpdated: '2026-02-10T12:00:00.000Z',
      nurses: ['', ''],
      activeExtraBeds: [],
    };

    const stats = calculateMinsalStats([record], '2026-02-01', '2026-02-28');
    const medicina = stats.porEspecialidad.find(item => item.specialty === Specialty.MEDICINA);

    expect(medicina?.fach).toBe(1);
    expect(medicina?.fachList?.[0]?.name).toBe('Paciente C');
  });
});
