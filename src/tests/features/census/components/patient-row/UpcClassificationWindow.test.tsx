import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { UpcClassificationWindow } from '@/features/census/components/patient-row/UpcClassificationWindow';
import { DataFactory } from '@/tests/factories/DataFactory';
import { UPC_UCI_CRITERIA, UPC_UTI_CRITERIA } from '@/domain/upc/upcCriteria';

const mocks = vi.hoisted(() => ({
  beds: {} as Record<string, unknown>,
  updatePatientMultiple: vi.fn(async (_bedId: string, _patch: Record<string, unknown>) => true),
  loadPatientUpcHistory: vi.fn(async () => ({ entries: [], warning: null })),
  updateClinicalCribMultiple: vi.fn(
    async (_bedId: string, _patch: Record<string, unknown>) => true
  ),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordBeds: () => mocks.beds,
  useDailyRecordStaff: () => ({
    nursesDayShift: ['Enfermera A', 'Enfermero B'],
    nursesNightShift: [],
  }),
}));
vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordBedActions: () => ({
    updatePatientMultiple: mocks.updatePatientMultiple,
    updateClinicalCribMultiple: mocks.updateClinicalCribMultiple,
  }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'uid-1', displayName: 'Enfermera A', email: 'a@example.com' },
  }),
}));
vi.mock('@/services/patient/patientUpcHistoryService', () => ({
  loadPatientUpcHistory: mocks.loadPatientUpcHistory,
}));

beforeEach(() => {
  mocks.beds = {
    R1: DataFactory.createMockPatient('R1', { patientName: 'Paciente R1', rut: '1-9' }),
    R3: DataFactory.createMockPatient('R3', { patientName: 'Paciente R3', rut: '3-5' }),
  };
  mocks.updatePatientMultiple.mockClear();
  mocks.updateClinicalCribMultiple.mockClear();
  mocks.loadPatientUpcHistory.mockClear();
});

const chooseNurse = () =>
  fireEvent.change(screen.getByLabelText('Enfermero responsable de la ronda UPC'), {
    target: { value: 'Enfermera A' },
  });

const quickButtons = () => screen.getAllByRole('button', { name: /Sin criterios UPC/i });

describe('UpcClassificationWindow', () => {
  it('lists only the occupied classifiable beds', () => {
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);

    expect(
      screen.getByRole('dialog', { name: /Clasificación UPC · 2 camas ocupadas/ })
    ).toBeInTheDocument();
    expect(screen.getByText(/Paciente R1/)).toBeInTheDocument();
    expect(screen.getByText(/Paciente R3/)).toBeInTheDocument();
    expect(screen.queryByText('Cama vacía')).toBeNull();
    expect(screen.getByText(/2 camas ocupadas/)).toBeInTheDocument();
  });

  it('does not write until the round is confirmed', async () => {
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);

    chooseNurse();
    fireEvent.click(quickButtons()[0]);

    expect(mocks.updatePatientMultiple).not.toHaveBeenCalled();
    expect(screen.getByText(/1 cama por confirmar/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));

    await waitFor(() => expect(mocks.updatePatientMultiple).toHaveBeenCalledTimes(1));
    const [bedId, patch] = mocks.updatePatientMultiple.mock.calls[0];
    expect(bedId).toBe('R1');
    expect(patch.isUPC).toBe(false);
    expect(patch.upcChecklist).toMatchObject({
      classification: null,
      evaluatedForDate: '2026-09-15',
      evaluatedBedId: 'R1',
      responsibleNurse: { name: 'Enfermera A', source: 'assigned' },
    });
  });

  it('confirms every marked bed and closes the window', async () => {
    const onClose = vi.fn();
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={onClose} />);

    chooseNurse();
    quickButtons().forEach(button => fireEvent.click(button));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (2)' }));

    await waitFor(() => expect(mocks.updatePatientMultiple).toHaveBeenCalledTimes(2));
    expect(mocks.updatePatientMultiple.mock.calls.map(call => call[0])).toEqual(['R1', 'R3']);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps the window open when it is closed with pending marks', () => {
    const onClose = vi.fn();
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={onClose} />);

    chooseNurse();
    fireEvent.click(quickButtons()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar modal' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Tienes marcaciones sin confirmar: pulsa «Confirmar cambios» o «Cancelar» para cerrar.'
    );
  });

  it('cancels the round without writing anything', () => {
    const onClose = vi.fn();
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={onClose} />);

    chooseNurse();
    fireEvent.click(quickButtons()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(mocks.updatePatientMultiple).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('signs the criteria checked in the detail with the same confirm button', async () => {
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);

    chooseNurse();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver detalle' })[0]);
    fireEvent.click(screen.getAllByLabelText(UPC_UCI_CRITERIA[0].label)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));

    await waitFor(() => expect(mocks.updatePatientMultiple).toHaveBeenCalledTimes(1));
    const [, patch] = mocks.updatePatientMultiple.mock.calls[0];
    expect(patch.isUPC).toBe(true);
    expect(patch.upcChecklist).toMatchObject({
      uciCriteria: [UPC_UCI_CRITERIA[0].id],
      classification: 'UPC_UCI',
      responsibleNurse: { name: 'Enfermera A', source: 'assigned' },
    });
  });

  it('writes the clinical crib through the crib patch of its parent bed', async () => {
    mocks.beds = {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Madre',
        clinicalCrib: DataFactory.createMockPatient('R1', { patientName: 'Recién nacido' }),
      }),
    };
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);

    chooseNurse();
    expect(screen.getByText('R1 · cuna clínica')).toBeInTheDocument();
    const cribRow = screen.getByText('R1 · cuna clínica').closest('li');
    expect(cribRow).not.toBeNull();
    fireEvent.click(
      within(cribRow as HTMLElement).getByRole('button', { name: /Sin criterios UPC/i })
    );
    expect(screen.getByText(/1 cama por confirmar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar cambios (1)' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));

    await waitFor(() => expect(mocks.updateClinicalCribMultiple).toHaveBeenCalledTimes(1));
    const [bedId, patch] = mocks.updateClinicalCribMultiple.mock.calls[0];
    expect(bedId).toBe('R1');
    expect(patch.upcChecklist).toMatchObject({ evaluatedBedId: 'R1', classification: null });
    expect(mocks.updatePatientMultiple).not.toHaveBeenCalled();
  });

  it('opens the clinical crib detail instead of selecting its mother row', () => {
    mocks.beds = {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Madre',
        clinicalCrib: DataFactory.createMockPatient('R1', { patientName: 'Recién nacido' }),
      }),
    };
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);

    const cribRow = screen.getByText('R1 · cuna clínica').closest('li') as HTMLElement;
    fireEvent.click(within(cribRow).getByRole('button', { name: 'Ver detalle' }));

    expect(
      within(screen.getByRole('dialog', { name: 'Checklist de clasificación UPC' })).getByText(
        '· R1 · cuna clínica'
      )
    ).toBeInTheDocument();
  });

  it('discards a mark when the bed occupant changes before its write', async () => {
    const { rerender } = render(
      <UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />
    );
    chooseNurse();
    fireEvent.click(quickButtons()[0]);

    mocks.beds = {
      ...mocks.beds,
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Paciente nuevo',
        rut: '99-9',
        clinicalEpisodeId: 'episode-new',
      }),
    };
    rerender(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Cambió el paciente de una cama')
    );
    expect(mocks.updatePatientMultiple).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Confirmar cambios (1)' })).toBeNull();
  });

  it('recovers from a rejected write and leaves confirmation available', async () => {
    mocks.updatePatientMultiple.mockRejectedValueOnce(new Error('network'));
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);
    chooseNurse();
    fireEvent.click(quickButtons()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('No se pudo confirmar')
    );
    expect(screen.getByRole('button', { name: 'Confirmar cambios (1)' })).toBeEnabled();
  });

  it('rebuilds failed records after criteria, nurse and marked beds change', async () => {
    mocks.updatePatientMultiple.mockResolvedValueOnce(false);
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);
    chooseNurse();
    fireEvent.click(quickButtons()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    fireEvent.click(quickButtons()[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver detalle' })[0]);
    fireEvent.click(screen.getAllByLabelText(UPC_UCI_CRITERIA[0].label)[0]);
    fireEvent.click(quickButtons()[1]);
    fireEvent.change(screen.getByLabelText('Enfermero responsable de la ronda UPC'), {
      target: { value: 'Enfermero B' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (2)' }));

    await waitFor(() => expect(mocks.updatePatientMultiple).toHaveBeenCalledTimes(3));
    const retried = mocks.updatePatientMultiple.mock.calls.slice(1);
    expect(retried.map(call => call[0])).toEqual(['R1', 'R3']);
    expect(retried[0][1].upcChecklist).toMatchObject({
      uciCriteria: [UPC_UCI_CRITERIA[0].id],
      responsibleNurse: { name: 'Enfermero B' },
    });
    expect(retried[1][1].upcChecklist).toMatchObject({
      classification: null,
      responsibleNurse: { name: 'Enfermero B' },
    });
  });

  it('disables rows, criteria and nurse selection while writes are pending', async () => {
    let finishWrite: ((value: boolean) => void) | undefined;
    mocks.updatePatientMultiple.mockImplementationOnce(
      () => new Promise<boolean>(resolve => (finishWrite = resolve))
    );
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);
    chooseNurse();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver detalle' })[0]);
    fireEvent.click(screen.getAllByLabelText(UPC_UCI_CRITERIA[0].label)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));

    await waitFor(() => expect(mocks.updatePatientMultiple).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Enfermero responsable de la ronda UPC')).toBeDisabled();
    expect(quickButtons().every(button => button.hasAttribute('disabled'))).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Ver detalle' })[0]).toBeDisabled();
    expect(screen.getAllByLabelText(UPC_UCI_CRITERIA[0].label)[0]).toBeDisabled();

    await act(async () => finishWrite?.(true));
  });

  it('does not re-persist legacy or UCI criteria from a Neo draft', async () => {
    mocks.beds = {
      NEO1: DataFactory.createMockPatient('NEO1', {
        patientName: 'Paciente Neo',
        upcChecklist: {
          uciCriteria: ['uci_vmi', 'uci_obsoleto'],
          utiCriteria: ['uti_obsoleto'],
          classification: 'UPC_UCI',
          evaluatedAt: '2026-09-14T12:00:00.000Z',
        },
      }),
    };
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);
    chooseNurse();
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    fireEvent.click(screen.getAllByLabelText(UPC_UTI_CRITERIA[0].label)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));

    await waitFor(() => expect(mocks.updatePatientMultiple).toHaveBeenCalledTimes(1));
    expect(mocks.updatePatientMultiple.mock.calls[0][1].upcChecklist).toMatchObject({
      uciCriteria: [],
      utiCriteria: [UPC_UTI_CRITERIA[0].id],
      classification: 'UPC_UTI',
    });
  });

  it('blocks confirmation until a responsible nurse is chosen and opens the detail panel', () => {
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);

    fireEvent.click(quickButtons()[0]);
    expect(screen.getByRole('button', { name: 'Confirmar cambios (1)' })).toBeDisabled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Ver detalle' })[0]);
    expect(
      screen.getByRole('dialog', { name: 'Checklist de clasificación UPC' })
    ).toBeInTheDocument();
  });
});
