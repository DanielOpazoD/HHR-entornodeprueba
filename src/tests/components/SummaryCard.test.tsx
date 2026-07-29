import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import {
  BedSummaryCard,
  CribSummaryCard,
  MovementSummaryCard,
  CombinedSummaryCard,
  SummaryCard,
} from '@/components/layout/SummaryCard';
import type { DischargeData, TransferData } from '@/types/domain/movements';
import type { Statistics } from '@/types/domain/statistics';

describe('SummaryCard Components', () => {
  const asDischarge = (partial: Partial<DischargeData>): DischargeData => partial as DischargeData;
  const asTransfer = (partial: Partial<TransferData>): TransferData => partial as TransferData;

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

  describe('BedSummaryCard', () => {
    it('renders bed statistics correctly', () => {
      render(<BedSummaryCard stats={mockStats} />);
      expect(screen.getByText('Censo Camas')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument(); // Occupied
      expect(screen.getByText('18')).toBeInTheDocument(); // Capacity (20 - 2)
      expect(screen.getByText('2')).toBeInTheDocument(); // Blocked
      expect(screen.getByText('8')).toBeInTheDocument(); // Available
    });
  });

  describe('CribSummaryCard', () => {
    it('renders only clinical-crib statistics', () => {
      render(<CribSummaryCard stats={mockStats} />);
      expect(screen.getByText('Cunas RN')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument(); // Clinical
      expect(screen.queryByText('RN sano')).not.toBeInTheDocument();
    });
  });

  describe('MovementSummaryCard', () => {
    it('renders movements without deaths', () => {
      const discharges = [asDischarge({ status: 'Vivo' })];
      const transfers = [asTransfer({ id: '1' })];
      render(
        <MovementSummaryCard
          discharges={discharges}
          transfers={transfers}
          cmaCount={5}
          newAdmissions={2}
        />
      );

      expect(screen.getByText('Altas')).toBeInTheDocument();
      // Using getAllByText and checking values specifically
      const egresos = screen.getByText('Altas').nextElementSibling;
      expect(egresos?.textContent).toBe('1');

      expect(screen.getByText('Traslados')).toBeInTheDocument();
      const traslados = screen.getByText('Traslados').nextElementSibling;
      expect(traslados?.textContent).toBe('1');
      const ingresos = screen.getByText('Ingresos').nextElementSibling;
      expect(ingresos?.textContent).toBe('2');

      expect(screen.queryByText('Fallecidos')).not.toBeInTheDocument();
    });

    it('renders deaths branch when deaths > 0', () => {
      const discharges = [asDischarge({ status: 'Vivo' }), asDischarge({ status: 'Fallecido' })];
      render(<MovementSummaryCard discharges={discharges} transfers={[]} cmaCount={0} />);

      expect(screen.getByText('Fallecidos')).toBeInTheDocument();
      const fallecidos = screen.getByText('Fallecidos').nextElementSibling;
      expect(fallecidos?.textContent).toBe('1');

      const egresos = screen.getByText('Altas').nextElementSibling;
      expect(egresos?.textContent).toBe('2'); // Total Egresos
    });
  });

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
      expect(screen.getByText('Cunas RN')).toBeInTheDocument();
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
