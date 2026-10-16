import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  NeonatalPlacementReview,
  neonatalEffectiveInstant,
} from '@/features/rayen-import/components/NeonatalPlacementReview';
import { NeonatalSourceChanges } from '@/features/rayen-import/components/NeonatalSourceChanges';
import { RayenImportConfirmButton } from '@/features/rayen-import/components/RayenImportConfirmButton';
import type { NeonatalPlacementReview as Review } from '@/features/rayen-import/contracts/neonatalPlacementReview';

const review = {
  episodeId: '1001',
  patient: { patientName: 'RN ejemplo' },
  source: {},
  mothers: [{ bedId: 'R3', episodeId: '2001', name: 'Madre ejemplo' }],
  independentBeds: ['H2C1'],
} as unknown as Review;
describe('RN placement review controls', () => {
  it('asks for mother or independent bed and shows one short source reminder', () => {
    const change = vi.fn();
    render(<NeonatalPlacementReview reviews={[review]} choices={[]} onChange={change} />);
    expect(screen.getByText(/Corrige también el tipo de cama/)).toBeDefined();
    fireEvent.change(screen.getByLabelText('Ubicación de RN ejemplo'), {
      target: { value: 'mother:R3' },
    });
    expect(change).toHaveBeenLastCalledWith([
      { episodeId: '1001', kind: 'mother', bedId: 'R3', parentEpisodeId: '2001' },
    ]);
  });
  it('requires the effective hospital time independently of the classification choice', () => {
    const change = vi.fn();
    render(
      <NeonatalPlacementReview
        reviews={[review]}
        choices={[{ episodeId: '1001', kind: 'independent', bedId: 'H2C1' }]}
        onChange={change}
      />
    );
    fireEvent.change(
      screen.getByLabelText('Hospitalizado en cama independiente desde (Rapa Nui)'),
      { target: { value: '2026-10-10T12:30' } }
    );
    expect(change).toHaveBeenLastCalledWith([
      {
        episodeId: '1001',
        kind: 'independent',
        bedId: 'H2C1',
        effectiveAt: '2026-10-10T12:30:00-05:00',
      },
    ]);
  });
  it('keeps the entered care onset when correcting the selected independent bed', () => {
    const change = vi.fn();
    const choices = [
      {
        episodeId: '1001',
        kind: 'independent' as const,
        bedId: 'H2C1',
        effectiveAt: '2026-10-10T12:30:00-05:00',
      },
    ];
    const extended = { ...review, independentBeds: ['H2C1', 'R1'] };
    const view = render(
      <NeonatalPlacementReview reviews={[extended]} choices={choices} onChange={change} />
    );
    fireEvent.change(screen.getByLabelText('Ubicación de RN ejemplo'), {
      target: { value: 'independent:R1' },
    });
    expect(change).toHaveBeenCalledWith([{ ...choices[0], bedId: 'R1' }]);
    view.rerender(
      <NeonatalPlacementReview
        reviews={[extended]}
        choices={change.mock.calls[0][0]}
        onChange={change}
      />
    );
    expect(
      (
        screen.getByLabelText(
          'Hospitalizado en cama independiente desde (Rapa Nui)'
        ) as HTMLInputElement
      ).value
    ).toBe('2026-10-10T12:30');
  });
  it('requires every review to be answered and accepts explicit deferral', () => {
    const confirm = vi.fn();
    const props = {
      onConfirm: confirm,
      previousDays: false,
      collisions: [],
      hasCollisions: false,
      cma: [],
      needsCma: false,
      neonatalReviews: [review],
      neonatalSourceChanges: [],
      neonatalSourceAcknowledgements: [],
      disabled: false,
      label: 'Confirmar',
    };
    const view = render(<RayenImportConfirmButton {...props} neonatal={[]} />);
    expect((screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    view.rerender(
      <RayenImportConfirmButton
        {...props}
        neonatal={[{ episodeId: '1001', kind: 'deferred', bedId: '' }]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(confirm).toHaveBeenCalledWith(false, undefined, undefined, [
      { episodeId: '1001', kind: 'deferred', bedId: '' },
    ]);
  });
  it('requires explicit acknowledgement for each changed source location', () => {
    const change = {
      episodeId: '1001',
      patientName: 'RN ejemplo',
      sourceMode: 'Cama' as const,
      sourceBedId: 'R1',
      hhrMode: 'Cama' as const,
      hhrBedId: 'NEO1',
    };
    const confirm = vi.fn();
    const onChange = vi.fn();
    const props = {
      onConfirm: confirm,
      previousDays: false,
      collisions: [],
      hasCollisions: false,
      cma: [],
      needsCma: false,
      neonatal: [],
      neonatalReviews: [],
      neonatalSourceChanges: [change],
      disabled: false,
      label: 'Confirmar',
    };
    const view = render(
      <>
        <NeonatalSourceChanges changes={[change]} acceptedEpisodes={[]} onChange={onChange} />
        <RayenImportConfirmButton {...props} neonatalSourceAcknowledgements={[]} />
      </>
    );
    expect((screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(['1001']);
    view.rerender(
      <RayenImportConfirmButton {...props} neonatalSourceAcknowledgements={['1001']} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(confirm).toHaveBeenCalledWith(false, undefined, undefined, [], ['1001']);
    view.rerender(
      <RayenImportConfirmButton
        {...props}
        neonatalSourceChanges={[change, { ...change, episodeId: '1002' }]}
        neonatalSourceAcknowledgements={['1001']}
      />
    );
    expect((screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });
  it('shows every unit while protecting unavailable independent beds', () => {
    const all = {
      ...review,
      mothers: [
        { bedId: 'R3', episodeId: '2001', name: 'Madre ejemplo', occupiedByEpisodeId: 'OTHER' },
      ],
      independentBeds: ['R3', 'H2C1', 'BOX1'],
      unavailableIndependentBeds: ['R3'],
    };
    render(<NeonatalPlacementReview reviews={[all]} choices={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('option', { name: /C-R3.*Madre ejemplo/ })).toBeDefined();
    expect(
      (screen.getByRole('option', { name: 'R3 · ocupada / no disponible' }) as HTMLOptionElement)
        .disabled
    ).toBe(true);
    expect((screen.getByRole('option', { name: 'BOX1' }) as HTMLOptionElement).disabled).toBe(
      false
    );
  });
  it('lets the operator disambiguate a repeated Rapa Nui wall clock without guessing', () => {
    const change = vi.fn();
    const view = render(
      <NeonatalPlacementReview
        reviews={[review]}
        choices={[{ episodeId: '1001', kind: 'independent', bedId: 'H2C1' }]}
        onChange={change}
      />
    );
    fireEvent.change(
      screen.getByLabelText('Hospitalizado en cama independiente desde (Rapa Nui)'),
      { target: { value: '2026-04-04T21:30' } }
    );
    expect(change).toHaveBeenLastCalledWith([
      { episodeId: '1001', kind: 'independent', bedId: 'H2C1', effectiveAt: undefined },
    ]);
    view.rerender(
      <NeonatalPlacementReview
        reviews={[review]}
        choices={change.mock.lastCall![0]}
        onChange={change}
      />
    );
    fireEvent.change(screen.getByLabelText('Ocurrencia de la hora de hospitalización'), {
      target: { value: '2026-04-04T21:30:00-06:00' },
    });
    expect(change).toHaveBeenLastCalledWith([
      {
        episodeId: '1001',
        kind: 'independent',
        bedId: 'H2C1',
        effectiveAt: '2026-04-04T21:30:00-06:00',
      },
    ]);
  });
  it('does not guess invalid or nonexistent wall clocks', () => {
    expect(neonatalEffectiveInstant('')).toBeUndefined();
    expect(neonatalEffectiveInstant('2026-09-05T22:30')).toBeUndefined();
  });
});
