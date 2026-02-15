import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CheckCircle } from 'lucide-react';

import { CensusMovementSectionLayout } from '@/features/census/components/CensusMovementSectionLayout';

describe('CensusMovementSectionLayout', () => {
  it('renders empty state with title', () => {
    render(
      <CensusMovementSectionLayout
        title="Altas"
        emptyMessage="No hay altas"
        icon={<CheckCircle size={18} />}
        iconClassName="bg-green-50 text-green-600"
        isEmpty={true}
        headers={[]}
      >
        <tr>
          <td>unused</td>
        </tr>
      </CensusMovementSectionLayout>
    );

    expect(screen.getByText('Altas')).toBeInTheDocument();
    expect(screen.getByText('No hay altas')).toBeInTheDocument();
  });

  it('renders table and subtitle when content is not empty', () => {
    render(
      <CensusMovementSectionLayout
        title="Traslados"
        subtitle="CMA / PMA"
        emptyMessage="No hay traslados"
        icon={<CheckCircle size={18} />}
        iconClassName="bg-blue-50 text-blue-600"
        isEmpty={false}
        headers={[{ label: 'Paciente' }]}
      >
        <tr>
          <td>Jane Doe</td>
        </tr>
      </CensusMovementSectionLayout>
    );

    expect(screen.getByText('CMA / PMA')).toBeInTheDocument();
    expect(screen.getByText('Paciente')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('applies optional className overrides for root, table and body', () => {
    const { container } = render(
      <CensusMovementSectionLayout
        title="CMA"
        emptyMessage="Sin datos"
        icon={<CheckCircle size={18} />}
        iconClassName="bg-medical-50 text-medical-600"
        isEmpty={false}
        headers={[{ label: 'Paciente' }]}
        rootClassName="print:break-inside-avoid"
        tableClassName="text-left"
        bodyClassName="divide-y divide-slate-100"
      >
        <tr>
          <td>John Doe</td>
        </tr>
      </CensusMovementSectionLayout>
    );

    expect(container.querySelector('.print\\:break-inside-avoid')).toBeTruthy();
    expect(container.querySelector('table.text-left')).toBeTruthy();
    expect(container.querySelector('tbody.divide-y.divide-slate-100')).toBeTruthy();
  });
});
