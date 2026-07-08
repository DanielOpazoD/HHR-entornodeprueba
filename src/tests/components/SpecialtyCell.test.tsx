import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SpecialtyCell } from '@/features/census/components/patient-row/SpecialtyCell';
import { createEmptyPatient } from '@/services/factories/patientFactory';

const StatefulSpecialtyCell: React.FC<{
  initialData?: ReturnType<typeof createEmptyPatient>;
  onMultipleUpdate: (fields: Partial<ReturnType<typeof createEmptyPatient>>) => void;
}> = ({ initialData = createEmptyPatient('R1'), onMultipleUpdate }) => {
  const [data, setData] = React.useState(initialData);
  const onChange = vi.fn(() => vi.fn());

  return (
    <table>
      <tbody>
        <tr>
          <SpecialtyCell
            data={data}
            onChange={onChange as never}
            onMultipleUpdate={fields => {
              onMultipleUpdate(fields);
              setData(current => ({ ...current, ...fields }));
            }}
          />
        </tr>
      </tbody>
    </table>
  );
};

const renderCell = () => {
  const onMultipleUpdate = vi.fn();

  const view = render(<StatefulSpecialtyCell onMultipleUpdate={onMultipleUpdate} />);

  return {
    ...view,
    onMultipleUpdate,
  };
};

describe('SpecialtyCell', () => {
  it('does not expose secondary specialty controls', () => {
    const onMultipleUpdate = vi.fn();

    render(
      <StatefulSpecialtyCell
        initialData={{
          ...createEmptyPatient('R1'),
          specialty: 'Med Interna' as never,
          secondarySpecialty: 'Cirugía',
        }}
        onMultipleUpdate={onMultipleUpdate}
      />
    );

    expect(screen.queryByTitle('Añadir co-manejo')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Quitar co-manejo')).not.toBeInTheDocument();
    expect(document.querySelectorAll('select')).toHaveLength(1);
  });

  it('keeps any custom specialty entered through Otro and trims accidental spaces', () => {
    const { container, onMultipleUpdate } = renderCell();
    const select = container.querySelector('select');

    if (!select) {
      throw new Error('Specialty select not found');
    }

    fireEvent.change(select, { target: { value: 'Otro' } });

    const customSpecialtyInput = screen.getByPlaceholderText('Esp');
    fireEvent.change(customSpecialtyInput, { target: { value: '  Unidad Dolor  ' } });
    fireEvent.blur(customSpecialtyInput);

    expect(onMultipleUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        specialty: 'Unidad Dolor',
        secondarySpecialty: undefined,
      })
    );
    expect(customSpecialtyInput).toHaveValue('Unidad Dolor');
  });

  it('clears stale secondary specialty when the primary specialty changes', () => {
    const onMultipleUpdate = vi.fn();

    const { container } = render(
      <StatefulSpecialtyCell
        initialData={{
          ...createEmptyPatient('R1'),
          specialty: 'Med Interna' as never,
          secondarySpecialty: 'Cirugía',
        }}
        onMultipleUpdate={onMultipleUpdate}
      />
    );
    const select = container.querySelector('select');

    if (!select) {
      throw new Error('Specialty select not found');
    }

    fireEvent.change(select, { target: { value: 'Traumatología' } });

    expect(onMultipleUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        specialty: 'Traumatología',
        secondarySpecialty: undefined,
      })
    );
  });

  it('opens subtype selector when choosing Ginecobstetricia', async () => {
    const { container, onMultipleUpdate } = renderCell();
    const select = container.querySelector('select');

    if (!select) {
      throw new Error('Specialty select not found');
    }

    fireEvent.change(select, { target: { value: 'Ginecobstetricia' } });

    expect(onMultipleUpdate).toHaveBeenCalledWith({ specialty: 'Ginecobstetricia' });
    expect(await screen.findByRole('button', { name: 'Obstétrica' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Obstétrica' }));

    expect(onMultipleUpdate).toHaveBeenLastCalledWith({ ginecobstetriciaType: 'Obstétrica' });
  });

  it('clears obstetric delivery fields when switching to Ginecológica', async () => {
    const onMultipleUpdate = vi.fn();
    const onChange = vi.fn(() => vi.fn());
    const data = {
      ...createEmptyPatient('R1'),
      specialty: 'Ginecobstetricia' as never,
      ginecobstetriciaType: 'Obstétrica' as const,
      deliveryRoute: 'Cesárea' as const,
      deliveryDate: '2026-03-22',
      deliveryCesareanLabor: 'Con TdP' as const,
    };

    render(
      <table>
        <tbody>
          <tr>
            <SpecialtyCell
              data={data}
              onChange={onChange as never}
              onMultipleUpdate={onMultipleUpdate}
            />
          </tr>
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Definir tipo de atención'));
    fireEvent.click(await screen.findByRole('button', { name: 'Ginecológica' }));

    expect(onMultipleUpdate).toHaveBeenLastCalledWith({
      ginecobstetriciaType: 'Ginecológica',
      deliveryRoute: undefined,
      deliveryDate: undefined,
      deliveryCesareanLabor: undefined,
    });
  });
});
