import { describe, expect, it } from 'vitest';
import { resolveActionHeaderState } from '@/features/census/controllers/censusActionHeaderController';

describe('censusActionHeaderController', () => {
  it('returns actionable trash button when record can be deleted', () => {
    const state = resolveActionHeaderState({
      readOnly: false,
      canDeleteRecord: true,
      deniedMessage: 'denied',
    });

    expect(state.shouldRenderButton).toBe(true);
    expect(state.icon).toBe('trash');
    expect(state.title).toBe('Limpiar todos los datos del día');
  });

  it('returns disabled shield button when delete is denied but visible', () => {
    const state = resolveActionHeaderState({
      readOnly: false,
      canDeleteRecord: false,
      deniedMessage: 'No autorizado',
    });

    expect(state.shouldRenderButton).toBe(true);
    expect(state.icon).toBe('shield');
    expect(state.title).toBe('No autorizado');
  });

  it('hides button in readonly mode when delete is denied', () => {
    const state = resolveActionHeaderState({
      readOnly: true,
      canDeleteRecord: false,
      deniedMessage: 'No autorizado',
    });

    expect(state.shouldRenderButton).toBe(false);
  });
});
