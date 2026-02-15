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
    expect(state.buttonClassName).toContain('amber');
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
  });

  it('returns default save state when idle', () => {
    const state = resolveSaveButtonUiState({
      isArchived: false,
      isBackingUp: false,
      variant: 'handoff',
    });

    expect(state.label).toBe('Guardar');
    expect(state.iconKind).toBe('default');
  });
});

describe('resolveEmailButtonUiState', () => {
  it('returns loading label for loading status', () => {
    const state = resolveEmailButtonUiState({
      status: 'loading',
    });

    expect(state.label).toBe('Enviando...');
    expect(state.title).toBe('Enviar censo');
  });

  it('returns error title when status is error', () => {
    const state = resolveEmailButtonUiState({
      status: 'error',
      errorMessage: 'Error custom',
    });

    expect(state.label).toBe('Enviar censo');
    expect(state.title).toBe('Error custom');
  });
});
