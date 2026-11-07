import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EvolutionCard } from '@/features/census/components/patient-row/ClinicalPanelSections';
import { parseClinicalPanel } from '@/features/rayen-import/clinical-panel';
import { panelResult } from '../clinicalPanelDrawer.fixture';

const entries = parseClinicalPanel(panelResult.events, panelResult.carePlan).evolutions;
const [latest, older] = entries;
if (!latest || !older) throw new Error('Synthetic evolution fixtures are required');

describe('compact explorer evolutions', () => {
  it('opens the latest note and expands an earlier note without dropping its author or date', () => {
    render(
      <>
        <EvolutionCard entry={latest} isLatest collapsible />
        <EvolutionCard entry={older} collapsible />
      </>
    );
    expect(screen.getByText(latest.text)).toBeVisible();
    expect(screen.queryByText(older.text)).toBeNull();
    const toggle = screen.getByRole('button', { name: /Mostrar evolución de/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByText(older.text)).toBeVisible();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.queryByText(older.text)).toBeNull();
    expect(screen.getByRole('button', { name: /Mostrar evolución de/ })).toBeVisible();
    expect(screen.getAllByText(older.author || older.role || 'Sin autor').length).toBeGreaterThan(
      0
    );
  });
  it('preserves full note text by default for the existing drawer and full-history view', () => {
    render(<EvolutionCard entry={older} />);
    expect(screen.getByText(older.text)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Mostrar evolución de/ })).toBeNull();
  });
  it('keeps annulled text behind its explicit annulment control', () => {
    render(<EvolutionCard entry={{ ...older, crossedOut: true }} collapsible isLatest />);
    expect(screen.queryByText(older.text)).toBeNull();
    expect(screen.getByText('Anulada')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar evolución anulada' }));
    expect(screen.getByText(older.text)).toBeVisible();
  });
});
