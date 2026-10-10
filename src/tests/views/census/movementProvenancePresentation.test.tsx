import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import { MovementProvenanceBadge } from '@/features/census/components/MovementProvenanceBadge';
import { resolveMovementProvenancePresentation } from '@/features/census/controllers/movementProvenancePresentationController';

const localStamp = (iso: string): string => {
  const stamp = calendarStampInClinicalTimeZone(new Date(iso));
  return `${stamp.iso.split('-').reverse().join('-')} ${stamp.hhmm}`;
};

describe('movement provenance presentation', () => {
  it('presents an authoritative Gestión de Camas movement without exposing raw payloads', () => {
    const classifiedAt = '2026-07-14T18:20:00.000Z';
    const presentation = resolveMovementProvenancePresentation({
      source: 'gestion_camas',
      lineageId: 'movement-1',
      classifiedAt,
      classifiedBy: 'Enfermera Uno',
      syncRunId: 'run-1',
    });

    expect(presentation).toEqual({
      label: 'Egreso estad.',
      title: 'Egreso estadístico confirmado en Eloísa',
      tone: 'teal',
      icon: 'verified',
    });
    expect(JSON.stringify(presentation)).not.toContain(classifiedAt);
    expect(JSON.stringify(presentation)).not.toContain('run-1');
    expect(JSON.stringify(presentation)).not.toContain('Enfermera Uno');
  });

  it('renders a compact accessible badge for a reclassification', () => {
    const classifiedAt = '2026-07-14T19:10:00.000Z';
    render(
      <MovementProvenanceBadge
        provenance={{
          source: 'reclassified',
          lineageId: 'movement-1',
          classifiedAt,
          classifiedBy: 'Enfermera Dos',
          previousMovementId: 'movement-1',
          previousClassification: 'discharge',
        }}
      />
    );

    expect(screen.getByTestId('movement-provenance')).toHaveTextContent('Reclasif.');
    expect(
      screen.getByLabelText(
        `Reclasificado desde alta domicilio · Enfermera Dos · ${localStamp(classifiedAt)}`
      )
    ).toBeInTheDocument();
  });

  it('turns an authoritative badge into an accessible download action', () => {
    const onClick = vi.fn();
    render(
      <MovementProvenanceBadge
        provenance={{
          source: 'gestion_camas',
          lineageId: 'movement-1',
          classifiedAt: '2026-07-14T18:20:00.000Z',
          syncRunId: 'run-1',
        }}
        onClick={onClick}
      />
    );

    const action = screen.getByRole('button', { name: /Descargar PDF del egreso/i });
    expect(action).not.toHaveAttribute('title');
    action.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('omits an invalid classification timestamp instead of displaying raw text', () => {
    const presentation = resolveMovementProvenancePresentation({
      source: 'manual',
      lineageId: 'movement-2',
      classifiedAt: 'invalid-date',
    });

    expect(presentation.title).toBe('Registrado manualmente en HHR');
  });

  it('does not mislabel legacy movements as manual', () => {
    const presentation = resolveMovementProvenancePresentation();

    expect(presentation.label).toBe('');
    expect(presentation.title).toContain('Origen no registrado');
  });
});
