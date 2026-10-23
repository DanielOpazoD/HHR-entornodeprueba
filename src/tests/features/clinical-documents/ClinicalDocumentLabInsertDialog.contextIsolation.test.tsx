import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getLabResults, buildLabSummaryText, searchSyslabExams, fetchSyslabExamDetails } =
  vi.hoisted(() => ({
    getLabResults: vi.fn(),
    buildLabSummaryText: vi.fn(),
    searchSyslabExams: vi.fn(),
    fetchSyslabExamDetails: vi.fn(),
  }));

vi.mock('@/features/laboratory', () => ({ getLabResults, buildLabSummaryText }));
vi.mock('@/services/laboratory/syslabService', () => ({
  searchSyslabExams,
  fetchSyslabExamDetails,
}));

import { ClinicalDocumentLabInsertDialog } from '@/features/clinical-documents/components/ClinicalDocumentLabInsertDialog';

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const cachedExam = {
  exams: {
    'patient-a': {
      date: '01/04/2026',
      time: '08:00:00',
      findings: [{ examName: 'Hb', value: '13' }],
    },
  },
};
const liveExam = (id: string, date: string) => ({
  success: true,
  data: [{ id, date, time: '09:00:00', link: `https://syslab.test/${id}` }],
});
const detailResult = {
  success: true,
  data: [{ findings: [{ examName: 'Hb', value: '13' }] }],
};

describe('ClinicalDocumentLabInsertDialog patient context', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getLabResults.mockResolvedValue({ exams: {} });
    searchSyslabExams.mockResolvedValue({ success: true, data: [] });
    buildLabSummaryText.mockReturnValue('Resumen del paciente actual');
  });

  it.each(['empty', 'error'] as const)(
    'removes A exams while B loads and after B returns %s',
    async outcome => {
      const patientB = deferred<{ exams: Record<string, never> }>();
      getLabResults.mockResolvedValueOnce(cachedExam).mockReturnValueOnce(patientB.promise);
      const onInsert = vi.fn();
      const { rerender } = render(
        <ClinicalDocumentLabInsertDialog
          patientRut="patient-a"
          onInsert={onInsert}
          onClose={vi.fn()}
        />
      );
      expect(await screen.findByText('01/04/2026 08:00')).toBeInTheDocument();

      rerender(
        <ClinicalDocumentLabInsertDialog
          patientRut="patient-b"
          onInsert={onInsert}
          onClose={vi.fn()}
        />
      );
      expect(screen.queryByText('01/04/2026 08:00')).not.toBeInTheDocument();
      expect(screen.getByText(/cargando exámenes/i)).toBeInTheDocument();

      await act(async () => {
        if (outcome === 'error') patientB.reject(new Error('B unavailable'));
        else patientB.resolve({ exams: {} });
      });
      expect(screen.queryByText('01/04/2026 08:00')).not.toBeInTheDocument();
      expect(
        screen.getByText(
          outcome === 'error'
            ? /no se pudieron cargar los exámenes/i
            : /no hay exámenes disponibles/i
        )
      ).toBeInTheDocument();
      expect(onInsert).not.toHaveBeenCalled();
    }
  );

  it.each(['cache', 'live'] as const)('ignores a delayed A %s after B loaded', async source => {
    const cached = deferred<typeof cachedExam>();
    const live = deferred<ReturnType<typeof liveExam>>();
    if (source === 'cache') getLabResults.mockReturnValueOnce(cached.promise);
    else searchSyslabExams.mockReturnValueOnce(live.promise);
    const { rerender } = render(
      <ClinicalDocumentLabInsertDialog
        patientRut="patient-a"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />
    );
    if (source === 'live') await act(async () => {});

    rerender(
      <ClinicalDocumentLabInsertDialog
        patientRut="patient-b"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByText(/no hay exámenes disponibles/i)).toBeInTheDocument();
    await act(async () => {
      if (source === 'cache') cached.resolve(cachedExam);
      else live.resolve(liveExam('patient-a', '01/04/2026'));
    });
    expect(screen.queryByText('01/04/2026 08:00')).not.toBeInTheDocument();
    expect(screen.queryByText('01/04/2026 09:00')).not.toBeInTheDocument();
    expect(screen.getByText(/no hay exámenes disponibles/i)).toBeInTheDocument();
  });

  it('does not insert A details into B or clear B pending insertion', async () => {
    const detailsA = deferred<typeof detailResult>();
    const detailsB = deferred<typeof detailResult>();
    const onInsertA = vi.fn();
    const onInsertB = vi.fn();
    searchSyslabExams
      .mockResolvedValueOnce(liveExam('patient-a', '01/04/2026'))
      .mockResolvedValueOnce(liveExam('patient-b', '02/04/2026'));
    fetchSyslabExamDetails
      .mockReturnValueOnce(detailsA.promise)
      .mockReturnValueOnce(detailsB.promise);
    const { rerender } = render(
      <ClinicalDocumentLabInsertDialog
        patientRut="patient-a"
        onInsert={onInsertA}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: /01\/04\/2026 09:00/ }));

    rerender(
      <ClinicalDocumentLabInsertDialog
        patientRut="patient-b"
        onInsert={onInsertB}
        onClose={vi.fn()}
      />
    );
    const buttonB = await screen.findByRole('button', { name: /02\/04\/2026 09:00/ });
    expect(buttonB).toBeEnabled();
    fireEvent.click(buttonB);
    await act(async () => detailsA.resolve(detailResult));

    expect(onInsertA).not.toHaveBeenCalled();
    expect(onInsertB).not.toHaveBeenCalled();
    expect(buildLabSummaryText).not.toHaveBeenCalled();
    expect(buttonB).toBeDisabled();
    await act(async () => detailsB.resolve(detailResult));
    expect(onInsertB).toHaveBeenCalledWith('Resumen del paciente actual');
  });

  it.each(['empty', 'error'] as const)(
    'ignores A detail %s after changing patient',
    async outcome => {
      const details = deferred<typeof detailResult>();
      searchSyslabExams.mockResolvedValueOnce(liveExam('patient-a', '01/04/2026'));
      fetchSyslabExamDetails.mockReturnValueOnce(details.promise);
      const { rerender } = render(
        <ClinicalDocumentLabInsertDialog
          patientRut="patient-a"
          onInsert={vi.fn()}
          onClose={vi.fn()}
        />
      );
      fireEvent.click(await screen.findByRole('button', { name: /01\/04\/2026 09:00/ }));
      rerender(
        <ClinicalDocumentLabInsertDialog
          patientRut="patient-b"
          onInsert={vi.fn()}
          onClose={vi.fn()}
        />
      );
      await screen.findByText(/no hay exámenes disponibles/i);

      await act(async () => {
        if (outcome === 'error') details.reject(new Error('A unavailable'));
        else details.resolve({ success: true, data: [] });
      });
      expect(
        screen.queryByText(/no se encontraron resultados|error al obtener/i)
      ).not.toBeInTheDocument();
      expect(screen.getByText(/no hay exámenes disponibles/i)).toBeInTheDocument();
    }
  );

  it.each(['close', 'unmount'] as const)('cancels pending detail insertion on %s', async action => {
    const details = deferred<typeof detailResult>();
    const onInsert = vi.fn();
    const onClose = vi.fn();
    searchSyslabExams.mockResolvedValueOnce(liveExam('patient-a', '01/04/2026'));
    fetchSyslabExamDetails.mockReturnValueOnce(details.promise);
    const { unmount } = render(
      <ClinicalDocumentLabInsertDialog
        patientRut="patient-a"
        onInsert={onInsert}
        onClose={onClose}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: /01\/04\/2026 09:00/ }));
    if (action === 'close') {
      fireEvent.click(screen.getAllByRole('button')[0]);
      expect(onClose).toHaveBeenCalledOnce();
    } else unmount();

    await act(async () => details.resolve(detailResult));
    expect(onInsert).not.toHaveBeenCalled();
    expect(buildLabSummaryText).not.toHaveBeenCalled();
  });

  it.each(['cache', 'live'] as const)('ignores pending %s results after close', async source => {
    const cached = deferred<typeof cachedExam>();
    const live = deferred<ReturnType<typeof liveExam>>();
    if (source === 'cache') getLabResults.mockReturnValueOnce(cached.promise);
    else searchSyslabExams.mockReturnValueOnce(live.promise);
    const onClose = vi.fn();
    render(
      <ClinicalDocumentLabInsertDialog
        patientRut="patient-a"
        onInsert={vi.fn()}
        onClose={onClose}
      />
    );
    if (source === 'live') await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar laboratorio' }));
    await act(async () => {
      if (source === 'cache') cached.resolve(cachedExam);
      else live.resolve(liveExam('patient-a', '01/04/2026'));
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByText('01/04/2026 08:00')).not.toBeInTheDocument();
    expect(screen.queryByText('01/04/2026 09:00')).not.toBeInTheDocument();
    if (source === 'cache') expect(searchSyslabExams).not.toHaveBeenCalled();
  });
});
