import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeSpecialtySetupError,
  JevSuggestionUnavailableError,
} from '@/services/specialty/specialtyJevClient';

describe('specialty catalog error messages', () => {
  afterEach(() => vi.restoreAllMocks());
  it('explains offline callable failures before mapping server errors', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(describeSpecialtySetupError({ code: 'functions/unavailable' })).toMatch(/sin conexión/i);
  });
  it('preserves the permanent pilot restriction while offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const message = 'La consulta Jev sólo está habilitada en hhr-pruebas.';
    expect(describeSpecialtySetupError(new JevSuggestionUnavailableError(message))).toBe(message);
  });
  it('keeps the catalog connection guidance when online', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    expect(describeSpecialtySetupError({ code: 'functions/unavailable' })).toContain('catálogo');
  });
});
