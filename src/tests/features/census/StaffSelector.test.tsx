import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaffSelector } from '@/features/census/components/StaffSelector';
import { VACANCY_LABEL } from '@/services/staff/staffSelectionPresentation';
import { mergeEloisaStaff } from '@/services/staff/eloisaStaffDiscovery';
import type { EloisaStaffIdentity } from '@/services/staff/eloisaStaffIdentity';

const setShowNurseManager = vi.fn();
const setShowTensManager = vi.fn();
// People Eloísa reports for one test, on top of the fixed ones below.
const eloisa = vi.hoisted(() => ({ people: [] as EloisaStaffIdentity[] }));
afterEach(() => {
  eloisa.people = [];
});
/** Eloísa people built from observations with source IDs, as the app registers them. */
const eloisaPeople = (role: 'nurse' | 'tens', observed: [id: string, author: string][]) =>
  mergeEloisaStaff(
    [],
    observed.map(([practitionerId, author]) => ({
      practitionerId,
      author,
      role: role === 'nurse' ? 'Enfermera' : 'TENS',
      recordedAt: '2026-11-01T12:00',
    }))
  );

vi.mock('@/context/StaffContext', () => ({
  useStaffContext: () => ({
    setShowNurseManager,
    setShowTensManager,
    staffUsage: { nurse: { 'text:ana habitual': 3 }, tens: { 'text:ana habitual': 3 } },
    staffIdentities: (['nurse', 'tens'] as const).flatMap<EloisaStaffIdentity>(role => [
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
      ...eloisa.people.filter(person => person.role === role),
    ]),
  }),
}));

// `aliasShownAs`: what each role showed before the selectors were joined for an Eloísa alias
// («A Pena» → «Ana Pena») whose catalog spelling is «Ana Peña» (#1506 reached only TENS).
const roles = [
  {
    role: 'nurse',
    label: 'Enfermería',
    slots: 2,
    setShowManager: setShowNurseManager,
    aliasShownAs: VACANCY_LABEL,
  },
  {
    role: 'tens',
    label: 'TENS',
    slots: 3,
    setShowManager: setShowTensManager,
    aliasShownAs: 'Ana Peña',
  },
] as const;

const shift = (slots: number, ...names: string[]) =>
  Array.from({ length: slots }, (_, index) => names[index] ?? '');

describe.each(roles)(
  'StaffSelector ($label)',
  ({ role, label, slots, setShowManager, aliasShownAs }) => {
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
      expect(update).toHaveBeenCalledWith(role, 'day', 0, 'Berta Poco');
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
      expect(update).toHaveBeenCalledWith(role, 'day', 0, 'Ana Maria Soto Rojas');
    });

    it('shows an Eloísa alias against a ñ catalog spelling as before the join', () => {
      renderSelector({ dayShift: shift(slots, 'A Pena'), catalog: ['Ana Peña'] });
      expect(screen.getByLabelText(dayLabel)).toHaveValue(aliasShownAs);
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        role === 'nurse' ? 'Ana Pena' : 'Ana Peña'
      );
      expect(screen.queryByRole('option', { name: 'Ana Pena' })).not.toBeInTheDocument();
    });

    it('keeps a cedilla apart: an alias of «Ana Franca» never shows «Ana França»', () => {
      eloisa.people = eloisaPeople(role, [
        ['syn-f1', 'A Franca'],
        ['syn-f1', 'Ana Franca'],
        ['syn-f2', 'Ana França'],
      ]);
      const update = vi.fn();
      renderSelector({
        dayShift: shift(slots, 'A Franca'),
        catalog: ['Ana França'],
        onUpdate: update,
      });
      expect(screen.getByLabelText(dayLabel)).toHaveValue('Ana Franca');
      expect(screen.getByRole('tooltip')).toHaveTextContent('Ana Franca');
      expect(update).not.toHaveBeenCalled();
    });

    it('shows a saved name that two Eloísa people share as written, never as one of them', () => {
      eloisa.people = eloisaPeople(role, [
        ['syn-p1', 'Ana Pena'],
        ['syn-p2', 'Ana Peña'],
      ]);
      const update = vi.fn();
      renderSelector({
        dayShift: shift(slots, 'Ana Pena'),
        catalog: ['Ana Peña'],
        onUpdate: update,
      });
      expect(screen.getByLabelText(dayLabel)).toHaveValue(VACANCY_LABEL);
      expect(screen.getByRole('tooltip')).toHaveTextContent('Ana Pena');
      expect(update).not.toHaveBeenCalled();
    });

    it('shows two Eloísa IDs whose names fold alike as two options and saves the one chosen', () => {
      eloisa.people = eloisaPeople(role, [
        ['syn-l1', 'Luz Pena'],
        ['syn-l2', 'Luz Peña'],
      ]);
      const update = vi.fn();
      const { rerender } = renderSelector({
        catalog: ['Luz Pena', 'Luz Peña'],
        onUpdate: update,
      });
      expect(screen.getAllByRole('option', { name: 'Luz Pena' })).toHaveLength(slots * 2);
      expect(screen.getAllByRole('option', { name: 'Luz Peña' })).toHaveLength(slots * 2);
      fireEvent.change(screen.getByLabelText(dayLabel), { target: { value: 'Luz Pena' } });
      expect(update).toHaveBeenLastCalledWith(role, 'day', 0, 'Luz Pena');
      fireEvent.change(screen.getByLabelText(dayLabel), { target: { value: 'Luz Peña' } });
      expect(update).toHaveBeenLastCalledWith(role, 'day', 0, 'Luz Peña');
      // Reopened, the saved choice shows as itself, never as the other person; case and
      // spacing do not tell people apart («LUZ  PENA» is the option «Luz Pena»).
      for (const [saved, shown] of [
        ['Luz Pena', 'Luz Pena'],
        ['Luz Peña', 'Luz Peña'],
        ['LUZ  PENA', 'Luz Pena'],
      ]) {
        rerender(
          <StaffSelector
            role={role}
            dayShift={shift(slots, saved)}
            nightShift={shift(slots)}
            catalog={['Luz Pena', 'Luz Peña']}
            onUpdate={update}
          />
        );
        expect(screen.getByLabelText(dayLabel)).toHaveValue(shown);
      }
    });

    it.each([
      ['one Eloísa ID', [['syn-l1', 'Luz Pena']] as [string, string][]],
      ['no Eloísa ID', [] as [string, string][]],
    ])(
      'shows «Luz Pena» and «Luz Peña» as one option spelled with ñ with %s',
      (_label, observed) => {
        eloisa.people = eloisaPeople(role, observed);
        renderSelector({ dayShift: shift(slots, 'Luz Pena'), catalog: ['Luz Pena', 'Luz Peña'] });
        expect(screen.getAllByRole('option', { name: 'Luz Peña' })).toHaveLength(slots * 2);
        expect(screen.queryByRole('option', { name: 'Luz Pena' })).not.toBeInTheDocument();
        expect(screen.getByLabelText(dayLabel)).toHaveValue(
          role === 'tens' ? 'Luz Peña' : 'Luz Peña'
        );
      }
    );

    it('keeps selected staff visible even when the catalog has not hydrated yet', () => {
      renderSelector({ dayShift: shift(slots, 'Persona Sintetica'), catalog: [] });
      expect(screen.getAllByRole('option', { name: 'Persona Sintetica' }).length).toBeGreaterThan(
        0
      );
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
  }
);

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
