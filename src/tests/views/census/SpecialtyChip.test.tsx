import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (name: string) => name !== 'SPECIALTY_RULES_MEMORY',
}));
vi.mock('@/services/specialty/specialtyJevClient', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/specialty/specialtyJevClient')>()),
  requestSpecialtySuggestion: request,
  acceptSpecialtySuggestion: vi.fn(),
  publishSpecialtyMemory: vi.fn(),
}));

import { SpecialtyChip } from '@/features/census/components/patient-row/SpecialtyChip';
import {
  acceptSpecialtySuggestion,
  JevSuggestionPendingError,
  JevSuggestionUnavailableError,
  shouldRetainJevRequestId,
} from '@/services/specialty/specialtyJevClient';

describe('SpecialtyChip Jev request identity', () => {
  afterEach(() => {
    request.mockReset();
    vi.unstubAllGlobals();
  });

  it('reuses a request after an ambiguous network failure', async () => {
    const randomUUID = vi.fn().mockReturnValue('synthetic-request-001');
    vi.stubGlobal('crypto', { randomUUID });
    request.mockRejectedValueOnce(new Error('network interrupted')).mockResolvedValueOnce({
      model: 'jev-1.13.0',
      promptVersion: '1',
      choice: 'internal_medicine',
      specialty: 'Med Interna',
      confidence: 0.8,
    });
    render(
      <SpecialtyChip
        specialty=""
        onAssign={vi.fn()}
        cie10Code="J18.9"
        scope={{ date: '2026-09-23', bedId: 'R1', target: 'bed', episodeId: 'synthetic-episode' }}
      />
    );
    fireEvent.click(screen.getByTitle('Asignar especialidad'));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    await screen.findByText('Med Interna');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]).toBe(request.mock.calls[1][1]);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Nueva consulta Jev' })).toBeEnabled()
    );
  });

  it('retains only uncertain failures and replaces an ID after definitive rejection', async () => {
    expect(shouldRetainJevRequestId(new JevSuggestionPendingError('pending'))).toBe(true);
    expect(shouldRetainJevRequestId({ code: 'functions/unavailable' })).toBe(true);
    expect(shouldRetainJevRequestId({ code: 'functions/aborted' })).toBe(false);
    expect(shouldRetainJevRequestId(new JevSuggestionUnavailableError('failed'))).toBe(false);

    const randomUUID = vi
      .fn()
      .mockReturnValueOnce('synthetic-request-001')
      .mockReturnValueOnce('synthetic-request-002');
    vi.stubGlobal('crypto', { randomUUID });
    request
      .mockRejectedValueOnce(
        Object.assign(new Error('stale evidence'), { code: 'functions/aborted' })
      )
      .mockResolvedValueOnce({
        model: 'jev-1.13.0',
        promptVersion: '1',
        choice: 'internal_medicine',
        specialty: 'Med Interna',
        confidence: 0.8,
      });
    render(
      <SpecialtyChip
        specialty=""
        onAssign={vi.fn()}
        cie10Code="J18.9"
        scope={{ date: '2026-09-23', bedId: 'R1', target: 'bed', episodeId: 'synthetic-episode' }}
      />
    );
    fireEvent.click(screen.getByTitle('Asignar especialidad'));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    await screen.findByText('Med Interna');
    expect(request.mock.calls.map(call => call[1])).toEqual([
      'synthetic-request-001',
      'synthetic-request-002',
    ]);
  });

  it('drops a pending request when the diagnosis code changes', async () => {
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce('synthetic-request-001')
      .mockReturnValueOnce('synthetic-request-002');
    vi.stubGlobal('crypto', { randomUUID });
    request.mockRejectedValueOnce(new Error('network interrupted')).mockResolvedValueOnce({
      model: 'jev-1.13.0',
      promptVersion: '1',
      choice: 'internal_medicine',
      specialty: 'Med Interna',
      confidence: 0.8,
    });
    const scope = {
      date: '2026-09-23',
      bedId: 'R1',
      target: 'bed' as const,
      episodeId: 'synthetic-episode',
    };
    const view = render(
      <SpecialtyChip specialty="" onAssign={vi.fn()} cie10Code="J18.9" scope={scope} />
    );
    fireEvent.click(screen.getByTitle('Asignar especialidad'));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    await screen.findByRole('alert');
    view.rerender(
      <SpecialtyChip specialty="" onAssign={vi.fn()} cie10Code="J18.1" scope={scope} />
    );
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.queryByRole('dialog', { name: 'Asignar especialidad' })).toBeNull();
    fireEvent.click(screen.getByTitle('Asignar especialidad'));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    await screen.findByText('Med Interna');
    expect(request.mock.calls.map(call => call[1])).toEqual([
      'synthetic-request-001',
      'synthetic-request-002',
    ]);
  });

  it('discards a late Jev response after the clinical episode changes', async () => {
    let resolvePrevious!: (result: unknown) => void;
    request
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolvePrevious = resolve;
          })
      )
      .mockResolvedValueOnce({
        model: 'jev-1.13.0',
        promptVersion: '1',
        choice: 'internal_medicine',
        specialty: 'Med Interna',
        confidence: 0.8,
      });
    const oldScope = {
      date: '2026-09-23',
      bedId: 'R1',
      target: 'bed' as const,
      episodeId: 'old-episode',
    };
    const view = render(
      <SpecialtyChip specialty="" onAssign={vi.fn()} cie10Code="J18.9" scope={oldScope} />
    );
    fireEvent.click(screen.getByTitle('Asignar especialidad'));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    view.rerender(
      <SpecialtyChip
        specialty=""
        onAssign={vi.fn()}
        cie10Code="J18.9"
        scope={{ ...oldScope, episodeId: 'new-episode' }}
      />
    );
    expect(screen.queryByRole('dialog', { name: 'Asignar especialidad' })).toBeNull();
    await act(async () => {
      resolvePrevious({
        model: 'jev-1.13.0',
        promptVersion: '1',
        choice: 'internal_medicine',
        specialty: 'Med Interna',
        confidence: 0.8,
      });
    });
    expect(screen.queryByText('Sugerencia:')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aceptar para este episodio' })).toBeNull();
    fireEvent.click(screen.getByTitle('Asignar especialidad'));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    await screen.findByRole('button', { name: 'Aceptar para este episodio' });
    expect(request.mock.calls[1][0].episodeId).toBe('new-episode');
    expect(request.mock.calls[1][1]).not.toBe(request.mock.calls[0][1]);
  });

  it('closes an open specialty choice when the occupant changes', () => {
    const assign = vi.fn();
    const oldScope = {
      date: '2026-09-23',
      bedId: 'R1',
      target: 'bed' as const,
      episodeId: 'old-episode',
    };
    const view = render(<SpecialtyChip specialty="" onAssign={assign} scope={oldScope} />);
    fireEvent.click(screen.getByTitle('Asignar especialidad'));
    expect(screen.getByRole('button', { name: 'Cirugía' })).toBeEnabled();

    view.rerender(
      <SpecialtyChip
        specialty=""
        onAssign={assign}
        scope={{ ...oldScope, episodeId: 'new-episode' }}
      />
    );

    expect(screen.queryByRole('dialog', { name: 'Asignar especialidad' })).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps the menu visible above the census scroller and explains an unconfirmed episode', () => {
    render(
      <div className="overflow-hidden">
        <SpecialtyChip specialty="" onAssign={vi.fn()} />
      </div>
    );
    fireEvent.click(screen.getByTitle('Asignar especialidad'));
    const dialog = screen.getByRole('dialog', { name: 'Asignar especialidad' });
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByRole('status').textContent).toContain('confirme el episodio clínico');
    expect(screen.getByRole('button', { name: 'Med Interna' })).toBeDisabled();
    fireEvent.scroll(window);
    expect(screen.queryByRole('dialog', { name: 'Asignar especialidad' })).toBeNull();
  });

  it('moves keyboard focus into the selector and restores it when closed', async () => {
    render(<SpecialtyChip specialty="" onAssign={vi.fn()} />);
    const trigger = screen.getByTitle('Asignar especialidad');
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Asignar especialidad' });
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar selector de especialidad' }));
    expect(screen.queryByRole('dialog', { name: 'Asignar especialidad' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('restores focus after a manual specialty choice', async () => {
    const onAssign = vi.fn();
    render(
      <SpecialtyChip
        specialty=""
        onAssign={onAssign}
        scope={{ date: '2026-09-23', bedId: 'R1', target: 'bed', episodeId: 'synthetic-episode' }}
      />
    );
    const trigger = screen.getByTitle('Asignar especialidad');
    fireEvent.click(trigger);
    const choice = screen.getByRole('button', { name: 'Cirugía' });
    choice.focus();
    fireEvent.click(choice);
    expect(onAssign).toHaveBeenCalledWith('Cirugía');
    expect(screen.queryByRole('dialog', { name: 'Asignar especialidad' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('restores focus after accepting a Jev suggestion', async () => {
    request.mockResolvedValueOnce({
      model: 'jev-1.13.0',
      promptVersion: '1',
      choice: 'internal_medicine',
      specialty: 'Med Interna',
      confidence: 0.8,
    });
    vi.mocked(acceptSpecialtySuggestion).mockResolvedValueOnce(undefined);
    render(
      <SpecialtyChip
        specialty=""
        onAssign={vi.fn()}
        cie10Code="J18.9"
        scope={{ date: '2026-09-23', bedId: 'R1', target: 'bed', episodeId: 'synthetic-episode' }}
      />
    );
    const trigger = screen.getByTitle('Asignar especialidad');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar sugerencia Jev' }));
    const accept = await screen.findByRole('button', { name: 'Aceptar para este episodio' });
    accept.focus();
    fireEvent.click(accept);
    await waitFor(() => expect(acceptSpecialtySuggestion).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Asignar especialidad' })).toBeNull()
    );
    expect(trigger).toHaveFocus();
  });
});
