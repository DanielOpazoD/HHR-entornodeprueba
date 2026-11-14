/** @vitest-environment jsdom */
import '../../setup';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stethoscope } from 'lucide-react';
import { HandoffPrintHeader } from '@/features/handoff/components/HandoffPrintHeader';

describe('HandoffPrintHeader', () => {
  it('renders printable shift and staff labels for nursing handoff', () => {
    render(
      <HandoffPrintHeader
        title="Entrega"
        dateString="17-03-2026"
        Icon={Stethoscope}
        selectedShift="day"
        isMedical={false}
        schedule={{
          dayStart: '08:00',
          dayEnd: '20:00',
          nightStart: '20:00',
          nightEnd: '08:00',
        }}
        deliversList={['Ana', '']}
        receivesList={[]}
        tensList={['Luis']}
      />
    );

    expect(screen.getByText('Turno Largo (08:00 - 20:00)')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Sin especificar')).toBeInTheDocument();
    expect(screen.getByText('Luis')).toBeInTheDocument();
  });
});
