import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ClinicalPanelEntry } from '@/features/rayen-import';
import { EvolutionCard } from '@/features/census/components/patient-row/ClinicalPanelSections';
import { ClinicalPanelHeading } from '@/features/census/components/patient-row/ClinicalPanelHeading';

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

describe('Clinical panel reading density', () => {
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
