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
