import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
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
  it('keeps stored CUDYR history consultable without claiming it is current', async () => {
    const user = userEvent.setup();
    const past = {
      category: 'C2',
      source: 'Gestión de Camas',
      recordedDate: '2026-09-01',
      author: 'Firma anterior',
    };
    render(
      <ScoresDetailModal
        patientName="Paciente de prueba"
        model={{ ...model(), cudyr: null }}
        importedCudyr={past}
        onClose={vi.fn()}
      />
    );
    await user.click(screen.getByRole('tab', { name: 'CUDYR' }));
    expect(screen.getByText('Firma anterior')).toBeInTheDocument();
    expect(screen.getByText('Sin resultado vigente de CUDYR para este día.')).toBeInTheDocument();
  });
  it('shows admission and a separate attributable CUDYR table with keyboard navigation', async () => {
    const user = userEvent.setup();
    const imported = {
      category: 'C2',
      source: 'Gestión de Camas',
      recordedDate: '2026-09-04',
      // Source instants include an offset: census ownership must not depend on the runner TZ.
      recordedAt: '2026-09-04T12:00:00-06:00',
      author: 'Firma Cudyr',
      history: [
        {
          category: 'C2',
          recordedDate: '2026-09-04',
          recordedAt: '2026-09-04T12:00:00',
          author: 'Firma Cudyr',
        },
      ],
    };
    const scoreModel = buildScoresCellModel(
      DataFactory.createMockPatient('R1', { evaluationScores: { cudyr: imported } }),
      '2026-09-04'
    );
    const original = structuredClone(scoreModel);
    render(
      <ScoresDetailModal
        patientName="Paciente de prueba"
        admissionDate="2026-09-01"
        model={scoreModel}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('01-09-2026')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cerrar modal' })).toHaveFocus());
    await user.click(screen.getByRole('tab', { name: 'CUDYR' }));
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Firma Cudyr')).toBeInTheDocument();
    expect(table.getByText('Firma sincronizada')).toBeInTheDocument();
    expect(table.getByText('04-09-2026 · 12:00')).toBeInTheDocument();
    expect(table.getAllByRole('columnheader')).toHaveLength(4);
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Downton' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'CUDYR' })).toHaveFocus();
    expect(scoreModel).toEqual(original);
  });

  it.each(['Ficha Médico', 'Respaldo externo'])(
    'preserves fallback %s without inventing signer or complete history',
    async source => {
      const user = userEvent.setup();
      const scoreModel = buildScoresCellModel(
        DataFactory.createMockPatient('R1', {
          evaluationScores: {
            cudyr: { category: 'D3', source, recordedDate: '2026-09-04' },
          },
        }),
        '2026-09-04'
      );
      render(
        <ScoresDetailModal patientName="Paciente de prueba" model={scoreModel} onClose={vi.fn()} />
      );
      await user.click(screen.getByRole('tab', { name: 'CUDYR' }));
      expect(screen.getByText(/no historial completo/)).toBeInTheDocument();
      expect(screen.getByText(source)).toBeInTheDocument();
      expect(screen.getByText('Sin firma informada')).toBeInTheDocument();
      expect(screen.queryByText('Firma sincronizada')).not.toBeInTheDocument();
    }
  );
  it('separates results and history while preserving application dates without planned care', async () => {
    const user = userEvent.setup();
    render(
      <ScoresDetailModal patientName="Paciente de prueba" model={model()} onClose={vi.fn()} />
    );
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Braden' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Cada 7 días/)).toBeInTheDocument();
    expect(screen.getByText(/Próxima aplicación: 11-09-2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Cuidados planeados|Cuidados básicos/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Profesional Braden')).toBeInTheDocument();
    expect(screen.queryByText('Profesional Downton')).not.toBeInTheDocument();
    // Finish the modal's initial focus before testing user-driven keyboard navigation.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cerrar modal' })).toHaveFocus());
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
