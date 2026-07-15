import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MovementProvenanceBadge } from '@/features/census/components/MovementProvenanceBadge';
import { resolveMovementProvenancePresentation } from '@/features/census/controllers/movementProvenancePresentationController';

describe('movement provenance presentation', () => {
  it('presents an authoritative Gestión de Camas movement without exposing raw payloads', () => {
    const presentation = resolveMovementProvenancePresentation({
      source: 'gestion_camas',
      lineageId: 'movement-1',
      classifiedAt: '2026-07-14T18:20:00.000Z',
      classifiedBy: 'Enfermera Uno',
      syncRunId: 'run-1',
    });

    expect(presentation).toEqual({
      label: 'Rayen',
      title: 'Confirmado por Gestión de Camas mediante Eloísa · Enfermera Uno · 14-07-2026 18:20',
      tone: 'teal',
      icon: 'verified',
    });
    expect(JSON.stringify(presentation)).not.toContain('run-1');
  });

  it('renders a compact accessible badge for a reclassification', () => {
    render(
      <MovementProvenanceBadge
        provenance={{
          source: 'reclassified',
          lineageId: 'movement-1',
          classifiedAt: '2026-07-14T19:10:00.000Z',
          classifiedBy: 'Enfermera Dos',
          previousMovementId: 'movement-1',
          previousClassification: 'discharge',
        }}
      />
    );

    expect(screen.getByTestId('movement-provenance')).toHaveTextContent('Reclasif.');
    expect(
      screen.getByLabelText('Reclasificado desde alta domicilio · Enfermera Dos · 14-07-2026 19:10')
    ).toBeInTheDocument();
  });

  it('does not mislabel legacy movements as manual', () => {
    const presentation = resolveMovementProvenancePresentation();

    expect(presentation.label).toBe('');
    expect(presentation.title).toContain('Origen no registrado');
  });
});
