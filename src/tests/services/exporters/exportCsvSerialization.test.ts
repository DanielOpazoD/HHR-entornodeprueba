// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildDailyRecordCsv } from '@/services/exporters/exportCsvSerialization';
import { CSV_HEADERS } from '@/constants/export';
import { BEDS } from '@/constants/beds';
import type { DailyRecordCsvExportState } from '@/types/domain/dailyRecordSlices';

describe('exportCsvSerialization', () => {
  it('exports UPC as SI when the checklist is current even if legacy isUPC is stale', () => {
    const emptyBeds = Object.fromEntries(
      BEDS.map(bed => [
        bed.id,
        {
          bedId: bed.id,
          patientName: '',
          rut: '',
          birthDate: '',
          age: '',
          biologicalSex: '',
          insurance: '',
          admissionOrigin: '',
          admissionOriginDetails: '',
          origin: '',
          isRapanui: false,
          pathology: '',
          diagnosisComments: '',
          specialty: '',
          status: '',
          admissionDate: '',
          hasWristband: false,
          devices: [],
          surgicalComplication: false,
          isUPC: false,
          isBlocked: false,
          bedMode: 'Cama',
          hasCompanionCrib: false,
        },
      ])
    );

    const record = {
      date: '2026-04-18',
      beds: {
        ...emptyBeds,
        R1: {
          bedId: 'R1',
          patientName: 'Paciente UPC',
          rut: '12.345.678-9',
          birthDate: '1980-01-01',
          age: '46',
          biologicalSex: 'Masculino',
          insurance: 'Fonasa',
          admissionOrigin: '',
          admissionOriginDetails: '',
          origin: '',
          isRapanui: false,
          pathology: 'Diagnóstico',
          diagnosisComments: '',
          specialty: 'Medicina',
          status: 'Estable',
          admissionDate: '2026-04-18',
          hasWristband: true,
          devices: [],
          surgicalComplication: false,
          isUPC: false,
          isBlocked: false,
          bedMode: 'Cama',
          hasCompanionCrib: false,
          upcChecklist: {
            classification: 'UPC_UCI',
            uciCriteria: ['uci_vmi'],
            utiCriteria: [],
            evaluatedAt: '2026-04-18T10:00:00Z',
          },
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      nurses: [],
      nursesDayShift: [],
      nursesNightShift: [],
      tensDayShift: [],
      tensNightShift: [],
      activeExtraBeds: [],
      lastUpdated: '2026-04-18T10:00:00.000Z',
    } as unknown as DailyRecordCsvExportState;

    const [, row] = buildDailyRecordCsv(record).trim().split('\n');
    const values = row.split(',');
    const upcColumn = CSV_HEADERS.indexOf('UPC');

    expect(values[upcColumn]).toBe('SI');
  });

  it('exports day-shift nurse vacancies with the canonical label', () => {
    const emptyBeds = Object.fromEntries(
      BEDS.map(bed => [
        bed.id,
        {
          bedId: bed.id,
          patientName: '',
          rut: '',
          birthDate: '',
          age: '',
          biologicalSex: '',
          insurance: '',
          admissionOrigin: '',
          admissionOriginDetails: '',
          origin: '',
          isRapanui: false,
          pathology: '',
          diagnosisComments: '',
          specialty: '',
          status: '',
          admissionDate: '',
          hasWristband: false,
          devices: [],
          surgicalComplication: false,
          isUPC: false,
          isBlocked: false,
          bedMode: 'Cama',
          hasCompanionCrib: false,
        },
      ])
    );

    const record = {
      date: '2026-04-18',
      beds: {
        ...emptyBeds,
        R1: {
          bedId: 'R1',
          patientName: 'Paciente Export',
          rut: '12.345.678-9',
          birthDate: '1980-01-01',
          age: '46',
          biologicalSex: 'Masculino',
          insurance: 'Fonasa',
          admissionOrigin: '',
          admissionOriginDetails: '',
          origin: '',
          isRapanui: false,
          pathology: 'Diagnóstico',
          diagnosisComments: '',
          specialty: 'Medicina',
          status: 'Estable',
          admissionDate: '2026-04-18',
          hasWristband: true,
          devices: [],
          surgicalComplication: false,
          isUPC: false,
          isBlocked: false,
          bedMode: 'Cama',
          hasCompanionCrib: false,
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      nurses: [],
      nursesDayShift: ['Enf Base', '--'],
      nursesNightShift: [],
    } as unknown as DailyRecordCsvExportState;

    const [, row] = buildDailyRecordCsv(record).trim().split('\n');
    const values = row.split(',');
    const nursesColumn = CSV_HEADERS.indexOf('Enfermero/a');

    expect(values[nursesColumn]).toBe('Enf Base & Vacante');
  });

  it('escapes commas, quotes, and carriage returns across discharge and transfer columns', () => {
    const record = {
      date: '2026-04-18',
      beds: {},
      discharges: [
        {
          id: 'd1',
          bedName: 'Sala, 1',
          bedId: 'R1',
          bedType: 'MEDIA',
          patientName: 'Paciente "Uno"',
          rut: '12.345.678-9',
          diagnosis: 'Dolor\ragudo',
          time: '10:00',
          status: 'Vivo, estable',
          age: '40',
          insurance: 'Fonasa, B',
        },
      ],
      transfers: [
        {
          id: 't1',
          bedName: 'Sala, 2',
          bedId: 'R2',
          bedType: 'UCI',
          patientName: 'Paciente Dos',
          rut: '11.111.111-1',
          diagnosis: 'Control',
          time: '12:00',
          evacuationMethod: 'Avión, comercial',
          receivingCenter: 'Hospital Salvador',
          transferEscort: 'Enfermera',
          age: '50',
          insurance: 'Isapre, X',
        },
      ],
      cma: [],
      nurses: [],
      nursesDayShift: [],
      nursesNightShift: [],
    } as unknown as DailyRecordCsvExportState;

    const csv = buildDailyRecordCsv(record);

    expect(csv).toContain(
      '"Sala, 1",MEDIA,"Paciente ""Uno""",12.345.678-9,"Dolor\ragudo","Vivo, estable",40,"Fonasa, B"'
    );
    expect(csv).toContain(
      '"Sala, 2",UCI,Paciente Dos,11.111.111-1,Control,"Avión, comercial",Hospital Salvador,Enfermera,50,"Isapre, X"'
    );
  });
});
