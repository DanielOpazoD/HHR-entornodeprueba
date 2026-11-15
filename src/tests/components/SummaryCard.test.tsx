import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CombinedSummaryCard, SummaryCard } from '@/components/layout/SummaryCard';
import type { DischargeData } from '@/types/domain/movements';
import type { Statistics } from '@/types/domain/statistics';

describe('SummaryCard Components', () => {
  const asDischarge = (partial: Partial<DischargeData>): DischargeData => partial as DischargeData;

  const mockStats: Statistics = {
    occupiedBeds: 10,
    occupiedCribs: 0,
    clinicalCribsCount: 5,
    companionCribs: 3,
    totalCribsUsed: 8,
    totalHospitalized: 10,
    blockedBeds: 2,
    serviceCapacity: 20,
    availableCapacity: 8,
  };

  describe('CombinedSummaryCard', () => {
    it('renders integrated statistics with all sections', () => {
      const discharges = [asDischarge({ status: 'Fallecido' })];
      render(
        <CombinedSummaryCard
          stats={mockStats}
          discharges={discharges}
          transfers={[]}
          cmaCount={3}
          newAdmissions={4}
        />
      );

      expect(screen.getByText('Censo Camas')).toBeInTheDocument();
      expect(screen.getByText('Cunas')).toBeInTheDocument();
      expect(screen.getByText('Cunas').nextElementSibling).toHaveTextContent('8');
      expect(screen.queryByText('Cunas RN')).not.toBeInTheDocument();
      expect(screen.getByText('Movimientos')).toBeInTheDocument();
      expect(screen.getByText('Ingresos')).toBeInTheDocument();
      const ingresos = screen.getByText('Ingresos').nextElementSibling;
      expect(ingresos?.textContent).toBe('4');

      // Check specific section values
      expect(screen.getByText('Fall.')).toBeInTheDocument();
      const fall = screen.getByText('Fall.').nextElementSibling;
      expect(fall?.textContent).toBe('1');
    });

    it('handles default values for optional props', () => {
      render(<CombinedSummaryCard stats={mockStats} />);
      expect(screen.queryByText('Fall.')).not.toBeInTheDocument();
      // Egresos, Traslados, H.Diurna, Ingresos should all be 0
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('Legacy SummaryCard wrapper renders CombinedSummaryCard', () => {
    render(<SummaryCard stats={mockStats} />);
    expect(screen.getByText('Censo Camas')).toBeInTheDocument();
  });
});
