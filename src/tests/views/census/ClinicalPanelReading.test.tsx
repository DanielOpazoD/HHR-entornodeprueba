import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ClinicalPanelCareDay,
  ClinicalPanelEntry,
  ClinicalPanelIndicationDay,
} from '@/features/rayen-import';
import {
  CareDayCard,
  EvolutionCard,
  IndicationDayCard,
} from '@/features/census/components/patient-row/ClinicalPanelSections';
import { ClinicalPanelHeading } from '@/features/census/components/patient-row/ClinicalPanelHeading';
import { ClinicalPanelProfessionTabs } from '@/features/census/components/patient-row/ClinicalPanelProfessionTabs';
import { ClinicalPanelUnavailable } from '@/features/census/components/patient-row/ClinicalPanelUnavailable';

const entry: ClinicalPanelEntry = {
  id: 'note-1',
  kind: 'evolution',
  title: '',
  text: 'Texto clínico de prueba.',
  author: 'Profesional de prueba',
  role: 'Médico',
  profession: 'medical',
  publishedAt: '2026-09-04T10:00:00',
  archived: false,
  suspended: false,
  isNew: false,
  crossedOut: false,
};

/** Type the panel would render under 12 px, or as spaced capitals instead of a plain label. */
const SMALL_OR_SHOUTED_TYPE =
  /(^|\s)(text-\[(\d|1[01])(\.\d+)?px\]|uppercase|tracking-\S+)(?=\s|$)/;

const indicationDay: ClinicalPanelIndicationDay = {
  day: '2026-09-04',
  label: 'Hoy · 04/09/2026',
  active: [
    { ...entry, id: 'diet', kind: 'diet', title: 'Régimen liviano', text: 'Fraccionado' },
    {
      ...entry,
      id: 'drug',
      kind: 'pharma',
      title: 'Fármaco de prueba',
      text: 'Cada 8 horas',
      validitySource: 'daily-validation',
    },
  ],
  suspended: [
    { ...entry, id: 'stop', kind: 'pharma', title: 'Suspendido', text: 'Dosis', suspended: true },
  ],
};

const careDay: ClinicalPanelCareDay = {
  day: '2026-09-04',
  label: 'Hoy · 04/09/2026',
  actions: [
    {
      id: 'care',
      title: 'Curación de prueba',
      detail: 'Detalle',
      schedule: '08:00',
      author: 'Profesional de prueba',
      performedAt: '2026-09-04T08:10:00',
      status: 'performed',
    },
  ],
};

describe('Clinical panel reading density', () => {
  it('reads every panel section at 12 px or more, with plain-case labels', () => {
    const { container } = render(
      <>
        <ClinicalPanelHeading
          patientName="Paciente de prueba"
          bedId="R1"
          isWide={false}
          onToggleWidth={vi.fn()}
          onClose={vi.fn()}
        />
        <ClinicalPanelProfessionTabs
          selected="medical"
          onSelect={vi.fn()}
          count={() => 2}
          view="notes"
          onViewChange={vi.fn()}
          notesCount={1}
          handoffsCount={1}
        >
          {null}
        </ClinicalPanelProfessionTabs>
        <EvolutionCard entry={{ ...entry, kind: 'shift-change' }} />
        <EvolutionCard entry={{ ...entry, id: 'annulled', crossedOut: true }} />
        <IndicationDayCard day={indicationDay} />
        <CareDayCard day={careDay} />
        <ClinicalPanelUnavailable message="Tiempo de espera agotado" onRetry={vi.fn()} />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: /1 inactiva/ }));

    expect(screen.getByText('Suspendida')).toBeVisible();
    const offenders = [...container.querySelectorAll('*')]
      .map(element => element.getAttribute('class') ?? '')
      .filter(className => SMALL_OR_SHOUTED_TYPE.test(className));
    expect(offenders).toEqual([]);
  });

  it('keeps annulled notes collapsed, with identity and status visible, and allows reopening', () => {
    render(<EvolutionCard entry={{ ...entry, crossedOut: true }} />);
    expect(screen.getByText(entry.author)).toBeVisible();
    expect(screen.getByText('Anulada')).toBeVisible();
    expect(screen.queryByText(entry.text)).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Mostrar evolución anulada' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByText(entry.text)).toHaveClass('line-through');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar evolución anulada' }));
    expect(screen.queryByText(entry.text)).not.toBeInTheDocument();
  });

  it.each([false, true])('keeps non-annulled notes visible, including archived=%s', archived => {
    render(<EvolutionCard entry={{ ...entry, archived }} />);
    expect(screen.getByText(entry.text)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    if (archived) expect(screen.getByText('Archivada')).toBeVisible();
  });

  it('separates long notes into paragraphs and highlights only the latest valid entry', () => {
    render(
      <EvolutionCard entry={{ ...entry, text: 'Primer párrafo.\n\nSegundo párrafo.' }} isLatest />
    );
    expect(screen.getByText('Primer párrafo.').tagName).toBe('P');
    expect(screen.getByText('Segundo párrafo.').tagName).toBe('P');
    expect(screen.getByRole('article')).toHaveClass('border-l-medical-600');
    expect(screen.getByText('04-09-2026 10:00').tagName).toBe('TIME');
  });

  it('shows only the bed below the patient name', () => {
    render(
      <ClinicalPanelHeading
        patientName="Paciente de prueba"
        bedId="R1"
        isWide={false}
        onToggleWidth={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Cama R1')).toBeVisible();
    expect(screen.queryByText(/Eloísa en vivo|no se guarda en HHR/)).not.toBeInTheDocument();
  });
});
