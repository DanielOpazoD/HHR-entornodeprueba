import { fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';

import { DischargeRowView } from '@/features/census/components/DischargeRowView';
import type { DischargeRowViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';
import type { DischargeData } from '@/types/domain/movements';

vi.mock('@/features/census/components/CensusMovementPrimaryCells', () => ({
  CensusMovementPrimaryCells: () => (
    <>
      <td>primary</td>
      <td>primary</td>
    </>
  ),
}));

vi.mock('@/features/census/components/CensusMovementDateActionsCells', () => ({
  CensusMovementDateActionsCells: ({ children }: { children?: React.ReactNode }) => (
    <td>{children}</td>
  ),
}));

vi.mock('@/features/census/components/FugaNotificationModal', () => ({
  FugaNotificationModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? createPortal(<div>Fuga Notification Modal</div>, document.body) : null,
}));

describe('DischargeRowView', () => {
  const viewModel: DischargeRowViewModel = {
    kind: 'discharge',
    id: '1',
    bedName: 'A1',
    bedType: 'Cama',
    patientName: 'Paciente',
    rut: '11.111.111-1',
    diagnosis: 'Diag',
    dischargeTypeLabel: 'Fuga',
    statusBadgeClassName: 'badge',
    statusLabel: 'Vivo',
    movementDate: '2026-03-31',
    movementTime: '11:00',
    actions: [],
  };

  const dischargeItem: DischargeData = {
    id: '1',
    patientName: 'Paciente',
    rut: '11.111.111-1',
    diagnosis: 'Diag',
    bedName: 'A1',
    bedId: 'A1',
    bedType: 'Cama',
    status: 'Vivo',
    dischargeType: 'Fuga',
    time: '11:00',
    movementDate: '2026-03-31',
    originalData: { specialty: 'Psiquiatría' } as never,
  };

  it('shows fuga action only for fuga discharges and opens the modal', async () => {
    render(
      <table>
        <tbody>
          <DischargeRowView
            viewModel={viewModel}
            recordDate="2026-03-31"
            dischargeItem={dischargeItem}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByRole('button', { name: /fuga/i }));
    expect(await screen.findByText('Fuga Notification Modal')).toBeInTheDocument();
    expect(screen.queryByText('IEEH')).not.toBeInTheDocument();
  });
});
