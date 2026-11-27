import { createRequire } from 'node:module';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BEDS, HOSPITAL_CAPACITY } from '@/constants/beds';
import { SpecialtyBreakdownTable } from '@/features/analytics/components/internal/SpecialtyBreakdownTable';
import { calculateMinsalStats } from '@/features/analytics/services/minsalStatsCalculator';
import type { DailyRecordMovementState } from '@/types/domain/dailyRecordSlices';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const require = createRequire(import.meta.url);
const {
  calculateMinsalStatistics,
} = require('../../../../functions/lib/minsal/minsalStatsCalculator.js');

const bed1 = BEDS[0];
const bed2 = BEDS[1];

const makePatient = (overrides: Partial<PatientData>): PatientData => ({
  bedId: bed1.id,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: '',
  rut: '',
  age: '40',
  pathology: 'Diagnóstico sintético',
  specialty: Specialty.CIRUGIA,
  status: PatientStatus.ESTABLE,
  admissionDate: '',
  hasWristband: true,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  ...overrides,
});

describe('MINSAL episode traceability (bed-days attribution and modal grouping)', () => {
  it('links readmission admission and discharge dates per accredited episode (1-2 and 3-4 Jan) in both calculators and in the detail modal', () => {
    const records: DailyRecordMovementState[] = [
      {
        date: '2026-01-01',
        beds: {
          [bed1.id]: makePatient({
            clinicalEpisodeId: 'ep_readm_1',
            patientName: 'Paciente Reingreso',
            rut: '12.345.678-9',
            admissionDate: '2026-01-01',
          }),
        },
        discharges: [],
        transfers: [],
        cma: [],
      },
      {
        date: '2026-01-02',
        beds: {},
        discharges: [
          {
            id: 'd-1',
            clinicalEpisodeId: 'ep_readm_1',
            bedId: bed1.id,
            bedName: bed1.name,
            bedType: 'Básica',
            patientName: 'Paciente Reingreso',
            rut: '12.345.678-9',
            diagnosis: 'Primer episodio',
            specialty: Specialty.CIRUGIA,
            admissionDate: '2026-01-01',
            time: '11:00',
            status: 'Vivo',
          },
        ],
        transfers: [],
        cma: [],
      },
      {
        date: '2026-01-03',
        beds: {
          [bed1.id]: makePatient({
            clinicalEpisodeId: 'ep_readm_2',
            patientName: 'Paciente Reingreso',
            rut: '12.345.678-9',
            admissionDate: '2026-01-03',
          }),
        },
        discharges: [],
        transfers: [],
        cma: [],
      },
      {
        date: '2026-01-04',
        beds: {},
        discharges: [
          {
            id: 'd-2',
            clinicalEpisodeId: 'ep_readm_2',
            bedId: bed1.id,
            bedName: bed1.name,
            bedType: 'Básica',
            patientName: 'Paciente Reingreso',
            rut: '12.345.678-9',
            diagnosis: 'Segundo episodio',
            specialty: Specialty.CIRUGIA,
            admissionDate: '2026-01-03',
            time: '15:00',
            status: 'Vivo',
          },
        ],
        transfers: [],
        cma: [],
      },
    ];

    const clientStats = calculateMinsalStats(records, '2026-01-01', '2026-01-04');
    const serverStats = calculateMinsalStatistics({
      records,
      hospitalCapacity: HOSPITAL_CAPACITY,
      startDate: '2026-01-01',
      endDate: '2026-01-04',
    });

    const clientList = clientStats.porEspecialidad[0]?.diasOcupadosList ?? [];
    const serverList = serverStats.porEspecialidad[0]?.diasOcupadosList ?? [];

    expect(
      clientList.map(row => ({
        clinicalEpisodeId: row.clinicalEpisodeId,
        admissionDate: row.admissionDate,
        dischargeDate: row.dischargeDate,
      }))
    ).toEqual([
      { clinicalEpisodeId: 'ep_readm_1', admissionDate: '2026-01-01', dischargeDate: '2026-01-02' },
      { clinicalEpisodeId: 'ep_readm_2', admissionDate: '2026-01-03', dischargeDate: '2026-01-04' },
    ]);
    expect(
      serverList.map(
        (row: { clinicalEpisodeId?: string; admissionDate?: string; dischargeDate?: string }) => ({
          clinicalEpisodeId: row.clinicalEpisodeId,
          admissionDate: row.admissionDate,
          dischargeDate: row.dischargeDate,
        })
      )
    ).toEqual([
      { clinicalEpisodeId: 'ep_readm_1', admissionDate: '2026-01-01', dischargeDate: '2026-01-02' },
      { clinicalEpisodeId: 'ep_readm_2', admissionDate: '2026-01-03', dischargeDate: '2026-01-04' },
    ]);

    render(
      <SpecialtyBreakdownTable
        data={clientStats.porEspecialidad}
        records={records}
        summary={clientStats}
      />
    );

    const cirugiaRow = screen.getByText('Cirugía').closest('tr');
    expect(cirugiaRow).not.toBeNull();
    fireEvent.click(within(cirugiaRow!).getAllByRole('button')[0]);

    const dialog = screen.getByRole('dialog');
    const bodyRows = within(dialog).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(2);
    expect(within(bodyRows[0]).getByText('01-01-2026')).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText('02-01-2026')).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText('03-01-2026')).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText('04-01-2026')).toBeInTheDocument();
  });

  it('keeps two undocumented people separate and leaves discharge dates unattributed without accredited episode ids', () => {
    const records: DailyRecordMovementState[] = [
      {
        date: '2026-01-05',
        beds: {
          [bed1.id]: makePatient({
            bedId: bed1.id,
            patientName: 'Persona Sin Documento Uno',
            rut: '',
            admissionDate: '2026-01-05',
          }),
          [bed2.id]: makePatient({
            bedId: bed2.id,
            patientName: 'Persona Sin Documento Dos',
            rut: '',
            admissionDate: '2026-01-05',
          }),
        },
        discharges: [],
        transfers: [],
        cma: [],
      },
      {
        date: '2026-01-06',
        beds: {},
        discharges: [
          {
            id: 'd-nn-1',
            bedId: bed1.id,
            bedName: bed1.name,
            bedType: 'Básica',
            patientName: 'Persona Sin Documento Uno',
            rut: '',
            diagnosis: 'Diagnóstico sintético',
            specialty: Specialty.CIRUGIA,
            admissionDate: '2026-01-05',
            time: '10:00',
            status: 'Vivo',
          },
        ],
        transfers: [],
        cma: [],
      },
    ];

    const stats = calculateMinsalStats(records, '2026-01-05', '2026-01-06');
    const bedDays = stats.porEspecialidad[0]?.diasOcupadosList ?? [];
    expect(bedDays).toHaveLength(2);
    expect(bedDays.every(row => row.dischargeDate === undefined)).toBe(true);

    render(
      <SpecialtyBreakdownTable data={stats.porEspecialidad} records={records} summary={stats} />
    );
    const cirugiaRow = screen.getByText('Cirugía').closest('tr');
    fireEvent.click(within(cirugiaRow!).getAllByRole('button')[0]);

    const dialog = screen.getByRole('dialog');
    const bodyRows = within(dialog).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(2);
    expect(within(dialog).getByText('Persona Sin Documento Uno')).toBeInTheDocument();
    expect(within(dialog).getByText('Persona Sin Documento Dos')).toBeInTheDocument();
    expect(within(dialog).queryByText('06-01-2026')).not.toBeInTheDocument();
  });

  it('leaves discharge dates unattributed and rows unmerged when a legacy episode is ambiguous', () => {
    const records: DailyRecordMovementState[] = [
      {
        date: '2026-01-10',
        beds: {
          [bed1.id]: makePatient({
            bedId: bed1.id,
            clinicalEpisodeId: 'legacy_ep_shared_hash',
            patientName: 'Madre Legacy',
            rut: '15.111.222-3',
            admissionDate: '2026-01-10',
          }),
          [bed2.id]: makePatient({
            bedId: bed2.id,
            clinicalEpisodeId: 'legacy_ep_shared_hash',
            patientName: 'RN Legacy Cama Propia',
            rut: '15.111.222-3',
            admissionDate: '2026-01-10',
          }),
        },
        discharges: [],
        transfers: [],
        cma: [],
      },
      {
        date: '2026-01-11',
        beds: {},
        discharges: [
          {
            id: 'd-legacy-ambiguous',
            clinicalEpisodeId: 'legacy_ep_shared_hash',
            bedId: bed1.id,
            bedName: bed1.name,
            bedType: 'Básica',
            patientName: 'Madre Legacy',
            rut: '15.111.222-3',
            diagnosis: 'Diagnóstico sintético',
            specialty: Specialty.CIRUGIA,
            admissionDate: '2026-01-10',
            time: '12:00',
            status: 'Vivo',
          },
        ],
        transfers: [],
        cma: [],
      },
    ];

    const clientStats = calculateMinsalStats(records, '2026-01-10', '2026-01-11');
    const serverStats = calculateMinsalStatistics({
      records,
      hospitalCapacity: HOSPITAL_CAPACITY,
      startDate: '2026-01-10',
      endDate: '2026-01-11',
    });

    const clientRows = clientStats.porEspecialidad[0]?.diasOcupadosList ?? [];
    const serverRows = serverStats.porEspecialidad[0]?.diasOcupadosList ?? [];

    expect(clientRows).toHaveLength(2);
    expect(clientRows.every(row => row.clinicalEpisodeId === undefined)).toBe(true);
    expect(clientRows.every(row => row.dischargeDate === undefined)).toBe(true);
    expect(serverRows).toHaveLength(2);
    expect(
      serverRows.every(
        (row: { clinicalEpisodeId?: string; dischargeDate?: string }) =>
          row.clinicalEpisodeId === undefined && row.dischargeDate === undefined
      )
    ).toBe(true);

    render(
      <SpecialtyBreakdownTable
        data={clientStats.porEspecialidad}
        records={records}
        summary={clientStats}
      />
    );
    const cirugiaRow = screen.getByText('Cirugía').closest('tr');
    fireEvent.click(within(cirugiaRow!).getAllByRole('button')[0]);

    const dialog = screen.getByRole('dialog');
    const bodyRows = within(dialog).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(2);
    expect(within(dialog).queryByText('11-01-2026')).not.toBeInTheDocument();
  });

  it('keeps distinct accredited undocumented episodes separated and attributes each to its own exit date', () => {
    const records: DailyRecordMovementState[] = [
      {
        date: '2026-01-15',
        beds: {
          [bed1.id]: makePatient({
            bedId: bed1.id,
            clinicalEpisodeId: 'ep_nn_a',
            patientName: 'Paciente NN A',
            rut: '',
            admissionDate: '2026-01-15',
          }),
          [bed2.id]: makePatient({
            bedId: bed2.id,
            clinicalEpisodeId: 'ep_nn_b',
            patientName: 'Paciente NN B',
            rut: '',
            admissionDate: '2026-01-15',
          }),
        },
        discharges: [],
        transfers: [],
        cma: [],
      },
      {
        date: '2026-01-16',
        beds: {
          [bed2.id]: makePatient({
            bedId: bed2.id,
            clinicalEpisodeId: 'ep_nn_b',
            patientName: 'Paciente NN B',
            rut: '',
            admissionDate: '2026-01-15',
          }),
        },
        discharges: [
          {
            id: 'd-nn-a',
            clinicalEpisodeId: 'ep_nn_a',
            bedId: bed1.id,
            bedName: bed1.name,
            bedType: 'Básica',
            patientName: 'Paciente NN A',
            rut: '',
            diagnosis: 'Diagnóstico A',
            specialty: Specialty.CIRUGIA,
            admissionDate: '2026-01-15',
            time: '09:00',
            status: 'Vivo',
          },
        ],
        transfers: [],
        cma: [],
      },
      {
        date: '2026-01-17',
        beds: {},
        discharges: [
          {
            id: 'd-nn-b',
            clinicalEpisodeId: 'ep_nn_b',
            bedId: bed2.id,
            bedName: bed2.name,
            bedType: 'Básica',
            patientName: 'Paciente NN B',
            rut: '',
            diagnosis: 'Diagnóstico B',
            specialty: Specialty.CIRUGIA,
            admissionDate: '2026-01-15',
            time: '14:00',
            status: 'Vivo',
          },
        ],
        transfers: [],
        cma: [],
      },
    ];

    const stats = calculateMinsalStats(records, '2026-01-15', '2026-01-17');

    render(
      <SpecialtyBreakdownTable data={stats.porEspecialidad} records={records} summary={stats} />
    );
    const cirugiaRow = screen.getByText('Cirugía').closest('tr');
    fireEvent.click(within(cirugiaRow!).getAllByRole('button')[0]);

    const dialog = screen.getByRole('dialog');
    const bodyRows = within(dialog).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(2);
    // NN B stayed 2 days (sorted first by daysCount desc), NN A stayed 1 day.
    expect(within(bodyRows[0]).getByText('Paciente NN B')).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText('17-01-2026')).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText('2')).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText('Paciente NN A')).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText('16-01-2026')).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText('1')).toBeInTheDocument();
  });

  it('keeps same-day legacy discharge and readmission separated (01/01->02/01 and 02/01->04/01)', () => {
    const records: DailyRecordMovementState[] = [
      {
        date: '2026-01-01',
        beds: {
          [bed1.id]: makePatient({
            patientName: 'Paciente Mismo Día',
            rut: '12.345.678-9',
            admissionDate: '2026-01-01',
          }),
        },
        discharges: [],
        transfers: [],
        cma: [],
      },
      {
        date: '2026-01-02',
        beds: {
          [bed1.id]: makePatient({
            patientName: 'Paciente Mismo Día',
            rut: '12.345.678-9',
            admissionDate: '2026-01-02',
          }),
        },
        discharges: [
          {
            id: 'd-same-day-1',
            bedId: bed1.id,
            bedName: bed1.name,
            bedType: 'Básica',
            patientName: 'Paciente Mismo Día',
            rut: '12.345.678-9',
            diagnosis: 'Primer episodio',
            specialty: Specialty.CIRUGIA,
            admissionDate: '2026-01-01',
            time: '10:00',
            status: 'Vivo',
          },
        ],
        transfers: [],
        cma: [],
      },
      {
        date: '2026-01-04',
        beds: {},
        discharges: [
          {
            id: 'd-same-day-2',
            bedId: bed1.id,
            bedName: bed1.name,
            bedType: 'Básica',
            patientName: 'Paciente Mismo Día',
            rut: '12.345.678-9',
            diagnosis: 'Segundo episodio',
            specialty: Specialty.CIRUGIA,
            admissionDate: '2026-01-02',
            time: '15:00',
            status: 'Vivo',
          },
        ],
        transfers: [],
        cma: [],
      },
    ];

    const stats = calculateMinsalStats(records, '2026-01-01', '2026-01-04');
    const bedDays = stats.porEspecialidad[0]?.diasOcupadosList ?? [];

    expect(bedDays.map(r => ({ adm: r.admissionDate, dis: r.dischargeDate }))).toEqual([
      { adm: '2026-01-01', dis: '2026-01-02' },
      { adm: '2026-01-02', dis: '2026-01-04' },
    ]);

    render(
      <SpecialtyBreakdownTable data={stats.porEspecialidad} records={records} summary={stats} />
    );
    const cirugiaRow = screen.getByText('Cirugía').closest('tr');
    fireEvent.click(within(cirugiaRow!).getAllByRole('button')[0]);

    const bodyRows = within(screen.getByRole('dialog')).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(2);
    expect(within(bodyRows[0]).getByText('01-01-2026')).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText('02-01-2026')).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText('02-01-2026')).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText('04-01-2026')).toBeInTheDocument();
  });

  it('never lets an unaccredited exit close an earlier legacy bed when an accredited episode is open or admissionDate is missing', () => {
    const records: DailyRecordMovementState[] = [
      {
        date: '2026-01-01',
        beds: {
          [bed1.id]: makePatient({
            patientName: 'Paciente Mixto',
            rut: '12.345.678-9',
            admissionDate: '2026-01-01',
          }),
        },
        discharges: [],
        transfers: [],
        cma: [],
      },
      {
        date: '2026-01-02',
        beds: {
          [bed1.id]: makePatient({
            clinicalEpisodeId: 'ep_b',
            patientName: 'Paciente Mixto',
            rut: '12.345.678-9',
            admissionDate: '2026-01-02',
          }),
        },
        discharges: [],
        transfers: [],
        cma: [],
      },
      {
        date: '2026-01-03',
        beds: {},
        discharges: [
          {
            id: 'd-unaccredited',
            bedId: bed1.id,
            bedName: bed1.name,
            bedType: 'Básica',
            patientName: 'Paciente Mixto',
            rut: '12.345.678-9',
            diagnosis: 'Alta sin ID',
            specialty: Specialty.CIRUGIA,
            admissionDate: '2026-01-02',
            time: '12:00',
            status: 'Vivo',
          },
        ],
        transfers: [],
        cma: [],
      },
    ];

    const stats = calculateMinsalStats(records, '2026-01-01', '2026-01-03');
    const bedDays = stats.porEspecialidad[0]?.diasOcupadosList ?? [];
    expect(bedDays.every(row => row.dischargeDate === undefined)).toBe(true);
  });

  it('never merges a passport holder with a RUT holder sharing digits, nor merges days after a same-day legacy collision', () => {
    const records: DailyRecordMovementState[] = [
      {
        date: '2026-01-01',
        beds: {
          [bed1.id]: makePatient({
            patientName: 'Homónimo Documento',
            rut: '123456785',
            documentType: 'Pasaporte',
            admissionDate: '2026-01-01',
          }),
        },
        discharges: [],
        transfers: [],
        cma: [],
      },
      {
        date: '2026-01-02',
        beds: {
          [bed1.id]: makePatient({
            patientName: 'Homónimo Documento',
            rut: '12.345.678-5',
            documentType: 'RUT',
            admissionDate: '2026-01-01',
          }),
        },
        discharges: [],
        transfers: [],
        cma: [],
      },
      {
        date: '2026-01-03',
        beds: {},
        discharges: [
          {
            id: 'd-rut-only',
            bedId: bed1.id,
            bedName: bed1.name,
            bedType: 'Básica',
            patientName: 'Homónimo Documento',
            rut: '12.345.678-5',
            diagnosis: 'Alta RUT',
            specialty: Specialty.CIRUGIA,
            admissionDate: '2026-01-01',
            time: '14:00',
            status: 'Vivo',
          },
        ],
        transfers: [],
        cma: [],
      },
    ];

    const stats = calculateMinsalStats(records, '2026-01-01', '2026-01-03');
    render(
      <SpecialtyBreakdownTable data={stats.porEspecialidad} records={records} summary={stats} />
    );
    const cirugiaRow = screen.getByText('Cirugía').closest('tr');
    fireEvent.click(within(cirugiaRow!).getAllByRole('button')[0]);

    const bodyRows = within(screen.getByRole('dialog')).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(2);
    const passportRow = bodyRows.find(row => within(row).queryByText('123456785'));
    const rutRow = bodyRows.find(row => within(row).queryByText('12.345.678-5'));
    expect(passportRow).toBeDefined();
    expect(rutRow).toBeDefined();
    expect(within(passportRow!).queryByText('03-01-2026')).not.toBeInTheDocument();
    expect(within(rutRow!).getByText('03-01-2026')).toBeInTheDocument();
  });

  it('keeps subsequent days unmerged after a same-day legacy collision and honors Eloísa official movementDate', () => {
    const collisionRecords: DailyRecordMovementState[] = [
      {
        date: '2026-01-01',
        beds: {
          [bed1.id]: makePatient({
            bedId: bed1.id,
            patientName: 'Colisión Legacy',
            rut: '16.111.222-3',
            pathology: 'Diagnóstico Persona 1',
            admissionDate: '2026-01-01',
          }),
          [bed2.id]: makePatient({
            bedId: bed2.id,
            patientName: 'Colisión Legacy',
            rut: '16.111.222-3',
            pathology: 'Diagnóstico Persona 2',
            admissionDate: '2026-01-01',
          }),
        },
        discharges: [],
        transfers: [],
        cma: [],
      },
      {
        date: '2026-01-02',
        beds: {
          [bed2.id]: makePatient({
            bedId: bed2.id,
            patientName: 'Colisión Legacy',
            rut: '16.111.222-3',
            pathology: 'Diagnóstico Persona 2',
            admissionDate: '2026-01-01',
          }),
        },
        discharges: [],
        transfers: [],
        cma: [],
      },
    ];

    const collisionStats = calculateMinsalStats(collisionRecords, '2026-01-01', '2026-01-02');
    const { unmount } = render(
      <SpecialtyBreakdownTable
        data={collisionStats.porEspecialidad}
        records={collisionRecords}
        summary={collisionStats}
      />
    );
    fireEvent.click(within(screen.getByText('Cirugía').closest('tr')!).getAllByRole('button')[0]);
    expect(within(screen.getByRole('dialog')).getAllByRole('row').slice(1)).toHaveLength(3);
    unmount();

    const officialRecords: DailyRecordMovementState[] = [
      {
        date: '2026-01-02',
        beds: {
          [bed1.id]: makePatient({
            clinicalEpisodeId: 'ep_official_1',
            patientName: 'Paciente Hora Oficial',
            rut: '17.111.222-3',
            admissionDate: '2026-01-02',
          }),
        },
        discharges: [
          {
            id: 'd-official-1',
            clinicalEpisodeId: 'ep_official_1',
            bedId: bed1.id,
            bedName: bed1.name,
            bedType: 'Básica',
            patientName: 'Paciente Hora Oficial',
            rut: '17.111.222-3',
            diagnosis: 'Egreso 01:00',
            specialty: Specialty.CIRUGIA,
            admissionDate: '2026-01-02',
            movementDate: '2026-01-03',
            movementDateSource: 'official',
            time: '01:00',
            status: 'Vivo',
          },
        ],
        transfers: [],
        cma: [],
      },
    ];

    const clientOfficial = calculateMinsalStats(officialRecords, '2026-01-02', '2026-01-02');
    const serverOfficial = calculateMinsalStatistics({
      records: officialRecords,
      hospitalCapacity: HOSPITAL_CAPACITY,
      startDate: '2026-01-02',
      endDate: '2026-01-02',
    });

    expect(clientOfficial.porEspecialidad[0]?.diasOcupadosList?.[0]?.dischargeDate).toBe(
      '2026-01-03'
    );
    expect(serverOfficial.porEspecialidad[0]?.diasOcupadosList?.[0]?.dischargeDate).toBe(
      '2026-01-03'
    );
  });
});
