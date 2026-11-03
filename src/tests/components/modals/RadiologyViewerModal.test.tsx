import { act, render, waitFor, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MMRADExam, MMRADSearchResult } from '@/services/radiology/mmradService';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';

const mmradMocks = vi.hoisted(() => ({
  search: vi.fn(),
}));

vi.mock('@/services/radiology/mmradService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/radiology/mmradService')>();
  return {
    ...actual,
    searchMMRADExams: mmradMocks.search,
  };
});

import { RadiologyViewerModal } from '@/components/modals/RadiologyViewerModal';

const patient = {
  bedId: 'R2',
  label: 'R2 · Paciente de prueba',
  patientName: 'Paciente de prueba',
  rut: '17.752.753-1',
};

describe('RadiologyViewerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mmradMocks.search.mockResolvedValue({ rut: '17752753-1', examenes: [] });
  });

  it('searches the initial patient once when direct access requests auto-search', async () => {
    render(
      <RadiologyViewerModal
        isOpen
        onClose={vi.fn()}
        patients={[patient]}
        initialPatientRut={patient.rut}
        autoSearchInitialPatient
      />
    );

    await waitFor(() => {
      expect(mmradMocks.search).toHaveBeenCalledTimes(1);
    });
    // The census name lets the search find exams MMRAD registered with another check digit.
    expect(mmradMocks.search).toHaveBeenCalledWith({
      rut: patient.rut,
      patientName: patient.patientName,
      dateFrom: undefined,
      dateTo: undefined,
    });
  });

  it('keeps the existing global viewer in manual-search mode by default', async () => {
    await act(async () => {
      render(
        <RadiologyViewerModal
          isOpen
          onClose={vi.fn()}
          patients={[patient]}
          initialPatientRut={patient.rut}
        />
      );
    });
    expect(mmradMocks.search).not.toHaveBeenCalled();
  });

  it('ignores a late search result after selecting another patient', async () => {
    let finish: (result: unknown) => void = () => undefined;
    mmradMocks.search.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    render(
      <RadiologyViewerModal
        isOpen
        onClose={vi.fn()}
        patients={[
          patient,
          { ...patient, bedId: 'R3', rut: '22.222.222-2', label: 'Otro paciente sintético' },
        ]}
        initialPatientRut={patient.rut}
        autoSearchInitialPatient
      />
    );
    await waitFor(() => expect(mmradMocks.search).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '22.222.222-2' } });
    await act(async () =>
      finish({
        rut: patient.rut,
        examenes: [
          {
            nombre_examen: 'ESTUDIO DEL PACIENTE ANTERIOR',
            mod: 'CT',
            dicom_url: 'https://ris.mmrad.cl/synthetic',
          },
        ],
      })
    );
    expect(screen.queryByText('ESTUDIO DEL PACIENTE ANTERIOR')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver DICOM' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeEnabled();
  });
});

describe('RadiologyViewerModal with the exam list remembered in this session', () => {
  const otherPatient = {
    bedId: 'R3',
    label: 'R3 · Otro paciente sintético',
    patientName: 'Otro paciente sintético',
    rut: '22.222.222-2',
  };
  // Synthetic CT exams: the CT tab opens first and lists them all.
  const ct = (name: string, overrides: Partial<MMRADExam> = {}): MMRADExam => ({
    nombre_examen: name,
    fecha_examen: '01/11/2026',
    fecha_asignacion: '01/11/2026',
    mod: 'CT',
    estado: 'Pendiente',
    pdf_url: null,
    dicom_url: null,
    informe_html_url: `https://ris.mmrad.cl/synthetic/${encodeURIComponent(name)}`,
    portal_web_receipt_url: null,
    report: null,
    ...overrides,
  });
  const replyFor = (rut: string, examenes: MMRADExam[]): MMRADSearchResult => ({
    rut: rut.replace(/\./g, ''),
    examenes,
  });
  const deferredReply = () => {
    let resolve: (value: MMRADSearchResult) => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    const promise = new Promise<MMRADSearchResult>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    return { promise, resolve, reject };
  };
  let generation = 0;
  const admitSession = async (owner: string) => {
    localStorage.setItem(SESSION_OWNER_KEY, owner);
    setSessionGeneration(`synthetic-radiology-${++generation}`);
    // The session signal is posted to the window and delivered on a later task.
    await act(() => new Promise(resolve => setTimeout(resolve, 0)));
  };
  const openFor = (patients = [patient]) =>
    render(
      <RadiologyViewerModal
        isOpen
        onClose={vi.fn()}
        patients={patients}
        initialPatientRut={patients[0].rut}
        autoSearchInitialPatient
      />
    );
  const rememberChestCt = async () => {
    mmradMocks.search.mockResolvedValueOnce(replyFor(patient.rut, [ct('TC TORAX SINTETICO')]));
    const view = openFor();
    await screen.findByText('TC TORAX SINTETICO');
    view.unmount();
  };
  const foregroundProgress = 'Conectando con el servidor de imágenes...';

  beforeEach(async () => {
    // Also drops replies queued by a test that failed before using them.
    mmradMocks.search.mockReset();
    await admitSession('user:synthetic-A');
  });

  afterEach(() => {
    setSessionGeneration(null);
    localStorage.removeItem(SESSION_OWNER_KEY);
  });

  it('shows the remembered list at once on reopen and refreshes it silently', async () => {
    await rememberChestCt();
    const refresh = deferredReply();
    mmradMocks.search.mockReturnValueOnce(refresh.promise);

    openFor();

    expect(screen.getByText('TC TORAX SINTETICO')).toBeInTheDocument();
    expect(screen.queryByText(foregroundProgress)).not.toBeInTheDocument();
    expect(mmradMocks.search).toHaveBeenCalledTimes(2);

    await act(async () =>
      refresh.resolve(
        replyFor(patient.rut, [
          ct('TC TORAX SINTETICO', { estado: 'Validado' }),
          ct('TC ABDOMEN SINTETICO'),
        ])
      )
    );
    expect(screen.getByText('TC ABDOMEN SINTETICO')).toBeInTheDocument();
    expect(screen.getByText('Validado')).toBeInTheDocument();
    expect(screen.getAllByText('TC TORAX SINTETICO')).toHaveLength(1);
  });

  it('shows and refreshes the remembered list when the manual viewer reopens', async () => {
    const manual = () =>
      render(<RadiologyViewerModal isOpen onClose={vi.fn()} patients={[patient]} />);
    mmradMocks.search.mockResolvedValueOnce(replyFor(patient.rut, [ct('TC TORAX SINTETICO')]));
    const first = manual();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await screen.findByText('TC TORAX SINTETICO');
    first.unmount();
    mmradMocks.search.mockReturnValueOnce(deferredReply().promise);

    manual();

    expect(screen.getByText('TC TORAX SINTETICO')).toBeInTheDocument();
    expect(mmradMocks.search).toHaveBeenCalledTimes(2);
  });

  it('keeps the modality tab the user chose when the refresh arrives', async () => {
    const exams = [ct('TC TORAX SINTETICO'), ct('RX TORAX SINTETICO', { mod: 'CR' })];
    mmradMocks.search.mockResolvedValueOnce(replyFor(patient.rut, exams));
    const first = openFor();
    await screen.findByText('TC TORAX SINTETICO');
    first.unmount();
    const refresh = deferredReply();
    mmradMocks.search.mockReturnValueOnce(refresh.promise);
    openFor();
    fireEvent.click(screen.getByRole('button', { name: 'CR (1)' }));

    await act(async () =>
      refresh.resolve(replyFor(patient.rut, [...exams, ct('TC ABDOMEN SINTETICO')]))
    );

    expect(screen.getByText('RX TORAX SINTETICO')).toBeInTheDocument();
    expect(screen.queryByText('TC TORAX SINTETICO')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CT (2)' })).toBeInTheDocument();
  });

  it('keeps remembered exams that a shorter or empty refresh leaves out', async () => {
    await rememberChestCt();
    mmradMocks.search.mockResolvedValueOnce(replyFor(patient.rut, []));

    openFor();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buscar' })).toBeEnabled());

    expect(screen.getByText('TC TORAX SINTETICO')).toBeInTheDocument();
    expect(screen.queryByText('No se encontraron exámenes de tipo CT')).not.toBeInTheDocument();
  });

  it('keeps the list after a failed refresh and reports it below the list', async () => {
    await rememberChestCt();
    mmradMocks.search.mockRejectedValueOnce(new Error('MMRAD sin respuesta (sintético)'));

    openFor();
    const notice = await screen.findByText(/No se pudo actualizar desde MMRAD/);

    expect(notice).toHaveTextContent('MMRAD sin respuesta (sintético)');
    const list = screen.getByText('TC TORAX SINTETICO');
    expect(list.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ['another user signs in', 'user:synthetic-B'],
    ['the same user starts a new session', 'user:synthetic-A'],
  ])('forgets the list when %s', async (_change, owner) => {
    await rememberChestCt();
    await admitSession(owner);
    mmradMocks.search.mockReturnValueOnce(deferredReply().promise);

    openFor();

    expect(screen.queryByText('TC TORAX SINTETICO')).not.toBeInTheDocument();
    expect(screen.getByText(foregroundProgress)).toBeInTheDocument();
  });

  it('never shows a late refresh for the previous patient under the next one, yet remembers it', async () => {
    const patients = [patient, otherPatient];
    mmradMocks.search
      .mockResolvedValueOnce(replyFor(patient.rut, [ct('TC TORAX SINTETICO')]))
      .mockResolvedValueOnce(replyFor(otherPatient.rut, [ct('TC CEREBRO SINTETICO')]));
    openFor(patients);
    await screen.findByText('TC TORAX SINTETICO');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: otherPatient.rut } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await screen.findByText('TC CEREBRO SINTETICO');

    const lateFirst = deferredReply();
    mmradMocks.search
      .mockReturnValueOnce(lateFirst.promise)
      .mockReturnValueOnce(deferredReply().promise);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: patient.rut } });
    expect(screen.getByText('TC TORAX SINTETICO')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: otherPatient.rut } });
    expect(screen.getByText('TC CEREBRO SINTETICO')).toBeInTheDocument();

    await act(async () =>
      lateFirst.resolve(
        replyFor(patient.rut, [ct('TC TORAX SINTETICO'), ct('TC ABDOMEN SINTETICO')])
      )
    );
    expect(screen.queryByText('TC TORAX SINTETICO')).not.toBeInTheDocument();
    expect(screen.queryByText('TC ABDOMEN SINTETICO')).not.toBeInTheDocument();
    expect(screen.getByText('TC CEREBRO SINTETICO')).toBeInTheDocument();

    mmradMocks.search.mockReturnValueOnce(deferredReply().promise);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: patient.rut } });
    expect(screen.getByText('TC ABDOMEN SINTETICO')).toBeInTheDocument();
  });
});
