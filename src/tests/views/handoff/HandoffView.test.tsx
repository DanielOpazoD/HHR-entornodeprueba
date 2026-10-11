/** @vitest-environment jsdom */
import '../../setup';
import { mockAuthContextValue } from '../../setup';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import React from 'react';
import { HandoffView } from '@/features/handoff/components/HandoffView';
import {
  render,
  createMockRecord,
  createMockPatient,
  createMockDailyRecordContext,
  createMockUIState,
  mockUseAuthState,
} from '../../integration/setup';

vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({
    nursesList: ['Nurse 1', 'Nurse 2', 'Test Nurse'],
    tensList: ['TENS 1', 'TENS 2'],
    showNurseManager: false,
    setShowNurseManager: vi.fn(),
    showTensManager: false,
    setShowTensManager: vi.fn(),
  }),
  StaffProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('HandoffView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockUseAuthState.user = {
      uid: 'test-user',
      email: 'admin@hospitalhangaroa.cl',
      displayName: 'Admin Test',
      role: 'admin',
    };
    mockUseAuthState.currentUser = mockUseAuthState.user;
    mockUseAuthState.authorizedUser = mockUseAuthState.user;
    mockUseAuthState.sessionState = {
      status: 'authorized',
      user: mockUseAuthState.user,
    };
    mockUseAuthState.role = 'admin';
    mockUseAuthState.isEditor = true;
    mockUseAuthState.isViewer = false;
    mockUseAuthState.canEdit = true;
    Object.assign(
      mockAuthContextValue as {
        role: string;
        isEditor: boolean;
        isViewer: boolean;
      },
      {
        role: 'admin',
        isEditor: true,
        isViewer: false,
      }
    );
  });

  it('renders empty message when no record is selected', () => {
    const { mockContext } = render(<HandoffView />, {
      contextValue: createMockDailyRecordContext(
        null as unknown as ReturnType<typeof createMockRecord>
      ),
    });

    expect(
      screen.getByText(/Seleccione una fecha para ver la Entrega de Turno/i)
    ).toBeInTheDocument();
    expect(mockContext).toBeDefined();
  });

  it('renders nursing handoff with correct title', () => {
    const record = createMockRecord('2024-12-11');

    render(<HandoffView type="nursing" />, {
      contextValue: createMockDailyRecordContext(record),
    });

    expect(screen.getByText(/Entrega Turno Enfermería - Día/i)).toBeInTheDocument();
  });

  it('allows switching between day and night shifts', () => {
    const record = createMockRecord('2024-12-11');
    const ui = createMockUIState({ selectedShift: 'day' });

    const { rerender } = render(<HandoffView type="nursing" ui={ui} />, {
      contextValue: createMockDailyRecordContext(record),
    });

    expect(screen.getByText(/Entrega Turno Enfermería - Día/i)).toBeInTheDocument();

    rerender(<HandoffView type="nursing" ui={{ ...ui, selectedShift: 'night' as const }} />);

    expect(screen.getByText(/Entrega Turno Enfermería - Noche/i)).toBeInTheDocument();
  });

  it('keeps CUDYR access in the census instead of the nursing handoff', () => {
    const record = createMockRecord('2024-12-11');
    const ui = createMockUIState({ selectedShift: 'night' });

    render(<HandoffView type="nursing" ui={ui} />, {
      contextValue: createMockDailyRecordContext(record),
    });

    expect(screen.queryByRole('button', { name: /^CUDYR$/i })).not.toBeInTheDocument();
  });

  it('displays patients based on shift boundaries', () => {
    const record = createMockRecord('2024-12-11');
    record.beds = {};
    record.beds['R1'] = createMockPatient({
      bedId: 'R1',
      patientName: 'PACIENTE DIA',
      admissionDate: '2024-12-11',
      admissionTime: '10:00',
    });
    record.beds['R2'] = createMockPatient({
      bedId: 'R2',
      patientName: 'PACIENTE MANANA',
      admissionDate: '2024-12-12',
      admissionTime: '10:00',
    });
    record.beds['R3'] = createMockPatient({
      bedId: 'R3',
      patientName: 'PACIENTE MADRUGADA',
      admissionDate: '2024-12-12',
      admissionTime: '02:00',
    });

    const dayUi = createMockUIState({ selectedShift: 'day' });
    const { rerender } = render(<HandoffView type="nursing" ui={dayUi} />, {
      contextValue: createMockDailyRecordContext(record),
    });

    const mainTable = screen.getByRole('table');
    expect(within(mainTable).getByText('PACIENTE DIA')).toBeInTheDocument();
    expect(within(mainTable).queryByText('PACIENTE MANANA')).not.toBeInTheDocument();
    expect(within(mainTable).queryByText('PACIENTE MADRUGADA')).not.toBeInTheDocument();

    rerender(<HandoffView type="nursing" ui={{ ...dayUi, selectedShift: 'night' as const }} />);

    const nightTable = screen.getAllByRole('table')[0];
    expect(within(nightTable).getByText('PACIENTE DIA')).toBeInTheDocument();
    expect(within(nightTable).getByText('PACIENTE MADRUGADA')).toBeInTheDocument();
    expect(within(nightTable).queryByText('PACIENTE MANANA')).not.toBeInTheDocument();
  });

  it('updates handoff staff when selection changes (Night Shift only)', async () => {
    const record = createMockRecord('2024-12-11');
    const ui = createMockUIState({ selectedShift: 'night' });

    const { mockContext } = render(<HandoffView type="nursing" ui={ui} />, {
      contextValue: createMockDailyRecordContext(record),
    });

    const receivesLabel = screen.getByText('Recibe');
    const container = receivesLabel.closest('div')?.parentElement;
    expect(container).toBeTruthy();

    const selects = within(container as HTMLElement).getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'Test Nurse' } });

    await waitFor(() => {
      expect(mockContext.updateHandoffStaff).toHaveBeenCalledWith('night', 'receives', [
        'Test Nurse',
        '',
      ]);
    });
  });

  it('displays and updates handoff novedades', async () => {
    const record = createMockRecord('2024-12-11');
    record.handoffNovedadesDayShift = 'Initial novedades';

    const { mockContext } = render(<HandoffView type="nursing" />, {
      contextValue: createMockDailyRecordContext(record),
    });

    const textarea = screen.getByPlaceholderText(/Escriba las novedades del turno aquí/i);
    expect(textarea).toHaveValue('Initial novedades');

    fireEvent.change(textarea, { target: { value: 'Updated novedades' } });
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(mockContext.updateHandoffNovedades).toHaveBeenCalledWith('day', 'Updated novedades');
    });
  });
});
