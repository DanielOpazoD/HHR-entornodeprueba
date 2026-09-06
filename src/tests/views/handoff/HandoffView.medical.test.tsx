/** @vitest-environment jsdom */
import '../../setup';
import { mockAuthContextValue } from '../../setup';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, fireEvent, within, waitFor } from '@testing-library/react';
import React from 'react';

import { HandoffView } from '@/features/handoff/components/HandoffView';
import { DailyRecordProvider } from '@/context/DailyRecordContext';
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

const setAuthorizedSpecialistAuth = () => {
  const specialistUser = {
    uid: 'specialist-1',
    email: 'specialist@hospitalhangaroa.cl',
    displayName: 'Dr. Specialist',
    role: 'doctor_specialist' as const,
  };

  mockUseAuthState.user = specialistUser;
  mockUseAuthState.currentUser = specialistUser;
  mockUseAuthState.authorizedUser = specialistUser;
  mockUseAuthState.sessionState = {
    status: 'authorized',
    user: specialistUser,
  };
  mockUseAuthState.role = 'doctor_specialist';
  mockUseAuthState.isEditor = true;
  mockUseAuthState.isViewer = false;
  mockUseAuthState.canEdit = true;
  Object.assign(
    mockAuthContextValue as {
      user: {
        uid: string;
        email: string;
        displayName: string;
        getIdToken: ReturnType<typeof vi.fn>;
      };
      role: string;
      isEditor: boolean;
      isViewer: boolean;
    },
    {
      user: {
        ...specialistUser,
        getIdToken: vi.fn().mockResolvedValue('specialist-token'),
      },
      role: 'doctor_specialist',
      isEditor: true,
      isViewer: false,
    }
  );
};

describe('HandoffView medical flows', () => {
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

  it('handles medical handoff view', () => {
    const record = createMockRecord('2024-12-11');
    record.beds['R1'] = createMockPatient({
      bedId: 'R1',
      patientName: 'PACIENTE MEDICINA',
      specialty: 'Med Interna',
    });
    record.beds['R2'] = createMockPatient({
      bedId: 'R2',
      patientName: 'PACIENTE CIRUGIA',
      specialty: 'Cirugía',
    });

    render(<HandoffView type="medical" />, {
      contextValue: createMockDailyRecordContext(record),
    });

    expect(screen.getByText(/Entrega Turno Médicos/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Especialidad/i).length).toBeGreaterThan(0);

    const specialtySelect = screen.getByRole('combobox');
    expect(within(specialtySelect).getByRole('option', { name: 'Cirugía' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /crear entrega de turno médica/i })).toBeInTheDocument();
  });

  it('keeps patient-level medical handoff creation enabled for doctor_specialist on the current day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-12T12:00:00-06:00'));
    setAuthorizedSpecialistAuth();

    const record = createMockRecord('2026-04-12');
    record.beds['R1'] = createMockPatient({
      bedId: 'R1',
      patientName: 'PACIENTE ESPECIALISTA',
      medicalHandoffNote: '',
      medicalHandoffEntries: [],
    });

    render(<HandoffView type="medical" />, {
      contextValue: createMockDailyRecordContext(record),
    });

    const mainTable = screen.getAllByRole('table')[0];
    expect(within(mainTable).getByRole('button', { name: /crear entrega/i })).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('keeps existing medical handoff entries editable for doctor_specialist during the overnight clinical day window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 6, 59, 0));
    setAuthorizedSpecialistAuth();

    const record = createMockRecord('2026-04-21');
    record.beds['R1'] = createMockPatient({
      bedId: 'R1',
      patientName: 'PACIENTE ESPECIALISTA',
      medicalHandoffNote: 'Plan vigente',
      medicalHandoffEntries: [
        {
          id: 'entry-1',
          specialty: 'Med Interna',
          note: 'Plan vigente',
        },
      ],
    });

    render(<HandoffView type="medical" />, {
      contextValue: createMockDailyRecordContext(record),
    });

    const mainTable = screen.getAllByRole('table')[0];
    expect(within(mainTable).getByDisplayValue('Plan vigente')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('blocks specialist editing outside the overnight clinical day window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 9, 1, 0));
    setAuthorizedSpecialistAuth();

    const record = createMockRecord('2026-04-21');
    record.beds['R1'] = createMockPatient({
      bedId: 'R1',
      patientName: 'PACIENTE ESPECIALISTA',
      medicalHandoffNote: '',
      medicalHandoffEntries: [],
    });

    render(<HandoffView type="medical" />, {
      contextValue: createMockDailyRecordContext(record),
    });

    const mainTable = screen.getAllByRole('table')[0];
    expect(
      within(mainTable).queryByRole('button', { name: /crear entrega/i })
    ).not.toBeInTheDocument();
    expect(within(mainTable).getByText(/sin entrega registrada/i)).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('keeps the first specialist save visible in HandoffView while a stale snapshot briefly removes the new entry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T12:00:00-06:00'));
    setAuthorizedSpecialistAuth();

    const bedId = 'R1';
    const buildRecord = () => {
      const nextRecord = createMockRecord('2026-04-22');
      nextRecord.beds[bedId] = createMockPatient({
        bedId,
        patientName: 'PACIENTE ESPECIALISTA',
        medicalHandoffNote: '',
        medicalHandoffEntries: [],
      });
      return nextRecord;
    };

    const FirstSpecialistSaveRoundTrip = () => {
      const [record, setRecord] = React.useState(buildRecord);

      const applyPatientFields = React.useCallback((fields: Record<string, unknown>) => {
        setRecord(current => ({
          ...current,
          beds: {
            ...current.beds,
            [bedId]: {
              ...current.beds[bedId],
              ...fields,
            },
          },
        }));
      }, []);

      const contextValue = React.useMemo(() => {
        const context = createMockDailyRecordContext(record);
        context.updatePatientMultiple = vi.fn(async (targetBedId, fields) => {
          if (targetBedId !== bedId) {
            return;
          }

          const patientFields = fields as Record<string, unknown>;
          const nextNote =
            typeof patientFields.medicalHandoffNote === 'string'
              ? patientFields.medicalHandoffNote.trim()
              : '';

          if (!nextNote) {
            applyPatientFields(patientFields);
            return;
          }

          setRecord(current => ({
            ...current,
            beds: {
              ...current.beds,
              [bedId]: {
                ...current.beds[bedId],
                medicalHandoffEntries: [],
                medicalHandoffNote: '',
                medicalHandoffAudit: undefined,
              },
            },
          }));

          window.setTimeout(() => {
            applyPatientFields(patientFields);
          }, 50);
        });

        return context;
      }, [applyPatientFields, record]);

      return (
        <DailyRecordProvider value={contextValue}>
          <HandoffView type="medical" />
        </DailyRecordProvider>
      );
    };

    render(<FirstSpecialistSaveRoundTrip />);

    fireEvent.click(
      within(screen.getAllByRole('table')[0]).getByRole('button', { name: /crear entrega/i })
    );

    const textarea = within(screen.getAllByRole('table')[0]).getByRole('textbox');
    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: 'Primera evolución especialista' } });
    fireEvent.blur(textarea);

    const getInteractiveSavedNotes = () =>
      within(screen.getAllByRole('table')[0]).getAllByDisplayValue(
        'Primera evolución especialista'
      );

    expect(getInteractiveSavedNotes().length).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(25);
    });
    expect(getInteractiveSavedNotes().length).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(getInteractiveSavedNotes().length).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it('shows clinical events controls in the medical diagnosis column', async () => {
    const record = createMockRecord('2024-12-11');
    record.beds['R1'] = createMockPatient({
      bedId: 'R1',
      patientName: 'PACIENTE MEDICINA',
      pathology: 'Neumonía',
      clinicalEvents: [
        {
          id: 'evt-1',
          name: 'Broncoscopía',
          date: '2024-12-11',
          note: 'Sin incidentes',
          createdAt: '2024-12-11T10:00:00.000Z',
        },
      ],
    });

    render(<HandoffView type="medical" />, {
      contextValue: createMockDailyRecordContext(record),
    });

    fireEvent.click(screen.getAllByTitle(/Expandir todos los eventos/i)[0]);

    expect(await screen.findByText('Broncoscopía')).toBeInTheDocument();
  });

  it('filters medical handoff patients by census specialty', async () => {
    const record = createMockRecord('2024-12-11');
    record.beds['R1'] = createMockPatient({
      bedId: 'R1',
      patientName: 'PACIENTE MEDICINA',
      specialty: 'Med Interna',
    });
    record.beds['R2'] = createMockPatient({
      bedId: 'R2',
      patientName: 'PACIENTE CIRUGIA',
      specialty: 'Cirugía',
    });

    const { mockContext } = render(<HandoffView type="medical" />, {
      contextValue: createMockDailyRecordContext(record),
    });

    const initialTable = screen.getAllByRole('table')[0];
    expect(within(initialTable).getByText('PACIENTE MEDICINA')).toBeInTheDocument();
    expect(within(initialTable).getByText('PACIENTE CIRUGIA')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Cirugía' } });

    await waitFor(() => {
      const filteredTable = screen.getAllByRole('table')[0];
      expect(within(filteredTable).queryByText('PACIENTE MEDICINA')).not.toBeInTheDocument();
      expect(within(filteredTable).getByText('PACIENTE CIRUGIA')).toBeInTheDocument();
    });

    expect(mockContext.updateMedicalSpecialtyNote).not.toHaveBeenCalled();
  });

  it('renders top medical scope controls and filters the table by UPC status', async () => {
    const record = createMockRecord('2024-12-11');
    record.beds['R1'] = {
      ...createMockPatient({
        bedId: 'R1',
        patientName: 'PACIENTE UPC',
        specialty: 'Med Interna',
      }),
      isUPC: true,
    };
    record.beds['H1C1'] = createMockPatient({
      bedId: 'H1C1',
      patientName: 'PACIENTE NO UPC',
      specialty: 'Med Interna',
    });

    render(<HandoffView type="medical" medicalScope="all" />, {
      contextValue: createMockDailyRecordContext(record),
    });

    expect(screen.getByRole('button', { name: /^todos \(2\)$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^upc \(1\)$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^no upc \(1\)$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /imprimir/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^upc \(1\)$/i }));

    await waitFor(() => {
      const filteredTable = screen.getAllByRole('table')[0];
      expect(within(filteredTable).getByText('PACIENTE UPC')).toBeInTheDocument();
      expect(within(filteredTable).queryByText('PACIENTE NO UPC')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^no upc \(1\)$/i }));

    await waitFor(() => {
      const filteredTable = screen.getAllByRole('table')[0];
      expect(within(filteredTable).getByText('PACIENTE NO UPC')).toBeInTheDocument();
      expect(within(filteredTable).queryByText('PACIENTE UPC')).not.toBeInTheDocument();
    });
  });

  it('shows scoped medical signature only in the matching filtered view', () => {
    const record = createMockRecord('2024-12-11');
    record.beds['R1'] = {
      ...createMockPatient({
        bedId: 'R1',
        patientName: 'PACIENTE UPC',
        admissionDate: '2024-12-11',
        admissionTime: '10:00',
      }),
      isUPC: true,
    };
    record.medicalSignatureByScope = {
      upc: {
        doctorName: 'Dr. UPC',
        signedAt: '2024-12-11T10:00:00.000Z',
      },
    };

    const { rerender } = render(<HandoffView type="medical" medicalScope="all" />, {
      contextValue: createMockDailyRecordContext(record),
    });

    expect(screen.queryByText('Dr. UPC')).not.toBeInTheDocument();
    expect(screen.getByText(/Pendiente de firma/i)).toBeInTheDocument();

    rerender(<HandoffView type="medical" medicalScope="upc" />);

    expect(screen.getByText('Dr. UPC')).toBeInTheDocument();
  });

  it('does not rewrite the signature link URL when an external ui state is provided', () => {
    window.history.replaceState(
      {},
      '',
      '/admin?mode=signature&date=2026-04-05&scope=all&token=test-token'
    );

    const record = createMockRecord('2026-04-05');
    const ui = createMockUIState({
      currentModule: 'MEDICAL_HANDOFF',
    });

    render(<HandoffView type="medical" readOnly={true} ui={ui} medicalScope="all" />, {
      contextValue: createMockDailyRecordContext(record),
    });

    expect(window.location.pathname).toBe('/admin');
    expect(window.location.search).toBe(
      '?mode=signature&date=2026-04-05&scope=all&token=test-token'
    );
  });
});
