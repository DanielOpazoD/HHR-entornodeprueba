import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { BEDS } from '@/constants/beds';
import { SpecialtyBreakdownTable } from '@/features/analytics/components/internal/SpecialtyBreakdownTable';
import {
  buildSpecialtyTraceability,
  calculateMinsalStats,
} from '@/features/analytics/services/minsalStatsCalculator';
import type { MinsalStatistics } from '@/features/analytics/types/minsalTypes';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import type { DailyRecordMovementState } from '@/types/domain/dailyRecordSlices';

const primaryBed = BEDS[0];

const makePatient = (overrides: Partial<PatientData> = {}): PatientData => ({
  bedId: primaryBed.id,
  bedName: primaryBed.name,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: '',
  rut: '',
  age: '40',
  pathology: '',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '',
  hasWristband: true,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  ...overrides,
});

const summary: MinsalStatistics = {
  periodStart: '2026-03-01',
  periodEnd: '2026-03-31',
  totalDays: 31,
  calendarDays: 31,
  diasCamaDisponibles: 558,
  diasCamaOcupados: 390,
  tasaOcupacion: 69.9,
  promedioDiasEstada: 4.2,
  promedioDiasEstadaMinima: 1,
  promedioDiasEstadaMaxima: 8,
  egresosTotal: 40,
  egresosVivos: 36,
  egresosFallecidos: 2,
  egresosTraslados: 2,
  mortalidadHospitalaria: 5,
  indiceRotacion: 2.1,
  pacientesActuales: 13,
  camasOcupadas: 13,
  camasBloqueadas: 0,
  camasDisponibles: 18,
  camasLibres: 5,
  tasaOcupacionActual: 72.2,
  porEspecialidad: [],
};

describe('SpecialtyBreakdownTable', () => {
  it('labels the first metric as period bed-days instead of current patients', () => {
    render(<SpecialtyBreakdownTable data={[]} records={[]} summary={summary} />);

    expect(
      screen.getByText('No hay datos de especialidades para el período seleccionado.')
    ).toBeInTheDocument();
  });

  it('uses explicit period wording in the specialty header row', () => {
    render(
      <SpecialtyBreakdownTable
        data={[
          {
            specialty: 'Medicina',
            pacientesActuales: 3,
            egresos: 2,
            fallecidos: 1,
            traslados: 0,
            aerocardal: 0,
            fach: 0,
            diasOcupados: 9,
            contribucionRelativa: 50,
            tasaMortalidad: 50,
            promedioDiasEstada: 4.5,
            promedioDiasEstadaMinima: 2,
            promedioDiasEstadaMaxima: 6,
            diasOcupadosList: [],
            egresosList: [],
            trasladosList: [],
            aerocardalList: [],
            fachList: [],
            fallecidosList: [],
          },
        ]}
        records={[]}
        summary={summary}
      />
    );

    expect(screen.getByText('Días-cama del período')).toBeInTheDocument();
    expect(screen.queryByText('Pacientes (Días-Cama del período)')).not.toBeInTheDocument();
    expect(screen.getByText('Estada media de egresos')).toBeInTheDocument();
    expect(screen.getByText('Rango estada egresos')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('shows diagnosis in the traceability dialog for period event details', () => {
    render(
      <SpecialtyBreakdownTable
        data={[
          {
            specialty: 'Medicina',
            pacientesActuales: 3,
            egresos: 1,
            fallecidos: 0,
            traslados: 0,
            aerocardal: 0,
            fach: 0,
            diasOcupados: 9,
            contribucionRelativa: 50,
            tasaMortalidad: 0,
            promedioDiasEstada: 4.5,
            promedioDiasEstadaMinima: 2,
            promedioDiasEstadaMaxima: 6,
            diasOcupadosList: [],
            egresosList: [
              {
                name: 'Paciente Demo',
                rut: '11.111.111-1',
                diagnosis: 'Neumonía adquirida en la comunidad',
                date: '2026-03-01',
                bedName: 'UTI 1',
              },
            ],
            trasladosList: [],
            aerocardalList: [],
            fachList: [],
            fallecidosList: [],
          },
        ]}
        records={[]}
        summary={summary}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '1' }));

    expect(screen.getByText('Diagnóstico')).toBeInTheDocument();
    expect(screen.getByText('Neumonía adquirida en la comunidad')).toBeInTheDocument();
    expect(screen.getByText('100.0%')).toBeInTheDocument();
  });

  it('shows original and reporting specialty when traceability rows were grouped or reclassified', () => {
    render(
      <SpecialtyBreakdownTable
        data={[
          {
            specialty: 'Otro',
            pacientesActuales: 0,
            egresos: 1,
            fallecidos: 0,
            traslados: 0,
            aerocardal: 0,
            fach: 0,
            diasOcupados: 0,
            contribucionRelativa: 0,
            tasaMortalidad: 0,
            promedioDiasEstada: 0,
            promedioDiasEstadaMinima: 0,
            promedioDiasEstadaMaxima: 0,
            diasOcupadosList: [],
            egresosList: [
              {
                name: 'Paciente Agrupado',
                rut: '44.444.444-4',
                diagnosis: 'Diagnóstico',
                date: '2026-03-01',
                bedName: 'Cama 1',
                originalSpecialty: 'Cardiología',
                reportingSpecialty: 'Otro',
                reportingSpecialtySource: 'grouped',
              },
            ],
            trasladosList: [],
            aerocardalList: [],
            fachList: [],
            fallecidosList: [],
          },
        ]}
        records={[]}
        summary={summary}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '1' }));

    expect(screen.getByText('Especialidad original')).toBeInTheDocument();
    expect(screen.getByText('Especialidad estadística')).toBeInTheDocument();
    expect(screen.getByText('Cardiología')).toBeInTheDocument();
    expect(screen.getAllByText('Otro').length).toBeGreaterThanOrEqual(2);
  });

  it('opens the stay range modal with admission and discharge dates', () => {
    const onOpenCensusDate = vi.fn();

    render(
      <SpecialtyBreakdownTable
        data={[
          {
            specialty: 'Cirugía',
            pacientesActuales: 2,
            egresos: 1,
            fallecidos: 0,
            traslados: 0,
            aerocardal: 0,
            fach: 0,
            diasOcupados: 10,
            contribucionRelativa: 50,
            tasaMortalidad: 0,
            promedioDiasEstada: 3,
            promedioDiasEstadaMinima: 3,
            promedioDiasEstadaMaxima: 3,
            diasOcupadosList: [],
            egresosList: [
              {
                name: 'Paciente Rango',
                rut: '22.222.222-2',
                diagnosis: 'Apendicitis',
                date: '2026-01-26',
                bedName: 'Cama 1',
                admissionDate: '2026-01-23',
                dischargeDate: '2026-01-26',
              },
            ],
            trasladosList: [],
            aerocardalList: [],
            fachList: [],
            fallecidosList: [],
          },
        ]}
        records={[]}
        summary={summary}
        onOpenCensusDate={onOpenCensusDate}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Ver casos de estada de Cirugía/ }));

    expect(screen.getByText('Detalle: Estada de egresos - Cirugía')).toBeInTheDocument();
    expect(screen.getByText('Ingreso')).toBeInTheDocument();
    expect(screen.getByText('Egreso')).toBeInTheDocument();
    expect(screen.getByText('Días estada')).toBeInTheDocument();
    expect(screen.getByText('23-01-2026')).toBeInTheDocument();
    expect(screen.getByText('26-01-2026')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Mínimo')).toBeInTheDocument();
    expect(screen.getByText('Máximo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir censo' }));

    expect(onOpenCensusDate).toHaveBeenCalledWith('2026-01-23');
  });

  it('falls back to resolved discharge stays when summary is not provided', () => {
    render(
      <SpecialtyBreakdownTable
        data={[
          {
            specialty: 'Cirugía',
            pacientesActuales: 0,
            egresos: 1,
            fallecidos: 0,
            traslados: 0,
            aerocardal: 0,
            fach: 0,
            diasOcupados: 4,
            contribucionRelativa: 100,
            tasaMortalidad: 0,
            promedioDiasEstada: 4,
            promedioDiasEstadaMinima: 4,
            promedioDiasEstadaMaxima: 4,
            diasOcupadosList: [],
            egresosList: [
              {
                name: 'Paciente DEIS',
                rut: '11.111.111-1',
                diagnosis: 'Diagnóstico',
                date: '2026-03-05',
                bedName: 'Cama 1',
                admissionDate: '2026-03-01',
                dischargeDate: '2026-03-05',
              },
            ],
            trasladosList: [],
            aerocardalList: [],
            fachList: [],
            fallecidosList: [],
          },
        ]}
        records={[]}
      />
    );

    expect(screen.getAllByText('4.00 días')).toHaveLength(2);
  });

  it('sorts columns and can filter to rows with period events only', () => {
    render(
      <SpecialtyBreakdownTable
        data={[
          {
            specialty: 'Medicina',
            pacientesActuales: 0,
            egresos: 0,
            fallecidos: 0,
            traslados: 0,
            aerocardal: 0,
            fach: 0,
            diasOcupados: 0,
            contribucionRelativa: 0,
            tasaMortalidad: 0,
            promedioDiasEstada: 0,
            diasOcupadosList: [],
            egresosList: [],
            trasladosList: [],
            aerocardalList: [],
            fachList: [],
            fallecidosList: [],
          },
          {
            specialty: 'Cirugía',
            pacientesActuales: 1,
            egresos: 3,
            fallecidos: 0,
            traslados: 1,
            aerocardal: 0,
            fach: 0,
            diasOcupados: 9,
            contribucionRelativa: 100,
            tasaMortalidad: 0,
            promedioDiasEstada: 2,
            diasOcupadosList: [],
            egresosList: [],
            trasladosList: [],
            aerocardalList: [],
            fachList: [],
            fallecidosList: [],
          },
        ]}
        records={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Solo filas con eventos' }));

    expect(screen.queryByText('Medicina')).not.toBeInTheDocument();
    expect(screen.getByText('Cirugía')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ordenar por egresos/i }));

    expect(screen.getByText('Cirugía')).toBeInTheDocument();
  });

  it('keeps bed-days traceability empty when diasOcupadosList is [] even if a transfer exists in records', () => {
    const record: DailyRecordMovementState = {
      date: '2026-03-10',
      beds: {
        [primaryBed.id]: makePatient(),
      },
      discharges: [],
      transfers: [
        {
          id: 'tr-1',
          bedName: primaryBed.name,
          bedId: primaryBed.id,
          bedType: 'Básica',
          patientName: 'Paciente Traslado Pediatría',
          rut: '12.345.678-9',
          diagnosis: 'Bronquiolitis',
          time: '14:00',
          evacuationMethod: 'Aerocardal',
          receivingCenter: 'Hospital Base',
          specialty: Specialty.PEDIATRIA,
          admissionDate: '2026-03-09',
        },
      ],
      cma: [],
    };

    const stats = calculateMinsalStats([record], '2026-03-10', '2026-03-10');
    const pediatria = stats.porEspecialidad.find(item => item.specialty === Specialty.PEDIATRIA);
    expect(pediatria?.diasOcupados).toBe(0);
    expect(pediatria?.diasOcupadosList).toEqual([]);
    expect(pediatria?.traslados).toBe(1);

    render(
      <SpecialtyBreakdownTable data={stats.porEspecialidad} records={[record]} summary={stats} />
    );

    const pediatriaRow = screen.getByText('Pediatría').closest('tr');
    expect(pediatriaRow).not.toBeNull();
    const rowScope = within(pediatriaRow!);

    fireEvent.click(rowScope.getByTitle('Ver detalle de pacientes'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Detalle: Días Cama - Pediatría')).toBeInTheDocument();
    expect(
      within(dialog).getByText('No hay registros detallados disponibles.')
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Paciente Traslado Pediatría')).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /Cerrar/i }));

    const transferButtons = rowScope.getAllByRole('button', { name: '1' });
    fireEvent.click(transferButtons[0]);

    const transferDialog = screen.getByRole('dialog');
    expect(within(transferDialog).getByText('Detalle: Traslados - Pediatría')).toBeInTheDocument();
    expect(within(transferDialog).getAllByText('Paciente Traslado Pediatría')).toHaveLength(1);
  });

  it('reconstructs fallback traceability cleanly when lists are omitted, without leaking transfers or mixing episodes', () => {
    const day1: DailyRecordMovementState = {
      date: '2026-03-01',
      beds: {
        [primaryBed.id]: makePatient({
          patientName: 'Paciente Reingreso',
          rut: '15.555.555-5',
          clinicalEpisodeId: 'ep_1',
          pathology: 'Arritmia',
          specialty: 'Cardiología' as Specialty,
          admissionDate: '2026-03-01',
        }),
      },
      discharges: [
        {
          id: 'dis-1',
          bedName: primaryBed.name,
          bedId: primaryBed.id,
          bedType: 'Básica',
          patientName: 'Paciente Reingreso',
          rut: '15.555.555-5',
          clinicalEpisodeId: 'ep_1',
          diagnosis: 'Arritmia',
          status: 'Vivo',
          time: '18:00',
          specialty: 'Cardiología' as Specialty,
          admissionDate: '2026-03-01',
        },
      ],
      transfers: [
        {
          id: 'tr-2',
          bedName: BEDS[1].name,
          bedId: BEDS[1].id,
          bedType: 'Básica',
          patientName: 'Paciente Traslado Especial',
          rut: '16.666.666-6',
          diagnosis: 'Infarto',
          time: '19:00',
          evacuationMethod: 'FACH',
          receivingCenter: 'Hospital Salvador',
          specialty: 'Cardiología' as Specialty,
          admissionDate: '2026-03-01',
        },
      ],
      cma: [],
    };

    const day2: DailyRecordMovementState = {
      date: '2026-03-05',
      beds: {
        [primaryBed.id]: makePatient({
          patientName: 'Paciente Reingreso',
          rut: '15.555.555-5',
          clinicalEpisodeId: 'ep_2',
          pathology: 'Síncope',
          specialty: 'Cardiología' as Specialty,
          admissionDate: '2026-03-05',
        }),
      },
      discharges: [
        {
          id: 'dis-2',
          bedName: primaryBed.name,
          bedId: primaryBed.id,
          bedType: 'Básica',
          patientName: 'Paciente Fallecido',
          rut: '17.777.777-7',
          diagnosis: 'Insuficiencia cardíaca',
          status: 'Fallecido',
          time: '10:00',
          specialty: 'Cardiología' as Specialty,
          admissionDate: '2026-03-04',
        },
      ],
      transfers: [],
      cma: [],
    };

    const records = [day1, day2];
    const options = { specialtyGroupingMode: 'group-other' as const };

    const bedDays = buildSpecialtyTraceability(records, Specialty.OTRO, 'dias-cama', options);
    expect(bedDays).toEqual([
      expect.objectContaining({
        name: 'Paciente Reingreso',
        clinicalEpisodeId: 'ep_1',
        admissionDate: '2026-03-01',
        dischargeDate: '2026-03-01',
      }),
      expect.objectContaining({
        name: 'Paciente Reingreso',
        clinicalEpisodeId: 'ep_2',
        admissionDate: '2026-03-05',
      }),
    ]);
    expect(bedDays[1]?.dischargeDate).toBeUndefined();

    expect(buildSpecialtyTraceability(records, Specialty.OTRO, 'fallecidos', options)).toEqual([
      expect.objectContaining({
        name: 'Paciente Fallecido',
        date: '2026-03-05',
      }),
    ]);

    expect(buildSpecialtyTraceability(records, Specialty.OTRO, 'estada', options)).toHaveLength(3);
    expect(buildSpecialtyTraceability([day1], Specialty.PEDIATRIA, 'dias-cama', options)).toEqual(
      []
    );

    render(
      <SpecialtyBreakdownTable
        data={[
          {
            specialty: Specialty.OTRO,
            pacientesActuales: 1,
            egresos: 2,
            fallecidos: 1,
            traslados: 1,
            aerocardal: 0,
            fach: 1,
            diasOcupados: 2,
            contribucionRelativa: 100,
            tasaMortalidad: 33.3,
            promedioDiasEstada: 1,
            promedioDiasEstadaMinima: 1,
            promedioDiasEstadaMaxima: 1,
          },
        ]}
        records={records}
        summary={summary}
        calculationOptions={options}
      />
    );

    fireEvent.click(screen.getByTitle('Ver detalle de pacientes'));

    const dialog = screen.getByRole('dialog');
    const bodyRows = within(dialog).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(2);
    expect(within(dialog).queryByText('Paciente Traslado Especial')).not.toBeInTheDocument();
  });
});
