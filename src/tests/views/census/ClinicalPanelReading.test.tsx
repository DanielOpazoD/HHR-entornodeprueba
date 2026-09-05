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
