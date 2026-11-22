/** @vitest-environment jsdom */
import '../../setup';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { HandoffRow } from '@/features/handoff/components/HandoffRow';
import { HandoffPatientTable } from '@/features/handoff/components/HandoffPatientTable';
import { DailyRecordProvider } from '@/context/DailyRecordContext';
import { buildStabilityRules } from '@/hooks/stabilityRulesController';
import {
  render,
  createMockPatient,
  createMockRecord,
  createMockDailyRecordContext,
} from '../../integration/setup';
import { PatientStatus } from '@/types/domain/patientClassification';
import { BedType, type BedDefinition } from '@/types/domain/beds';
import * as handoffRowController from '@/features/handoff/controllers/handoffRowController';

describe('HandoffRow', () => {
  const mockPatient = createMockPatient({
    patientName: 'Test Patient',
    pathology: 'Pathology Test',
    admissionDate: '2024-12-01',
    status: PatientStatus.GRAVE,
  });

  const defaultProps = {
    bedName: 'B1',
    bedType: 'Cama' as const,
    patient: mockPatient,
    reportDate: '2024-12-28',
    noteField: 'handoffNoteDayShift' as const,
    onNoteChange: vi.fn(),
    readOnly: false,
  };

  it('renders basic patient information', () => {
    render(
      <table>
        <tbody>
          <HandoffRow {...defaultProps} />
        </tbody>
      </table>
    );
    expect(screen.getByText('Test Patient')).toBeInTheDocument();
    expect(screen.getByText('B1')).toBeInTheDocument();
    expect(screen.getByText('Pathology Test')).toBeInTheDocument();
  });

  it('calculates and displays hospitalized days correctly', () => {
    const patientWithAdmission = createMockPatient({ admissionDate: '2024-12-01' });
    render(
      <table>
        <tbody>
          <HandoffRow {...defaultProps} patient={patientWithAdmission} reportDate="2024-12-11" />
        </tbody>
      </table>
    );
    // Matches the daily census operational counter: elapsed calendar days, without adding one.
    expect(screen.getAllByText(/10d/i)).toHaveLength(2); // One mobile, one desktop
  });

  it('displays status badge with correct color', () => {
    const { rerender } = render(
      <table>
        <tbody>
          <HandoffRow {...defaultProps} />
        </tbody>
      </table>
    );
    expect(screen.getByText(PatientStatus.GRAVE)).toHaveClass('bg-red-50');

    const cuidadoPatient = createMockPatient({ status: PatientStatus.DE_CUIDADO });
    rerender(
      <table>
        <tbody>
          <HandoffRow {...defaultProps} patient={cuidadoPatient} />
        </tbody>
      </table>
    );
    expect(screen.getByText(PatientStatus.DE_CUIDADO)).toHaveClass('bg-orange-50');
  });

  it('displays event indicator when clinicalEvents exist', () => {
    const patientWithEvents = createMockPatient({
      clinicalEvents: [
        { id: '1', name: 'Test Event', date: '2024-12-11', note: '', createdAt: '' },
      ],
    });
    render(
      <table>
        <tbody>
          <HandoffRow {...defaultProps} patient={patientWithEvents} />
        </tbody>
      </table>
    );
    const expandButton = screen.getByTitle(/Ver eventos clínicos/i);
    expect(expandButton).toHaveClass('shadow-sm'); // Indicativo de que tiene eventos (bg-medical-50)
  });

  it('expands clinical events panel when forcedExpand is true', () => {
    const patientWithEvents = createMockPatient({
      clinicalEvents: [
        { id: '1', name: 'Test Event', date: '2024-12-11', note: '', createdAt: '' },
      ],
    });
    const { rerender } = render(
      <table>
        <tbody>
          <HandoffRow
            {...defaultProps}
            patient={patientWithEvents}
            forcedExpand={false}
            clinicalEventActions={{
              onAdd: vi.fn(),
              onUpdate: vi.fn(),
              onDelete: vi.fn(),
            }}
          />
        </tbody>
      </table>
    );
    expect(screen.queryByText('Test Event')).not.toBeInTheDocument();

    rerender(
      <table>
        <tbody>
          <HandoffRow
            {...defaultProps}
            patient={patientWithEvents}
            forcedExpand={true}
            clinicalEventActions={{
              onAdd: vi.fn(),
              onUpdate: vi.fn(),
              onDelete: vi.fn(),
            }}
          />
        </tbody>
      </table>
    );
    expect(screen.getByText('Test Event')).toBeInTheDocument();
  });

  it('skips re-rendering unchanged HandoffRows through HandoffPatientTable on sync, staff, or sibling bed updates', () => {
    const spy = vi.spyOn(handoffRowController, 'resolveHandoffRowReadOnly');
    const beds: BedDefinition[] = [
      { id: 'R1', name: 'R1', type: BedType.UTI, isCuna: false },
      { id: 'R2', name: 'R2', type: BedType.UTI, isCuna: false },
    ];
    const patientR1 = createMockPatient({
      bedId: 'R1',
      patientName: 'Paciente Uno',
      rut: '11.111.111-1',
      handoffNoteDayShift: 'Estable R1',
    });
    const patientR2 = createMockPatient({
      bedId: 'R2',
      patientName: 'Paciente Dos',
      rut: '22.222.222-2',
      handoffNoteDayShift: 'Estable R2',
    });
    const baseRecord = createMockRecord('2026-11-22');
    baseRecord.beds = { R1: patientR1, R2: patientR2 };
    const stableRules = buildStabilityRules(
      { date: baseRecord.date },
      { isAdmin: false, isEditor: true, todayISO: baseRecord.date }
    );
    const onNoteChange = vi.fn();
    const shouldShowPatient = () => true;

    const renderTree = (record: typeof baseRecord, syncStatus: 'saved' | 'saving' = 'saved') => (
      <DailyRecordProvider
        value={{
          ...createMockDailyRecordContext(record),
          syncStatus,
          stabilityRules: stableRules,
        }}
      >
        <HandoffPatientTable
          visibleBeds={beds}
          record={record}
          noteField="handoffNoteDayShift"
          onNoteChange={onNoteChange}
          tableHeaderClass="bg-slate-50"
          readOnly={false}
          hasAnyPatients={true}
          shouldShowPatient={shouldShowPatient}
          clinicalEventActions={{ onAdd: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn() }}
        />
      </DailyRecordProvider>
    );

    const { rerender } = render(renderTree(baseRecord, 'saved'));
    // Initial mount evaluates both occupied rows (useChangedOnRender settles on first render).
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    spy.mockClear();

    // Sync tick + staff edit with unchanged beds: neither row should re-render.
    const recordAfterStaffChange = {
      ...baseRecord,
      nursesDayShift: ['Enfermera A', 'Enfermera B'],
    };
    rerender(renderTree(recordAfterStaffChange, 'saving'));
    expect(spy).toHaveBeenCalledTimes(0);

    // Sibling bed R2 note update: only R2 re-renders; R1 stays untouched.
    const recordAfterR2Edit = {
      ...recordAfterStaffChange,
      beds: {
        ...recordAfterStaffChange.beds,
        R2: { ...patientR2, handoffNoteDayShift: 'Nueva nota R2' },
      },
    };
    rerender(renderTree(recordAfterR2Edit, 'saved'));
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('saves a pending debounced note to its original shift if the shift changes before debounce fires', () => {
    vi.useFakeTimers();
    try {
      const beds: BedDefinition[] = [{ id: 'R1', name: 'R1', type: BedType.UTI, isCuna: false }];
      const patientR1 = createMockPatient({
        bedId: 'R1',
        patientName: 'Paciente Uno',
        rut: '11.111.111-1',
        handoffNoteDayShift: '',
        handoffNoteNightShift: 'Nota nocturna existente',
      });
      const record = createMockRecord('2026-11-22');
      record.beds = { R1: patientR1 };
      const stableRules = buildStabilityRules(
        { date: record.date },
        { isAdmin: false, isEditor: true, todayISO: record.date }
      );
      const onDayNoteChange = vi.fn();
      const onNightNoteChange = vi.fn();
      const shouldShowPatient = () => true;

      const renderShift = (
        noteField: 'handoffNoteDayShift' | 'handoffNoteNightShift',
        onNoteChange: (bedId: string, value: string, isNested: boolean) => void
      ) => (
        <DailyRecordProvider
          value={{
            ...createMockDailyRecordContext(record),
            stabilityRules: stableRules,
          }}
        >
          <HandoffPatientTable
            visibleBeds={beds}
            record={record}
            noteField={noteField}
            onNoteChange={onNoteChange}
            tableHeaderClass="bg-slate-50"
            readOnly={false}
            hasAnyPatients={true}
            shouldShowPatient={shouldShowPatient}
          />
        </DailyRecordProvider>
      );

      const { rerender } = render(renderShift('handoffNoteDayShift', onDayNoteChange));
      const textarea = screen.getByLabelText('Observaciones del paciente');
      fireEvent.focus(textarea);
      fireEvent.change(textarea, { target: { value: 'Nota turno día pendiente' } });

      // Shift switches to night before the 1500ms debounce timer fires (without blur).
      rerender(renderShift('handoffNoteNightShift', onNightNoteChange));

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(onDayNoteChange).toHaveBeenCalledWith('R1', 'Nota turno día pendiente', false);
      expect(onNightNoteChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
