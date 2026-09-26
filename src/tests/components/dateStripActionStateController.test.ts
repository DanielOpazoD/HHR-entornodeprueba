import { describe, expect, it } from 'vitest';
import {
  resolveEmailButtonUiState,
  resolveSaveButtonUiState,
} from '@/components/layout/date-strip/actions/dateStripActionStateController';

describe('resolveSaveButtonUiState', () => {
  it('returns loading state for census variant', () => {
    const state = resolveSaveButtonUiState({
      isArchived: false,
      isBackingUp: true,
      variant: 'census',
    });

    expect(state.label).toBe('Guardando...');
    expect(state.iconKind).toBe('loading');
    expect(state.buttonClassName).toContain('slate');
    expect(state.buttonClassName).not.toContain('btn-primary');
    expect(state.widthClassName).toBe('w-[34px]');
  });

  it('returns archived state with success style', () => {
    const state = resolveSaveButtonUiState({
      isArchived: true,
      isBackingUp: false,
      variant: 'handoff',
    });

    expect(state.label).toBe('Sincronizado');
    expect(state.iconKind).toBe('archived');
    expect(state.buttonClassName).toContain('emerald');
    expect(state.widthClassName).toBe('min-w-[40px]');
  });

  it('returns default save state when idle', () => {
    const state = resolveSaveButtonUiState({
      isArchived: false,
      isBackingUp: false,
      variant: 'handoff',
    });

    expect(state.label).toBe('Guardar');
    expect(state.iconKind).toBe('default');
    expect(state.widthClassName).toBe('min-w-[40px]');
  });

  it('keeps census save secondary to the send action', () => {
    const state = resolveSaveButtonUiState({
      isArchived: false,
      isBackingUp: false,
      variant: 'census',
    });

    expect(state.buttonClassName).toContain('bg-white');
    expect(state.buttonClassName).not.toContain('btn-primary');
    expect(resolveEmailButtonUiState({ status: 'idle' }).buttonClassName).toContain('btn-primary');
  });
});

describe('resolveEmailButtonUiState', () => {
  it('returns loading label for loading status', () => {
    const state = resolveEmailButtonUiState({
      status: 'loading',
    });

    expect(state.label).toBe('Enviando...');
    expect(state.title).toBe('Enviar censo');
    expect(state.widthClassName).toBe('min-w-[116px]');
  });

  it('returns error title when status is error', () => {
    const state = resolveEmailButtonUiState({
      status: 'error',
      errorMessage: 'Error custom',
    });

    expect(state.label).toBe('Enviar censo');
    expect(state.title).toBe('Error custom');
    expect(state.widthClassName).toBe('min-w-[116px]');
  });
});
