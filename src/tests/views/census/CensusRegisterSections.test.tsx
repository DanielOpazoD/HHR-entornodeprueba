import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CensusRegisterSections } from '@/features/census/components/CensusRegisterSections';
import { useCensusMovementData } from '@/features/census/hooks/useCensusMovementData';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/features/census/components/DischargesSection', () => ({
  DischargesSection: () => <section data-testid="movement-section">Altas</section>,
}));

vi.mock('@/features/census/components/TransfersSection', () => ({
  TransfersSection: () => <section data-testid="movement-section">Traslados</section>,
}));

vi.mock('@/features/census/components/CMASection', () => ({
  CMASection: () => <section data-testid="movement-section">Hospitalización Diurna</section>,
}));

vi.mock('@/features/census/hooks/useCensusMovementData', () => ({
  useCensusMovementData: vi.fn(),
}));

const renderSections = () =>
  render(
    <CensusRegisterSections
      readOnly
      showBedManagerModal={false}
      onCloseBedManagerModal={vi.fn()}
      accessProfile="default"
    />
  );

const movementSectionTexts = (): string[] =>
  screen.getAllByTestId('movement-section').map(section => section.textContent || '');

describe('CensusRegisterSections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCensusMovementData).mockReturnValue({
      recordDate: '2026-05-14',
      discharges: [],
      transfers: [],
      cma: [],
    });
  });

  it('moves empty transfers after CMA when CMA has records and transfers does not', () => {
    vi.mocked(useCensusMovementData).mockReturnValue({
      recordDate: '2026-05-14',
      discharges: [DataFactory.createMockDischarge({ id: 'd1' })],
      transfers: [],
      cma: [DataFactory.createMockCMA({ id: 'c1' })],
    });

    renderSections();

    expect(movementSectionTexts()).toEqual(['Altas', 'Hospitalización Diurna', 'Traslados']);
  });

  it('moves any empty section after sections with records', () => {
    vi.mocked(useCensusMovementData).mockReturnValue({
      recordDate: '2026-05-14',
      discharges: [],
      transfers: [DataFactory.createMockTransfer({ id: 't1' })],
      cma: [DataFactory.createMockCMA({ id: 'c1' })],
    });

    renderSections();

    expect(movementSectionTexts()).toEqual(['Traslados', 'Hospitalización Diurna', 'Altas']);
  });

  it('does not render movement sections for specialist access', () => {
    render(
      <CensusRegisterSections
        readOnly
        showBedManagerModal={false}
        onCloseBedManagerModal={vi.fn()}
        accessProfile="specialist"
      />
    );

    expect(screen.queryByTestId('movement-section')).not.toBeInTheDocument();
    expect(within(document.body).queryByText('Altas')).not.toBeInTheDocument();
  });
});
