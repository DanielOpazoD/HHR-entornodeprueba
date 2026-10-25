import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeSpecialtySetupError } from '@/services/specialty/specialtyJevClient';

describe('specialty catalog error messages', () => {
  afterEach(() => vi.restoreAllMocks());
  it('explains offline callable failures before mapping server errors', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(describeSpecialtySetupError({ code: 'functions/unavailable' })).toMatch(/sin conexión/i);
  });
  it('keeps the catalog connection guidance when online', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    expect(describeSpecialtySetupError({ code: 'functions/unavailable' })).toContain('catálogo');
  });
});
