import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionOwner } from '@/services/storage/sessionStorageTransition';
import { CudyrSupplementImport } from '@/features/cudyr/components/CudyrSupplementImport';
import { CudyrCensusApprovalButton } from '@/features/cudyr/components/CudyrCensusApprovalButton';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { admitSyntheticSession, clearSyntheticSession } from '@/tests/utils/syntheticSession';

const p = vi.hoisted(() => ({ runtime: vi.fn(), sent: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'synthetic' }, role: 'admin' }),
}));
vi.mock('@/services/cudyr/cudyrSupplementFile', () => ({
  readCudyrSupplementFile: async () => ({
    file: { name: 'synthetic-a.xls', base64: 'U1lOVA==' },
    operationId: 'synthetic-a',
    report: { month: '2026-10', patients: [{ patientName: 'Paciente Sintético', days: [] }] },
  }),
}));
vi.mock('@/services/cudyr/cudyrCensusApproval', () => ({
  prepareCudyrCensusApproval: async () => [{ date: '2026-10-01', fingerprint: 'synthetic-a' }],
}));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getRegionalFunctions: p.runtime },
}));
// The transport records who this browser holds at the moment each write leaves.
vi.mock('firebase/functions', () => ({
  httpsCallable: (_runtime: unknown, name: string) => async (payload: { kind?: string }) => {
    if (name === 'readCudyrHistory') return { data: { review: null } };
    p.sent(name, payload.kind, getSessionOwner());
    return { data: { persisted: true, status: 'recorded', id: 'synthetic' } };
  },
}));

const A = 'user:synthetic-a';
const B = 'user:synthetic-b';

/** Starts the flow as A and holds the write's Functions preparation until `during` has run. */
const confirmAs = async (flow: 'supplement' | 'approval', during: () => void) => {
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => (entered = resolve));
  const held = new Promise<void>(resolve => (release = resolve));
  // The approval first reads its verified context; its write is the second preparation.
  if (flow === 'approval') p.runtime.mockResolvedValueOnce({});
  p.runtime.mockImplementationOnce(async () => {
    entered();
    await held;
    return {};
  });
  if (flow === 'supplement') {
    render(<CudyrSupplementImport from="2026-10-01" to="2026-10-31" onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText('Agregar informe mensual de Eloísa'), {
      target: { files: [new File(['synthetic'], 'synthetic.xls')] },
    });
    const save = await screen.findByRole('button', { name: 'Guardar respaldo' });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(save);
  } else {
    const data = { from: '2026-10-01', to: '2026-10-31' } as CudyrReportDataset;
    render(<CudyrCensusApprovalButton data={data} onApproved={() => {}} />);
    fireEvent.click(screen.getByText('Aprobar censo reconstruido'));
    fireEvent.click(screen.getByText('Confirmar cierre oficial'));
  }
  await waiting;
  await act(async () => {
    during();
    release();
    await new Promise(resolve => setTimeout(resolve, 10));
  });
};

beforeEach(() => {
  p.runtime.mockReset().mockResolvedValue({});
  p.sent.mockClear();
  admitSyntheticSession(A, 'generation-a');
});
afterEach(() => {
  cleanup();
  clearSyntheticSession();
});

describe('what A confirmed in CUDYR never leaves once the browser holds B', () => {
  it.each([
    ['supplement', 'import-monthly-supplement'],
    ['approval', 'save-verified-context'],
  ] as const)('%s: A still signed in, the write leaves once in A’s name', async (flow, kind) => {
    await confirmAs(flow, () => {});
    expect(p.sent.mock.calls).toEqual([['archiveCudyrHistory', kind, A]]);
  });

  it.each(['supplement', 'approval'] as const)(
    '%s: B signs in while the write is being prepared, nothing leaves',
    async flow => {
      await confirmAs(flow, () => {
        admitSyntheticSession(B, 'generation-b');
        cleanup();
      });
      expect(p.sent).not.toHaveBeenCalled();
    }
  );
});
