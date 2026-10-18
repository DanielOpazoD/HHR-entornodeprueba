import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import { previousCensusEgresoCandidates } from '@/features/rayen-import/domain/previousCensusEgresoCandidates';

const RUN = '28.106.852-0';
const reportDate = '2026-09-13';
const baseRow: EgresoReportRow = {
  run: RUN,
  patientName: 'Tania Cristina Valencia Ladino',
  bedLabel: 'H5C1',
  servicio: 'Ginecobstetricia',
  edad: '18 años',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '13-09-2026 10:00',
};

const previousRecord = (): DailyRecord =>
  ({
    date: '2026-09-12',
    beds: {
      H5C1: {
        ...EMPTY_PATIENT,
        bedId: 'H5C1',
        patientName: baseRow.patientName,
        rut: RUN,
        clinicalEpisodeId: '1001',
        admissionDate: '2026-09-12',
        admissionTime: '08:00',
        clinicalCrib: {
          ...EMPTY_PATIENT,
          bedId: 'H5C1',
          bedMode: 'Cuna',
          patientName: 'Rn De Tania Valencia Ladino',
          rut: RUN,
          clinicalEpisodeId: '1002',
          admissionDate: '2026-09-12',
          admissionTime: '08:05',
        },
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-09-12T20:00:00.000Z',
  }) as DailyRecord;

const newbornRow: EgresoReportRow = {
  ...baseRow,
  patientName: 'Rn De Tania Valencia Ladino',
  edad: '0 días',
};

describe('D-1 exact discharge candidates', () => {
  it.each([
    { date: '11-09-2026 10:00', expected: 0 },
    { date: '12-09-2026 10:00', expected: 0 },
    { date: '13-09-2026 10:00', expected: 0 },
    { date: '13-09-2026 15:00', expected: 1 },
    { date: '14-09-2026 10:00', expected: 0 },
    { date: '14-09-2026 06:10', correctedDay: reportDate, expected: 1 },
  ])(
    'bounds selected-census discovery to its clinical day: $date',
    ({ date, correctedDay, expected }) => {
      const selected = previousRecord();
      selected.date = reportDate;
      expect(
        previousCensusEgresoCandidates(
          selected,
          [{ ...baseRow, fechaEgreso: date, correctedDay }],
          reportDate
        )
      ).toHaveLength(expected);
    }
  );

  it.each(['E9876543', 'F9876543'])(
    'keeps the complete identifier when discovering discharge candidates: %s',
    reportIdentifier => {
      const previous = previousRecord();
      previous.beds.H5C1 = {
        ...previous.beds.H5C1,
        rut: 'E9876543',
        documentType: 'Pasaporte',
        clinicalCrib: undefined,
      };
      expect(
        previousCensusEgresoCandidates(
          previous,
          [{ ...baseRow, run: reportIdentifier }],
          reportDate
        )
      ).toHaveLength(reportIdentifier === 'E9876543' ? 1 : 0);
    }
  );

  it('separates mother and newborn sharing maternal RUN and discharge day by name', () => {
    expect(
      previousCensusEgresoCandidates(previousRecord(), [baseRow, newbornRow], reportDate)
    ).toEqual([
      expect.objectContaining({ encounterId: '1001', fromClinicalCrib: false }),
      expect.objectContaining({ encounterId: '1002', fromClinicalCrib: true }),
    ]);
  });

  it('fails closed when duplicate report names cannot identify one episode', () => {
    expect(
      previousCensusEgresoCandidates(previousRecord(), [baseRow, { ...baseRow }], reportDate)
    ).toEqual([]);
  });

  it('does not use a D+1 row or an occupant without exact episode identity', () => {
    const previous = previousRecord();
    previous.beds.H5C1.clinicalEpisodeId = undefined;
    expect(
      previousCensusEgresoCandidates(
        previous,
        [{ ...newbornRow, fechaEgreso: '14-09-2026 15:00' }],
        reportDate
      )
    ).toEqual([]);
  });
});

it('identifies a known nested newborn through maternal RUN without assigning that RUN personally', () => {
  const previous = previousRecord();
  previous.beds.H5C1.clinicalCrib!.rut = '';
  expect(previousCensusEgresoCandidates(previous, [newbornRow], reportDate)).toEqual([
    expect.objectContaining({
      encounterId: '1002',
      run: RUN,
      personalRun: '',
      fromClinicalCrib: true,
    }),
  ]);
  previous.beds.R3 = { ...previous.beds.H5C1, clinicalEpisodeId: '1003', clinicalCrib: undefined };
  expect(previousCensusEgresoCandidates(previous, [newbornRow], reportDate)).toEqual([]);
});

it('retains explicit maternal identity after the discharged parent has been cleared', () => {
  const previous = previousRecord();
  const child = { ...previous.beds.H5C1.clinicalCrib!, rut: '', neonatalMaternalRut: RUN };
  previous.beds.H5C1 = { ...EMPTY_PATIENT, bedId: 'H5C1', clinicalCrib: child };
  expect(previousCensusEgresoCandidates(previous, [newbornRow], reportDate)).toEqual([
    expect.objectContaining({ encounterId: '1002', run: RUN, personalRun: '' }),
  ]);
});

it('identifies a discharged newborn from the selected census movement after bed clearing', () => {
  const previous = previousRecord();
  const child = { ...previous.beds.H5C1.clinicalCrib!, rut: '', neonatalMaternalRut: RUN };
  previous.beds = {};
  previous.date = reportDate;
  previous.discharges = [
    {
      id: 'child',
      clinicalEpisodeId: '1002',
      patientName: child.patientName,
      rut: '',
      isNested: true,
      originalData: child,
    } as never,
  ];
  expect(
    previousCensusEgresoCandidates(
      previous,
      [{ ...newbornRow, fechaEgreso: '13-09-2026 15:00' }],
      reportDate
    )
  ).toEqual([
    expect.objectContaining({
      encounterId: '1002',
      run: RUN,
      personalRun: '',
      fromClinicalCrib: true,
    }),
  ]);
});
