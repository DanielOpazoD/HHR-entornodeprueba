import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchMMRADExams, writeClipboardText } = vi.hoisted(() => ({
  searchMMRADExams: vi.fn(),
  writeClipboardText: vi.fn(),
}));
vi.mock('@/services/radiology/mmradService', () => ({ searchMMRADExams }));
vi.mock('@/shared/runtime/browserClipboardRuntime', () => ({ writeClipboardText }));

import { ClinicalDocumentMMRADCopyDialog } from '@/features/clinical-documents/components/ClinicalDocumentMMRADCopyDialog';

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};
const examResult = (name: string) => ({
  rut: 'synthetic',
  examenes: [
    {
      nombre_examen: name,
      fecha_examen: '12/04/2026 11:47',
      mod: 'CT',
      informe_html_url: 'https://mmrad.test/shared-report-key',
      report: {
        title: 'TAC de prueba',
        findings: 'Hallazgo sintético.',
        impression: 'Impresión sintética.',
      },
    },
  ],
});

describe('ClinicalDocumentMMRADCopyDialog patient context', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    searchMMRADExams.mockResolvedValue({ examenes: [] });
    writeClipboardText.mockResolvedValue(undefined);
  });

  it.each(['empty', 'error'] as const)(
    'removes A reports while B loads and after B returns %s',
    async outcome => {
      const resultB = deferred<{ examenes: [] }>();
      searchMMRADExams
        .mockResolvedValueOnce(examResult('TC PACIENTE A'))
        .mockReturnValueOnce(resultB.promise);
      const { rerender } = render(
        <ClinicalDocumentMMRADCopyDialog patientRut="patient-a" onClose={vi.fn()} />
      );
      await screen.findByText('TC PACIENTE A');

      rerender(<ClinicalDocumentMMRADCopyDialog patientRut="patient-b" onClose={vi.fn()} />);
      expect(screen.queryByText('TC PACIENTE A')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /copiar informe/i })).not.toBeInTheDocument();
      expect(screen.getByText(/cargando TAC/i)).toBeInTheDocument();
      await act(async () => {
        if (outcome === 'error') resultB.reject(new Error('MMRAD B unavailable'));
        else resultB.resolve({ examenes: [] });
      });

      expect(screen.queryByText('TC PACIENTE A')).not.toBeInTheDocument();
      expect(
        screen.getByText(outcome === 'error' ? 'MMRAD B unavailable' : /no hay TAC con informe/i)
      ).toBeInTheDocument();
      expect(writeClipboardText).not.toHaveBeenCalled();
    }
  );

  it.each(['success', 'error'] as const)(
    'ignores a delayed A search %s after B loaded',
    async outcome => {
      const resultA = deferred<ReturnType<typeof examResult>>();
      searchMMRADExams
        .mockReturnValueOnce(resultA.promise)
        .mockResolvedValueOnce(examResult('TC PACIENTE B'));
      const { rerender } = render(
        <ClinicalDocumentMMRADCopyDialog patientRut="patient-a" onClose={vi.fn()} />
      );
      rerender(<ClinicalDocumentMMRADCopyDialog patientRut="patient-b" onClose={vi.fn()} />);
      await screen.findByText('TC PACIENTE B');

      await act(async () => {
        if (outcome === 'error') resultA.reject(new Error('MMRAD A unavailable'));
        else resultA.resolve(examResult('TC PACIENTE A'));
      });
      expect(screen.getByText('TC PACIENTE B')).toBeInTheDocument();
      expect(screen.queryByText('TC PACIENTE A')).not.toBeInTheDocument();
      expect(screen.queryByText('MMRAD A unavailable')).not.toBeInTheDocument();
    }
  );

  it('keeps copy completion for A from marking the same report key copied for B', async () => {
    const copiedA = deferred<void>();
    searchMMRADExams
      .mockResolvedValueOnce(examResult('TC PACIENTE A'))
      .mockResolvedValueOnce(examResult('TC PACIENTE B'));
    writeClipboardText.mockReturnValueOnce(copiedA.promise);
    const { rerender } = render(
      <ClinicalDocumentMMRADCopyDialog patientRut="patient-a" onClose={vi.fn()} />
    );
    fireEvent.click(await screen.findByRole('button', { name: /copiar informe/i }));
    rerender(<ClinicalDocumentMMRADCopyDialog patientRut="patient-b" onClose={vi.fn()} />);
    await screen.findByText('TC PACIENTE B');

    await act(async () => copiedA.resolve());
    expect(screen.queryByRole('button', { name: 'Copiado' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar informe' }));
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeInTheDocument();
    expect(writeClipboardText).toHaveBeenCalledTimes(2);
  });

  it('ignores a copy completion after close even if the parent has not unmounted', async () => {
    const copied = deferred<void>();
    const onClose = vi.fn();
    searchMMRADExams.mockResolvedValueOnce(examResult('TC PACIENTE A'));
    writeClipboardText.mockReturnValueOnce(copied.promise);
    render(<ClinicalDocumentMMRADCopyDialog patientRut="patient-a" onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: /copiar informe/i }));
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(onClose).toHaveBeenCalledOnce();

    await act(async () => copied.resolve());
    expect(screen.queryByRole('button', { name: 'Copiado' })).not.toBeInTheDocument();
  });

  it('handles copy failure in the active dialog', async () => {
    searchMMRADExams.mockResolvedValueOnce(examResult('TC PACIENTE A'));
    writeClipboardText.mockRejectedValueOnce(new Error('clipboard unavailable'));
    render(<ClinicalDocumentMMRADCopyDialog patientRut="patient-a" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /copiar informe/i }));

    expect(await screen.findByText('No se pudo copiar el informe.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copiado' })).not.toBeInTheDocument();
  });

  it.each(['patient change', 'close', 'unmount'] as const)(
    'handles a pending copy rejection after %s without reporting it to another context',
    async action => {
      const copied = deferred<void>();
      searchMMRADExams.mockResolvedValue(examResult('TC DE PRUEBA'));
      writeClipboardText.mockReturnValueOnce(copied.promise);
      const { rerender, unmount } = render(
        <ClinicalDocumentMMRADCopyDialog patientRut="patient-a" onClose={vi.fn()} />
      );
      fireEvent.click(await screen.findByRole('button', { name: /copiar informe/i }));
      if (action === 'patient change') {
        rerender(<ClinicalDocumentMMRADCopyDialog patientRut="patient-b" onClose={vi.fn()} />);
        await screen.findByText('TC DE PRUEBA');
      } else if (action === 'close') {
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar MMRAD' }));
      } else unmount();

      await act(async () => copied.reject(new Error('clipboard unavailable')));
      expect(screen.queryByText('No se pudo copiar el informe.')).not.toBeInTheDocument();
    }
  );

  it('does not schedule copied feedback after unmount while a copy is pending', async () => {
    const copied = deferred<void>();
    searchMMRADExams.mockResolvedValueOnce(examResult('TC DE PRUEBA'));
    writeClipboardText.mockReturnValueOnce(copied.promise);
    const { unmount } = render(
      <ClinicalDocumentMMRADCopyDialog patientRut="patient-a" onClose={vi.fn()} />
    );
    fireEvent.click(await screen.findByRole('button', { name: /copiar informe/i }));
    vi.useFakeTimers();
    try {
      unmount();
      await act(async () => copied.resolve());
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
