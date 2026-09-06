import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScoresHistoryTable } from '@/features/census/components/patient-row/ScoresHistoryTable';
import type { EvaluationScoreEntry } from '@/types/domain/evaluationScores';

const application = (over: Partial<EvaluationScoreEntry> = {}): EvaluationScoreEntry => ({
  code: 'BRADEN',
  name: 'Escala de riesgo UPP (Braden)',
  encounterEventId: 20260726130119,
  total: 11,
  severity: 'Riesgo alto',
  recordedDate: '2026-07-26',
  recordedAt: '2026-07-26T13:01:19',
  author: 'Nicole Palma',
  authorRole: 'Enfermera(o)',
  ...over,
});

describe('ScoresHistoryTable', () => {
  it('shows a compact attributable row per application', () => {
    render(<ScoresHistoryTable history={[application()]} />);

    expect(screen.getByText('Aplicaciones durante la hospitalización')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Fecha' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Profesional' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText('26-07-2026 · 13:01:19')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Nicole Palma')).toBeInTheDocument();
    expect(screen.queryByText('Visible')).not.toBeInTheDocument();
  });

  it('explains archived applications without treating them as invalid', () => {
    render(<ScoresHistoryTable history={[application({ archived: true })]} />);

    expect(
      screen.getByTitle('Oculta del resumen rápido en Eloísa; sigue siendo una aplicación válida')
    ).toHaveTextContent('Nicole Palma');
    expect(screen.getByText('Archivada')).toBeInTheDocument();
  });

  it('keeps second-precise repeats distinguishable and preserves minute-only timestamps', () => {
    render(
      <ScoresHistoryTable
        history={[
          application({ encounterEventId: 1, recordedAt: '26-07-2026 13:01' }),
          application({ encounterEventId: 2, recordedAt: '2026-07-26T13:01:48' }),
        ]}
      />
    );

    expect(screen.getByText('26-07-2026 · 13:01')).toBeInTheDocument();
    expect(screen.getByText('26-07-2026 · 13:01:48')).toBeInTheDocument();
  });
});
