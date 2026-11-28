import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

import { PatientHistoryModal } from '@/features/census/components/PatientHistoryModal';
import type { PatientHistoryResult } from '@/features/census/services/patientHistoryService';
import { getPatientMovementHistoryDetailed } from '@/features/census/services/patientHistoryService';

vi.mock('@/components/shared/BaseModal', () => ({
  BaseModal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
}));

vi.mock('@/features/census/services/patientHistoryService', () => ({
  getPatientMovementHistoryDetailed: vi.fn(),
}));

vi.mock('@/services/utils/loggerScope', async () => {
  const { createLoggerScopeMock } = await import('@/tests/utils/loggerScopeMock');
  return createLoggerScopeMock();
});

const resolvedHistory: PatientHistoryResult = {
  patientName: 'Paciente Test',
  rut: '11.111.111-1',
  totalDays: 2,
  firstSeen: '2026-03-06',
  lastSeen: '2026-03-08',
  movements: [
    {
      date: '2026-03-06',
      bedId: 'R1',
      bedName: 'R1',
      bedType: 'MEDIA',
      type: 'admission',
    },
    {
      date: '2026-03-08',
      bedId: 'R1',
      bedName: 'R1',
      bedType: 'MEDIA',
      type: 'transfer',
    },
  ],
};

describe('PatientHistoryModal', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders movement history without a documentos clinicos section', async () => {
    vi.mocked(getPatientMovementHistoryDetailed).mockResolvedValue({
      history: resolvedHistory,
      source: 'server',
    });

    render(
      <PatientHistoryModal
        isOpen={true}
        onClose={() => {}}
        patientRut="11.111.111-1"
        patientName="Paciente Test"
      />
    );

    expect(screen.getByText(/buscando historial clínico/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('2d')).toBeInTheDocument();
    });

    expect(screen.getByText('Ingreso')).toBeInTheDocument();
    expect(screen.queryByText('Alta')).not.toBeInTheDocument();
    expect(screen.queryByText('Movimiento interno')).not.toBeInTheDocument();
    expect(screen.getByText('Traslado')).toBeInTheDocument();
    expect(screen.getAllByText('R1')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /documentos clínicos/i })).not.toBeInTheDocument();
  });
  it('shows local history as partial and clears the warning after a successful retry', async () => {
    vi.mocked(getPatientMovementHistoryDetailed)
      .mockResolvedValueOnce({ history: resolvedHistory, source: 'local' })
      .mockResolvedValueOnce({ history: resolvedHistory, source: 'server' });
    render(<PatientHistoryModal isOpen onClose={() => {}} patientRut="test-1" />);
    expect(await screen.findByText(/Historial parcial/)).toBeInTheDocument();
    expect(screen.getByText('2d')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar consulta' }));
    await waitFor(() => expect(getPatientMovementHistoryDetailed).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/Historial parcial/)).not.toBeInTheDocument());
    expect(screen.getByText('2d')).toBeInTheDocument();
  });

  it('does not label an unavailable empty history as not found', async () => {
    vi.mocked(getPatientMovementHistoryDetailed).mockResolvedValue({
      history: null,
      source: 'local',
    });
    render(<PatientHistoryModal isOpen onClose={() => {}} patientRut="test-1" />);
    expect(await screen.findByRole('button', { name: 'Reintentar consulta' })).toBeInTheDocument();
    expect(
      screen.queryByText('No se encontró historial para este paciente.')
    ).not.toBeInTheDocument();
  });

  it('ignores a late response for a previously selected patient', async () => {
    let resolveOld!: (value: { history: PatientHistoryResult | null; source: 'server' }) => void;
    vi.mocked(getPatientMovementHistoryDetailed)
      .mockReturnValueOnce(
        new Promise(resolve => {
          resolveOld = resolve;
        })
      )
      .mockResolvedValueOnce({ history: null, source: 'server' });
    const { rerender } = render(<PatientHistoryModal isOpen onClose={() => {}} patientRut="old" />);
    rerender(<PatientHistoryModal isOpen onClose={() => {}} patientRut="new" />);
    expect(
      await screen.findByText('No se encontró historial para este paciente.')
    ).toBeInTheDocument();
    await act(async () => resolveOld({ history: resolvedHistory, source: 'server' }));
    expect(screen.queryByText('2d')).not.toBeInTheDocument();
  });
  it.each(['close', 'change patient'])(
    'stops requesting more history pages on %s',
    async action => {
      const pages: string[] = [];
      let finishFirst!: () => void;
      const firstPage = new Promise<void>(resolve => {
        finishFirst = resolve;
      });
      vi.mocked(getPatientMovementHistoryDetailed).mockImplementation(async (id, options) => {
        pages.push(id + '-1');
        if (id === 'first') await firstPage;
        options?.signal?.throwIfAborted();
        pages.push(id + '-2');
        return { history: null, source: 'server' };
      });
      const view = render(<PatientHistoryModal isOpen onClose={() => {}} patientRut="first" />);
      view.rerender(
        <PatientHistoryModal isOpen={action !== 'close'} onClose={() => {}} patientRut="next" />
      );
      await act(async () => {
        finishFirst();
      });
      expect(pages).toEqual(action === 'close' ? ['first-1'] : ['first-1', 'next-1', 'next-2']);
    }
  );
  it('does not offer an impossible server retry in configured local-only mode', async () => {
    vi.mocked(getPatientMovementHistoryDetailed).mockResolvedValue({
      history: resolvedHistory,
      source: 'local-only',
    });
    render(<PatientHistoryModal isOpen onClose={() => {}} patientRut="test-1" />);
    expect(await screen.findByText('2d')).toBeInTheDocument();
    expect(screen.queryByText(/Historial parcial/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar consulta' })).not.toBeInTheDocument();
  });
  it('loads the census period first and older hospitalizations only on explicit request', async () => {
    vi.mocked(getPatientMovementHistoryDetailed).mockResolvedValue({
      history: null,
      source: 'server',
    });
    const { rerender } = render(
      <PatientHistoryModal
        isOpen
        onClose={() => {}}
        patientRut="test-1"
        admissionDate="2026-03-06"
        throughDate="2026-03-08"
      />
    );
    await screen.findByText('No se encontró historial para este paciente.');
    expect(getPatientMovementHistoryDetailed).toHaveBeenLastCalledWith('test-1', {
      signal: expect.any(AbortSignal),
      dateRange: { startDate: '2026-03-06', endDate: '2026-03-08' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ver historial completo' }));
    await waitFor(() =>
      expect(getPatientMovementHistoryDetailed).toHaveBeenLastCalledWith('test-1', {
        signal: expect.any(AbortSignal),
        forceFullRemoteHydration: true,
      })
    );
    rerender(
      <PatientHistoryModal
        isOpen
        onClose={() => {}}
        patientRut="test-2"
        admissionDate="2026-03-07"
        throughDate="2026-03-08"
      />
    );
    await waitFor(() =>
      expect(getPatientMovementHistoryDetailed).toHaveBeenLastCalledWith('test-2', {
        signal: expect.any(AbortSignal),
        dateRange: { startDate: '2026-03-07', endDate: '2026-03-08' },
      })
    );
  });
});
