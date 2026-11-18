import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StaffSelector } from '@/features/census/components/StaffSelector';
import { VACANCY_LABEL } from '@/services/staff/staffSelectionPresentation';

const setShowNurseManager = vi.fn();
const setShowTensManager = vi.fn();

vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({
    setShowNurseManager,
    setShowTensManager,
    staffUsage: { nurse: { 'ana habitual': 3 }, tens: { 'ana habitual': 3 } },
    staffIdentities: (['nurse', 'tens'] as const).flatMap(role => [
      {
        key: `${role}:id:a`,
        role,
        name: 'Ana Maria Soto Rojas',
        aliases: ['Ana Maria Soto Rojas', 'Ana Soto'],
      },
      {
        key: `${role}:id:p`,
        role,
        name: 'Ana Pena',
        aliases: ['Ana Pena', 'A Pena'],
      },
    ]),
  }),
}));

const roles = [
  { role: 'nurse', label: 'Enfermería', slots: 2, setShowManager: setShowNurseManager },
  { role: 'tens', label: 'TENS', slots: 3, setShowManager: setShowTensManager },
] as const;

const shift = (slots: number, ...names: string[]) =>
  Array.from({ length: slots }, (_, index) => names[index] ?? '');

describe.each(roles)('StaffSelector ($label)', ({ role, label, slots, setShowManager }) => {
  const renderSelector = (
    props: Partial<React.ComponentProps<typeof StaffSelector>> & { catalog: string[] }
  ) =>
    render(
      <StaffSelector
        role={role}
        dayShift={shift(slots)}
        nightShift={shift(slots)}
        onUpdate={vi.fn()}
        {...props}
      />
    );
  const dayLabel = `${label} · turno largo · puesto 1`;

  it('reveals less-used names on demand without changing the selected assignment', () => {
    const update = vi.fn();
    renderSelector({
      dayShift: shift(slots, 'Ana Habitual'),
      catalog: ['Ana Habitual', 'Berta Poco', 'Carla Poco', 'Dora Poco'],
      onUpdate: update,
    });
    expect(screen.queryByRole('option', { name: 'Berta Poco' })).not.toBeInTheDocument();
    const more = screen.getByRole('button', {
      name: `Mostrar nombres menos usados de ${dayLabel}`,
    });
    expect(more).toHaveTextContent('');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(screen.getAllByRole('option', { name: 'Berta Poco' })).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(dayLabel), { target: { value: 'Berta Poco' } });
    expect(update).toHaveBeenCalledWith('day', 0, 'Berta Poco');
    fireEvent.click(
      screen.getByRole('button', { name: `Ocultar nombres menos usados de ${dayLabel}` })
    );
    expect(screen.queryByRole('option', { name: 'Berta Poco' })).not.toBeInTheDocument();
  });

  it('shows a short label but saves the canonical name', () => {
    const update = vi.fn();
    renderSelector({
      dayShift: shift(slots, 'Ana Soto'),
      catalog: ['Ana Maria Soto Rojas'],
      onUpdate: update,
    });
    expect(screen.getAllByRole('option', { name: 'Ana Soto' })).toHaveLength(slots * 2);
    expect(screen.getByLabelText(dayLabel)).toHaveValue('Ana Maria Soto Rojas');
    expect(screen.getByLabelText(dayLabel)).toHaveAttribute(
      'aria-describedby',
      `${role}-day-0-name`
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('Ana Maria Soto Rojas');
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(dayLabel), {
      target: { value: 'Ana Maria Soto Rojas' },
    });
    expect(update).toHaveBeenCalledWith('day', 0, 'Ana Maria Soto Rojas');
  });

  it('keeps an Eloísa name selected when the catalog spells the same person with ñ', () => {
    renderSelector({ dayShift: shift(slots, 'A Pena'), catalog: ['Ana Peña'] });
    expect(screen.getByLabelText(dayLabel)).toHaveValue('Ana Peña');
    expect(screen.queryByRole('option', { name: 'Ana Pena' })).not.toBeInTheDocument();
  });

  it('keeps selected staff visible even when the catalog has not hydrated yet', () => {
    renderSelector({ dayShift: shift(slots, 'Persona Sintetica'), catalog: [] });
    expect(screen.getAllByRole('option', { name: 'Persona Sintetica' }).length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('Persona Sintetica')).toHaveLength(1);
  });

  it('opens the catalog from the title area and shows a superscript marker only for adjusted shifts', () => {
    const onOpenDetailedStaffing = vi.fn();
    renderSelector({
      dayShift: shift(slots, 'Persona Sintetica'),
      catalog: [],
      shiftIndicators: {
        day: { hasSpecialSchedule: role === 'nurse', extraCount: 1 },
        night: { hasSpecialSchedule: false, extraCount: 0 },
      },
      onOpenDetailedStaffing,
    });

    fireEvent.click(screen.getByRole('button', { name: `Abrir catálogo de ${label}` }));
    fireEvent.click(
      screen.getByRole('button', { name: `Abrir configuración detallada de ${label}` })
    );

    expect(setShowManager).toHaveBeenCalledWith(true);
    expect(onOpenDetailedStaffing).toHaveBeenCalledTimes(1);
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.queryByText('+1')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(`Horario especial en ${label} turno Largo`)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(`Configurar detalle de ${label} turno Largo`)
    ).not.toBeInTheDocument();
  });

  it('shows an explicit vacancy option instead of legacy blank markers', () => {
    renderSelector({ dayShift: shift(slots, '', '--'), catalog: [] });
    expect(screen.getAllByRole('option', { name: VACANCY_LABEL }).length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue(VACANCY_LABEL).length).toBeGreaterThan(0);
  });

  it('renders vacancy selections with a muted disabled-like appearance', () => {
    renderSelector({ dayShift: shift(slots, VACANCY_LABEL), catalog: ['Persona Sintetica'] });
    expect(screen.getAllByDisplayValue(VACANCY_LABEL)[0]).toHaveClass(
      'rounded-md',
      'bg-slate-100',
      'text-slate-600',
      'border-slate-300'
    );
  });
});

describe('StaffSelector (Enfermería only)', () => {
  it('reconciles the selected Eloísa alias without deleting possible catalog homonyms', () => {
    render(
      <StaffSelector
        role="nurse"
        dayShift={['Pedro Moreno Opazo', '']}
        nightShift={['', '']}
        catalog={['Pedro Moreno', 'Pedro Moreno Opazo', 'Camila Soto', 'Camila Soto Alegria']}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getAllByDisplayValue('Pedro Moreno Opazo')).toHaveLength(1);
    expect(screen.getAllByRole('option', { name: 'Pedro Moreno' })).toHaveLength(4);
    expect(screen.getAllByRole('option', { name: 'Pedro Moreno Opazo' })).toHaveLength(4);
    expect(screen.getAllByRole('option', { name: 'Camila Soto' })).toHaveLength(4);
    expect(screen.getAllByRole('option', { name: 'Camila Soto Alegria' })).toHaveLength(4);
  });

  it('re-capitalizes nurse names while TENS names stay as saved', () => {
    const { unmount } = render(
      <StaffSelector
        role="nurse"
        dayShift={['', '']}
        nightShift={['', '']}
        catalog={['maria  lopez']}
        onUpdate={vi.fn()}
      />
    );
    expect(screen.getAllByRole('option', { name: 'Maria Lopez' })).toHaveLength(4);
    unmount();
    render(
      <StaffSelector
        role="tens"
        dayShift={['', '', '']}
        nightShift={['', '', '']}
        catalog={['maria  lopez']}
        onUpdate={vi.fn()}
      />
    );
    expect(screen.queryByRole('option', { name: 'Maria Lopez' })).not.toBeInTheDocument();
  });
});
