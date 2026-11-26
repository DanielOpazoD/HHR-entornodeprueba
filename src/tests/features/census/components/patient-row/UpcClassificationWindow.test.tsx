import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { UpcClassificationWindow } from '@/features/census/components/patient-row/UpcClassificationWindow';
import type { UpcRoundEvaluation } from '@/domain/upc/upcContracts';
import { DataFactory } from '@/tests/factories/DataFactory';
import { UPC_UCI_CRITERIA, UPC_UTI_CRITERIA } from '@/domain/upc/upcCriteria';

const mocks = vi.hoisted(() => ({
  beds: {} as Record<string, unknown>,
  confirmUpcRound: vi.fn(async (_entries: readonly UpcRoundEvaluation[]) => true),
  actor: { uid: 'uid-1', displayName: 'Enfermera A', email: 'a@example.com' } as {
    uid: string;
    displayName: string;
    email: string;
  } | null,
  loadPatientUpcHistory: vi.fn(async () => ({ entries: [], warning: null })),
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordBeds: () => mocks.beds,
}));
vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordBedActions: () => ({ confirmUpcRound: mocks.confirmUpcRound }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: mocks.actor,
  }),
}));
vi.mock('@/features/census/services/patientUpcHistoryService', () => ({
  loadPatientUpcHistory: mocks.loadPatientUpcHistory,
}));

beforeEach(() => {
  mocks.beds = {
    R1: DataFactory.createMockPatient('R1', { patientName: 'Paciente R1', rut: '1-9' }),
    R3: DataFactory.createMockPatient('R3', { patientName: 'Paciente R3', rut: '3-5' }),
  };
  mocks.confirmUpcRound.mockReset().mockResolvedValue(true);
  mocks.actor = { uid: 'uid-1', displayName: 'Enfermera A', email: 'a@example.com' };
  mocks.loadPatientUpcHistory.mockClear();
});

const quickButtons = () => screen.getAllByRole('button', { name: /Sin criterios UPC/i });
const date = '2026-09-15';
const signedR1 = () =>
  DataFactory.createMockPatient('R1', {
    patientName: 'Paciente R1',
    upcChecklist: {
      uciCriteria: [],
      utiCriteria: [],
      classification: null,
      signatureSource: 'session',
      evaluatedBy: { uid: 'test-nurse', displayName: 'Profesional de prueba' },
      evaluatedAt: '2026-09-15T14:42:00Z',
      evaluatedForDate: date,
      evaluatedBedId: 'R1',
    },
  });

describe('UpcClassificationWindow', () => {
  it('opens on the first pending subject, skips saved rows and drafts, and wraps without writing', async () => {
    mocks.beds = {
      ...mocks.beds,
      R1: signedR1(),
      R4: DataFactory.createMockPatient('R4', { patientName: 'Paciente R4' }),
    };
    render(<UpcClassificationWindow currentDateString={date} onClose={vi.fn()} />);
    const next = screen.getByRole('button', { name: 'Siguiente pendiente' });
    const selection = (id: string) =>
      screen.getByRole('button', { name: new RegExp('^' + id + '.*Paciente') });
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Clasificación UPC · 1 de 3 confirmadas'
    );
    expect(selection('R1')).toHaveAccessibleDescription(/Confirmada.*Sin criterios.*09:42/);
    expect(selection('R3')).toHaveAttribute('aria-current', 'true');
    fireEvent.click(next);
    expect(selection('R4')).toHaveAttribute('aria-current', 'true');
    fireEvent.click(next);
    expect(selection('R3')).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Marcar sin criterios UPC en R3' }));
    expect(selection('R3')).toHaveAccessibleDescription(/Borrador · Sin criterios/);
    fireEvent.click(next);
    expect(selection('R4')).toHaveAttribute('aria-current', 'true');
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: UPC_UCI_CRITERIA[0].label }));
    expect(selection('R4')).toHaveAccessibleDescription(/Borrador · UCI/);
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Clasificación UPC · 1 de 3 confirmadas'
    );
    expect(mocks.confirmUpcRound).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (2)' }));
    await waitFor(() => expect(mocks.confirmUpcRound).toHaveBeenCalledTimes(1));
  });

  it('honors an explicit confirmed bed and keeps the attached crib independently pending', () => {
    mocks.beds = {
      R1: {
        ...signedR1(),
        clinicalCrib: DataFactory.createMockPatient('R1', { patientName: 'Recién nacido' }),
      },
    };
    render(
      <UpcClassificationWindow currentDateString={date} initialBedId="R1" onClose={vi.fn()} />
    );
    const mother = screen.getByRole('button', { name: /^R1.*Paciente R1/ });
    expect(mother).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByText('Ver detalle')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Marcar sin criterios UPC en R1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente pendiente' }));
    expect(screen.getByRole('button', { name: /cuna clínica.*Recién nacido/ })).toHaveAttribute(
      'aria-current',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Siguiente pendiente' })).toBeDisabled();
  });

  it('keeps completed and empty rounds available for consultation', () => {
    mocks.beds = { R1: signedR1() };
    const ui = () => (
      <UpcClassificationWindow currentDateString={date} readOnly onClose={vi.fn()} />
    );
    const { rerender } = render(ui());
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Clasificación UPC · 1 de 1 confirmada'
    );
    expect(screen.getByRole('button', { name: /^R1.*Paciente/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Siguiente pendiente' })).toBeDisabled();
    mocks.beds = {};
    rerender(ui());
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Clasificación UPC · 0 de 0 confirmadas'
    );
    expect(screen.getByRole('button', { name: 'Siguiente pendiente' })).toBeDisabled();
  });
  it('lists only the occupied classifiable beds', () => {
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);

    expect(
      screen.getByRole('dialog', { name: /Clasificación UPC · 0 de 2 confirmadas/ })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^R1.*Paciente R1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^R3.*Paciente R3/ })).toBeInTheDocument();
    expect(screen.queryByText('Cama vacía')).toBeNull();
    expect(screen.getByText(/0 de 2 confirmadas/)).toBeInTheDocument();
  });

  it('does not write until the round is confirmed', async () => {
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);

    fireEvent.click(quickButtons()[0]);

    expect(mocks.confirmUpcRound).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));

    await waitFor(() => expect(mocks.confirmUpcRound).toHaveBeenCalledTimes(1));
    const { bedId, record } = mocks.confirmUpcRound.mock.calls[0][0][0];
    expect(bedId).toBe('R1');
    expect(record).toMatchObject({
      classification: null,
      evaluatedForDate: '2026-09-15',
      evaluatedBedId: 'R1',
      evaluatedBy: { uid: 'uid-1', displayName: 'Enfermera A' },
      signatureSource: 'session',
    });
  });

  it('confirms every marked bed and closes the window', async () => {
    const onClose = vi.fn();
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={onClose} />);

    quickButtons().forEach(button => fireEvent.click(button));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (2)' }));

    await waitFor(() => expect(mocks.confirmUpcRound).toHaveBeenCalledTimes(1));
    expect(mocks.confirmUpcRound.mock.calls[0][0].map(entry => entry.bedId)).toEqual(['R1', 'R3']);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps the window open when it is closed with pending marks', () => {
    const onClose = vi.fn();
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={onClose} />);

    fireEvent.click(quickButtons()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar modal' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Tienes marcaciones sin confirmar. Pulsa «Confirmar cambios» o «Cancelar» para cerrar.'
    );
  });

  it('cancels the round without writing anything', () => {
    const onClose = vi.fn();
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={onClose} />);

    fireEvent.click(quickButtons()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(mocks.confirmUpcRound).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('signs the criteria checked in the detail with the same confirm button', async () => {
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /^R1.*Paciente R1/ }));
    fireEvent.click(screen.getAllByLabelText(UPC_UCI_CRITERIA[0].label)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));

    await waitFor(() => expect(mocks.confirmUpcRound).toHaveBeenCalledTimes(1));
    const { record } = mocks.confirmUpcRound.mock.calls[0][0][0];
    expect(record).toMatchObject({
      uciCriteria: [UPC_UCI_CRITERIA[0].id],
      classification: 'UPC_UCI',
      evaluatedBy: { uid: 'uid-1', displayName: 'Enfermera A' },
      signatureSource: 'session',
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

    expect(screen.getByText('R1 · cuna clínica')).toBeInTheDocument();
    const cribRow = screen.getByText('R1 · cuna clínica').closest('li');
    expect(cribRow).not.toBeNull();
    fireEvent.click(
      within(cribRow as HTMLElement).getByRole('button', { name: /Sin criterios UPC/i })
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirmar cambios (1)' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));

    await waitFor(() => expect(mocks.confirmUpcRound).toHaveBeenCalledTimes(1));
    expect(mocks.confirmUpcRound.mock.calls[0][0]).toMatchObject([
      { bedId: 'R1', isCrib: true, record: { classification: null } },
    ]);
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
    fireEvent.click(within(cribRow).getByRole('button', { name: /cuna clínica.*Recién nacido/ }));

    expect(
      within(screen.getByRole('region', { name: 'Checklist de clasificación UPC' })).getByText(
        '· R1 · cuna clínica'
      )
    ).toBeInTheDocument();
  });

  it('discards a mark when the bed occupant changes before its write', async () => {
    const { rerender } = render(
      <UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />
    );
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
      expect(screen.getByRole('alert')).toHaveTextContent(
        /Cambió el paciente o la evaluación en R1/
      )
    );
    expect(mocks.confirmUpcRound).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Confirmar cambios (1)' })).toBeNull();
  });

  it('recovers from a rejected write and leaves confirmation available', async () => {
    mocks.confirmUpcRound.mockRejectedValueOnce(new Error('network'));
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);
    fireEvent.click(quickButtons()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));

    const retry = await screen.findByRole('button', { name: 'Reintentar confirmación (1)' });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.confirmUpcRound).toHaveBeenCalledTimes(2));
    expect(mocks.confirmUpcRound.mock.calls[1][0][0].record).toEqual(
      mocks.confirmUpcRound.mock.calls[0][0][0].record
    );
  });

  it('rebuilds failed records when the criteria or marked beds change', async () => {
    mocks.confirmUpcRound.mockResolvedValueOnce(false);
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);
    fireEvent.click(quickButtons()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));
    await screen.findByRole('button', { name: 'Reintentar confirmación (1)' });

    fireEvent.click(quickButtons()[0]);
    fireEvent.click(screen.getByRole('button', { name: /^R1.*Paciente R1/ }));
    fireEvent.click(screen.getAllByLabelText(UPC_UCI_CRITERIA[0].label)[0]);
    fireEvent.click(quickButtons()[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (2)' }));

    await waitFor(() => expect(mocks.confirmUpcRound).toHaveBeenCalledTimes(2));
    const retried = mocks.confirmUpcRound.mock.calls[1][0];
    expect(retried).toHaveLength(2);
    expect(retried.find(entry => entry.bedId === 'R1')?.record).toMatchObject({
      uciCriteria: [UPC_UCI_CRITERIA[0].id],
      evaluatedBy: { uid: 'uid-1' },
    });
    expect(retried.find(entry => entry.bedId === 'R3')?.record.classification).toBeNull();
  });

  it('freezes edits and repeated confirmation until the server responds', async () => {
    let finishWrite: ((value: boolean) => void) | undefined;
    mocks.confirmUpcRound.mockImplementationOnce(
      () => new Promise<boolean>(resolve => (finishWrite = resolve))
    );
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^R1.*Paciente R1/ }));
    fireEvent.click(screen.getAllByLabelText(UPC_UCI_CRITERIA[0].label)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));

    await waitFor(() => expect(mocks.confirmUpcRound).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Confirmando…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmando…' }));
    expect(mocks.confirmUpcRound).toHaveBeenCalledTimes(1);
    expect(quickButtons().every(button => button.hasAttribute('disabled'))).toBe(true);
    expect(screen.getByRole('button', { name: /^R1.*Paciente R1/ })).toBeDisabled();
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
    fireEvent.click(screen.getByRole('button', { name: /Paciente Neo/ }));
    fireEvent.click(screen.getAllByLabelText(UPC_UTI_CRITERIA[0].label)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));

    await waitFor(() => expect(mocks.confirmUpcRound).toHaveBeenCalledTimes(1));
    expect(mocks.confirmUpcRound.mock.calls[0][0][0].record).toMatchObject({
      uciCriteria: [],
      utiCriteria: [UPC_UTI_CRITERIA[0].id],
      classification: 'UPC_UTI',
    });
  });

  it('uses the signed-in user directly and opens the detail in the same window', () => {
    render(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);

    fireEvent.click(quickButtons()[0]);
    expect(screen.getByRole('button', { name: 'Confirmar cambios (1)' })).toBeEnabled();
    expect(screen.queryByLabelText(/Enfermero responsable/i)).toBeNull();
    expect(screen.queryByText(/marca sin criterios o ajusta/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^R1.*Paciente R1/ }));
    // A pane of the window, not a second dialog with its own close.
    const detail = screen.getByRole('region', { name: 'Checklist de clasificación UPC' });
    expect(within(detail).queryByRole('button', { name: 'Cerrar checklist UPC' })).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it.each(['read-only', 'signed-out'])('does not submit as a %s viewer', mode => {
    if (mode === 'signed-out') mocks.actor = null;
    render(
      <UpcClassificationWindow
        currentDateString="2026-09-15"
        readOnly={mode === 'read-only'}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /marcar sin criterios UPC/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirmar cambios' })).toBeDisabled();
  });

  it('keeps the other draft for review when a marked bed becomes vacant', async () => {
    const ui = <UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />;
    const { rerender } = render(ui);
    quickButtons().forEach(button => fireEvent.click(button));
    delete mocks.beds.R1;
    mocks.beds = { ...mocks.beds };
    rerender(<UpcClassificationWindow currentDateString="2026-09-15" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (2)' }));
    expect(mocks.confirmUpcRound).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('R1');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambios (1)' }));
    await waitFor(() => expect(mocks.confirmUpcRound).toHaveBeenCalledTimes(1));
    expect(mocks.confirmUpcRound.mock.calls[0][0].map(entry => entry.bedId)).toEqual(['R3']);
  });
  it('preserves a concurrent signature in history after the professional reviews the round again', async () => {
    const onClose = vi.fn();
    const renderRound = () => (
      <UpcClassificationWindow currentDateString="2026-09-15" onClose={onClose} />
    );
    const { rerender } = render(renderRound());
    fireEvent.click(quickButtons()[0]);
    const previous = {
      uciCriteria: ['uci_vmi'],
      utiCriteria: [],
      classification: 'UPC_UCI' as const,
      evaluatedAt: '2026-09-15T10:00:00Z',
      evaluatedForDate: '2026-09-15',
      evaluatedBedId: 'R1',
      evaluationId: 'previous-evaluation',
    };
    mocks.beds = {
      ...mocks.beds,
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Paciente R1',
        rut: '1-9',
        upcChecklist: previous,
      }),
    };
    rerender(renderRound());
    const confirm = screen.getByRole('button', { name: 'Confirmar cambios (1)' });
    fireEvent.click(confirm);
    expect(mocks.confirmUpcRound).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('R1');
    fireEvent.click(confirm);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const { record } = mocks.confirmUpcRound.mock.calls[0][0][0];
    expect(record.history).toHaveLength(2);
    expect(record.history).toContainEqual(
      expect.objectContaining({ evaluationId: 'previous-evaluation' })
    );
  });

  it('closes without rendering another bed when opened for an unclassifiable initialBedId', () => {
    mocks.beds = {
      R1: DataFactory.createMockPatient('R1', {
        patientName: '',
        firstName: 'Maria',
        rut: '11.111.111-1',
        clinicalCrib: DataFactory.createMockPatient('R1', {
          patientName: 'RN de Maria',
          rut: '11.111.111-1',
        }),
      }),
      R2: DataFactory.createMockPatient('R2', { patientName: 'Paciente R2', rut: '2-7' }),
    };
    const onClose = vi.fn();
    render(
      <UpcClassificationWindow currentDateString={date} initialBedId="R1" onClose={onClose} />
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Paciente R2')).toBeNull();
    expect(mocks.loadPatientUpcHistory).not.toHaveBeenCalled();
  });
});
