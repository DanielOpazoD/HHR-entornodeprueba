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
    mockUseAuthState.currentUser = {
      uid: 'test-user',
      email: 'admin@hospitalhangaroa.cl',
      displayName: 'Admin Test',
      role: 'admin',
    };
    mockUseAuthState.authorizedUser = mockUseAuthState.currentUser;
    mockUseAuthState.sessionState = {
      status: 'authorized',
      user: mockUseAuthState.currentUser,
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

  it('explains that the day has no census when the server confirms it is empty', () => {
    const { mockContext } = render(<HandoffView />, {
      contextValue: createMockDailyRecordContext(null),
    });

    expect(screen.getByText('Este día no tiene censo.')).toBeInTheDocument();
    expect(
      screen.getByText('La entrega de turno aparece cuando existe el censo del día.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Seleccione una fecha/i)).not.toBeInTheDocument();
    expect(mockContext).toBeDefined();
  });

  it('shows a read-failure alert instead of an empty state on remote_record_timeout', () => {
    const contextValue = {
      ...createMockDailyRecordContext(null),
      bootstrapPhase: 'remote_record_timeout' as const,
    };

    render(<HandoffView />, { contextValue });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('No se pudo leer la entrega de turno de este día.');
    expect(alert).toHaveTextContent(
      'Revisa tu conexión. Se volverá a intentar al recuperarla o al volver a esta ventana.'
    );
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.queryByText('Este día no tiene censo.')).not.toBeInTheDocument();
    expect(screen.queryByText(/Seleccione una fecha/i)).not.toBeInTheDocument();
  });

  it.each([
    'remote_runtime_bootstrapping',
    'remote_record_bootstrapping',
    'local_only',
    'record_ready',
  ] as const)('shows the loading state when record is null during %s', bootstrapPhase => {
    render(<HandoffView />, {
      contextValue: {
        ...createMockDailyRecordContext(null),
        bootstrapPhase,
      },
    });

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Cargando')).toBeInTheDocument();
    expect(screen.queryByText('Este día no tiene censo.')).not.toBeInTheDocument();
    expect(screen.queryByText(/Seleccione una fecha/i)).not.toBeInTheDocument();
  });

  it('renders nursing handoff with correct title', () => {
    const record = createMockRecord('2024-12-11');

    render(<HandoffView />, {
      contextValue: createMockDailyRecordContext(record),
    });

    expect(screen.getByText(/Entrega Turno Enfermería - Día/i)).toBeInTheDocument();
  });

  it('allows switching between day and night shifts', () => {
    const record = createMockRecord('2024-12-11');
    const ui = createMockUIState({ selectedShift: 'day' });

    const { rerender } = render(<HandoffView ui={ui} />, {
      contextValue: createMockDailyRecordContext(record),
    });

    expect(screen.getByText(/Entrega Turno Enfermería - Día/i)).toBeInTheDocument();

    rerender(<HandoffView ui={{ ...ui, selectedShift: 'night' as const }} />);

    expect(screen.getByText(/Entrega Turno Enfermería - Noche/i)).toBeInTheDocument();
  });

  it('shows compact shift controls without the conflict center icon in nursing', () => {
    const record = createMockRecord('2024-12-11');
    render(<HandoffView ui={createMockUIState({ selectedShift: 'day' })} />, {
      contextValue: createMockDailyRecordContext(record),
    });
    expect(screen.getByRole('button', { name: 'Turno Largo' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Turno Noche' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(
      screen.queryByRole('button', { name: /Centro de conflictos clínicos/i })
    ).not.toBeInTheDocument();
  });

  it('keeps CUDYR access in the census instead of the nursing handoff', () => {
    const record = createMockRecord('2024-12-11');
    const ui = createMockUIState({ selectedShift: 'night' });

    render(<HandoffView ui={ui} />, {
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
    const { rerender } = render(<HandoffView ui={dayUi} />, {
      contextValue: createMockDailyRecordContext(record),
    });

    const mainTable = screen.getByRole('table');
    expect(within(mainTable).getByText('PACIENTE DIA')).toBeInTheDocument();
    expect(within(mainTable).queryByText('PACIENTE MANANA')).not.toBeInTheDocument();
    expect(within(mainTable).queryByText('PACIENTE MADRUGADA')).not.toBeInTheDocument();

    rerender(<HandoffView ui={{ ...dayUi, selectedShift: 'night' as const }} />);

    const nightTable = screen.getAllByRole('table')[0];
    expect(within(nightTable).getByText('PACIENTE DIA')).toBeInTheDocument();
    expect(within(nightTable).getByText('PACIENTE MADRUGADA')).toBeInTheDocument();
    expect(within(nightTable).queryByText('PACIENTE MANANA')).not.toBeInTheDocument();
  });

  it('updates handoff staff when selection changes (Night Shift only)', async () => {
    const record = createMockRecord('2024-12-11');
    const ui = createMockUIState({ selectedShift: 'night' });

    const { mockContext } = render(<HandoffView ui={ui} />, {
      contextValue: createMockDailyRecordContext(record),
    });

    const receivesLabel = screen.getByText('Recibe');
    const container = receivesLabel.closest('div')?.parentElement;
    expect(container).toBeTruthy();

    const selects = within(container as HTMLElement).getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'Test Nurse' } });

    await waitFor(() => {
      expect(mockContext.updateHandoffReceives).toHaveBeenCalledWith('night', ['Test Nurse', '']);
    });
  });

  it('displays and updates handoff novedades', async () => {
    const record = createMockRecord('2024-12-11');
    record.handoffNovedadesDayShift = 'Initial novedades';

    const { mockContext } = render(<HandoffView />, {
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
