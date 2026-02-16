import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { CheckCircle } from 'lucide-react';
import { CensusMovementSection } from '@/features/census/components/CensusMovementSection';

describe('CensusMovementSection', () => {
  it('returns null when model is non-renderable', () => {
    const { container } = render(
      <CensusMovementSection
        model={{ isRenderable: false, isEmpty: true, items: [] as Array<{ id: string }> }}
        title="Altas"
        emptyMessage="Sin altas"
        icon={<CheckCircle size={18} />}
        iconClassName="bg-green-50 text-green-600"
        headers={[]}
        getItemKey={item => item.id}
        renderRow={() => null}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders rows when model is renderable and not empty', () => {
    render(
      <CensusMovementSection
        model={{
          isRenderable: true,
          isEmpty: false,
          items: [{ id: 'a-1', label: 'Fila A' }],
        }}
        title="Altas"
        emptyMessage="Sin altas"
        icon={<CheckCircle size={18} />}
        iconClassName="bg-green-50 text-green-600"
        headers={[{ label: 'Paciente' }]}
        getItemKey={item => item.id}
        renderRow={item => (
          <tr>
            <td>{item.label}</td>
          </tr>
        )}
      />
    );

    expect(screen.getByText('Altas')).toBeInTheDocument();
    expect(screen.getByText('Fila A')).toBeInTheDocument();
  });
});
