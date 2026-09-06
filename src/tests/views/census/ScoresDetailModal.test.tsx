import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScoresDetailModal } from '@/features/census/components/patient-row/ScoresDetailModal';
import { buildScoresCellModel } from '@/features/census/controllers/evaluationScoresCellController';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { EvaluationScoreEntry } from '@/types/domain/evaluationScores';

const entry = (code: 'BRADEN' | 'DOWNTON'): EvaluationScoreEntry => ({
  code,
  name: code,
  encounterEventId: code === 'BRADEN' ? 1 : 2,
  total: code === 'BRADEN' ? 22 : 2,
  severity: code === 'BRADEN' ? 'Riesgo bajo' : 'Riesgo medio',
  recordedDate: '2026-09-04',
  recordedAt: '2026-09-04T12:00:00',
  author: code === 'BRADEN' ? 'Profesional Braden' : 'Profesional Downton',
});
const model = () =>
  buildScoresCellModel(
    DataFactory.createMockPatient('R1', {
      age: '60',
      evaluationScores: {
        braden: entry('BRADEN'),
        downton: entry('DOWNTON'),
        history: [entry('BRADEN'), entry('DOWNTON')],
      },
    }),
    '2026-09-05'
  );

describe('ScoresDetailModal', () => {
  it('separates results and history while preserving application dates without planned care', async () => {
    const user = userEvent.setup();
    render(
      <ScoresDetailModal patientName="Paciente de prueba" model={model()} onClose={vi.fn()} />
    );
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Braden' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Cada 7 días/)).toBeInTheDocument();
    expect(screen.getByText(/Próxima aplicación: 11-09-2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Cuidados planeados|Cuidados básicos/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Profesional Braden')).toBeInTheDocument();
    expect(screen.queryByText('Profesional Downton')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Downton' }));
    expect(screen.getByText(/Próxima aplicación: 07-09-2026/)).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Profesional Downton')).toBeInTheDocument();
    expect(screen.queryByText('Profesional Braden')).not.toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Braden' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Braden' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps both tabs available when a scale has no result', async () => {
    const user = userEvent.setup();
    const empty = { ...model(), braden: null, downton: null, history: [] };
    render(<ScoresDetailModal patientName="Paciente de prueba" model={empty} onClose={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: 'Braden' }));
    expect(screen.getByText('Sin resultado vigente de Braden para este día.')).toBeInTheDocument();
    expect(
      screen.getByText('Sin aplicaciones registradas durante la hospitalización.')
    ).toBeInTheDocument();
  });
});
