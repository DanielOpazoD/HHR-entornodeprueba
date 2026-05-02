import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MovementTimeline } from '@/features/census/components/global-search/MovementTimeline';
import type { PatientMovement } from '@/services/patient/patientHistoryService';

const movements: PatientMovement[] = [
  {
    date: '2026-03-26',
    bedId: 'R4',
    bedName: 'R4',
    bedType: 'MEDIA',
    type: 'admission',
    details: 'Urgencias',
  },
  {
    date: '2026-04-02',
    bedId: 'H4C1',
    bedName: 'H4C1',
    bedType: 'MEDIA',
    type: 'internal_move',
    details: 'Desde cama R4',
  },
  {
    date: '2026-04-06',
    bedId: 'H4C1',
    bedName: 'H4C1',
    bedType: 'MEDIA',
    type: 'discharge',
    details: 'Domicilio (Habitual)',
  },
];

describe('MovementTimeline', () => {
  it('renders internal bed changes as indented dependent movements', () => {
    render(<MovementTimeline movements={movements} />);

    const admissionRow = screen.getByTestId('movement-row-admission-0');
    const bedMoveRow = screen.getByTestId('movement-row-internal_move-1');

    expect(admissionRow).not.toHaveClass('ml-7');
    expect(bedMoveRow).toHaveClass('ml-7');
    expect(bedMoveRow).toHaveClass('border-l');
    expect(within(bedMoveRow).getByText('Cambio de cama')).toBeInTheDocument();
    expect(within(bedMoveRow).getByText(/H4C1/)).toBeInTheDocument();
    expect(within(bedMoveRow).getByText(/Desde cama R4/)).toBeInTheDocument();
  });
});
