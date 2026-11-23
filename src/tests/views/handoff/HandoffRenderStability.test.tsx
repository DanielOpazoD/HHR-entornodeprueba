/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '../../integration/setup';
import { MessageSquare } from 'lucide-react';
import { BEDS } from '@/constants/beds';
import * as clinicalDayUtils from '@/utils/clinicalDayUtils';
import * as handoffViewController from '@/features/handoff/controllers/handoffViewController';
import * as movementsSummaryController from '@/features/handoff/controllers/movementsSummaryController';
import { HandoffChecklistSection } from '@/features/handoff/components/HandoffChecklistSection';
import { HandoffNursingContent } from '@/features/handoff/components/HandoffNursingContent';
import { HandoffPrintHeader } from '@/features/handoff/components/HandoffPrintHeader';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';

describe('Handoff render stability across unrelated record updates', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildTwoBedRecord = (): DailyRecord =>
    DataFactory.createMockDailyRecord('2025-01-05', {
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'Paciente Uno',
          rut: '11.111.111-1',
          admissionDate: '2025-01-01',
          handoffNoteDayShift: 'Nota inicial R1',
        }),
        R2: DataFactory.createMockPatient('R2', {
          patientName: 'Paciente Dos',
          rut: '22.222.222-2',
          admissionDate: '2025-01-02',
          handoffNoteDayShift: 'Nota inicial R2',
        }),
      },
      handoffNovedadesDayShift: 'Novedad inicial',
    });

  it('skips re-rendering print header, checklist, movements, novedades bindings and untouched bed rows when only one bed note changes', () => {
    const checklistVmSpy = vi.spyOn(handoffViewController, 'buildHandoffChecklistSectionViewModel');
    const novedadesBindingsSpy = vi.spyOn(handoffViewController, 'buildHandoffNovedadesBindings');
    const movementsVmSpy = vi.spyOn(movementsSummaryController, 'buildMovementsSummaryViewModel');
    const daysSpy = vi.spyOn(clinicalDayUtils, 'calculateOperationalHospitalizedDays');
    const scheduleReadSpy = vi.fn(() => '08:00');
    const schedule = {
      get dayStart() {
        return scheduleReadSpy();
      },
      dayEnd: '20:00',
      nightStart: '20:00',
      nightEnd: '08:00',
    };

    const initialRecord = buildTwoBedRecord();
    const visibleBeds = BEDS.filter(bed => bed.id === 'R1' || bed.id === 'R2');
    const setSelectedShift = vi.fn();
    const onUpdateReceives = vi.fn();
    const onUpdateChecklist = vi.fn();
    const onUpdateNovedades = vi.fn();
    const onNoteChange = vi.fn();
    const shouldShowPatient = vi.fn(() => true);
    const clinicalEventActions = {
      onAdd: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    };
    const deliversList = ['Enfermera A'];
    const receivesList = ['Enfermera B'];
    const tensList = ['TENS A'];
    const nursesList = ['Enfermera A', 'Enfermera B'];

    const renderTree = (record: DailyRecord, dateString = '05-01-2025') => (
      <>
        <HandoffPrintHeader
          title="Entrega Turno Enfermería - Día "
          dateString={dateString}
          Icon={MessageSquare}
          schedule={schedule}
          selectedShift="day"
          deliversList={deliversList}
          receivesList={receivesList}
          tensList={tensList}
        />
        <HandoffChecklistSection
          selectedShift="day"
          setSelectedShift={setSelectedShift}
          record={record}
          deliversList={deliversList}
          receivesList={receivesList}
          nursesList={nursesList}
          readOnly={false}
          onUpdateReceives={onUpdateReceives}
          onUpdateChecklist={onUpdateChecklist}
        />
        <HandoffNursingContent
          visibleBeds={visibleBeds}
          record={record}
          noteField="handoffNoteDayShift"
          onNoteChange={onNoteChange}
          tableHeaderClass="bg-slate-50"
          readOnly={false}
          hasAnyPatients={true}
          shouldShowPatient={shouldShowPatient}
          clinicalEventActions={clinicalEventActions}
          selectedShift="day"
          updateHandoffNovedades={onUpdateNovedades}
        />
      </>
    );

    const countCallsForAdmission = (admissionDate: string) =>
      daysSpy.mock.calls.filter(([date]) => date === admissionDate).length;

    const { rerender } = render(renderTree(initialRecord));

    const r1InitialDaysCalls = countCallsForAdmission('2025-01-01');
    const r2InitialDaysCalls = countCallsForAdmission('2025-01-02');
    expect(r1InitialDaysCalls).toBeGreaterThan(0);
    expect(r2InitialDaysCalls).toBeGreaterThan(0);
    expect(scheduleReadSpy).toHaveBeenCalledTimes(1);
    expect(checklistVmSpy).toHaveBeenCalledTimes(1);
    expect(novedadesBindingsSpy).toHaveBeenCalledTimes(1);
    expect(movementsVmSpy).toHaveBeenCalledTimes(1);

    // Edit only bed R1's note: R2 and all sibling handoff sections must bail out.
    const updatedBedRecord: DailyRecord = {
      ...initialRecord,
      beds: {
        ...initialRecord.beds,
        R1: {
          ...initialRecord.beds.R1,
          handoffNoteDayShift: 'Nota editada R1',
        },
      },
    };

    rerender(renderTree(updatedBedRecord));

    expect(scheduleReadSpy).toHaveBeenCalledTimes(1);
    expect(checklistVmSpy).toHaveBeenCalledTimes(1);
    expect(novedadesBindingsSpy).toHaveBeenCalledTimes(1);
    expect(movementsVmSpy).toHaveBeenCalledTimes(1);
    expect(countCallsForAdmission('2025-01-01')).toBeGreaterThan(r1InitialDaysCalls);
    expect(countCallsForAdmission('2025-01-02')).toBe(r2InitialDaysCalls);

    // Updating each section's own slice still triggers its targeted re-render.
    const updatedSectionsRecord: DailyRecord = {
      ...updatedBedRecord,
      handoffDayChecklist: {
        ...updatedBedRecord.handoffDayChecklist,
        escalaEva: true,
      },
      discharges: [
        {
          id: 'd-1',
          bedName: 'R1',
          bedId: 'R1',
          bedType: 'MEDIA',
          patientName: 'Paciente Egreso',
          rut: '33.333.333-3',
          diagnosis: 'Diagnóstico prueba',
          time: '11:00',
          status: 'Vivo',
          dischargeType: 'Domicilio (Habitual)',
        },
      ],
      handoffNovedadesDayShift: 'Novedad actualizada',
    };

    rerender(renderTree(updatedSectionsRecord, '06-01-2025'));

    expect(scheduleReadSpy).toHaveBeenCalledTimes(2);
    expect(checklistVmSpy).toHaveBeenCalledTimes(2);
    expect(novedadesBindingsSpy).toHaveBeenCalledTimes(2);
    expect(movementsVmSpy).toHaveBeenCalledTimes(2);
    expect(countCallsForAdmission('2025-01-02')).toBe(r2InitialDaysCalls);
  });
});
