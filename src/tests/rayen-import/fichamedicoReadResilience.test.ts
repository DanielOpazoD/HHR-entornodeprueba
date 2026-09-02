// @vitest-environment node
import { describe, expect, it } from 'vitest';

import '../../../extension/fichamedico-read-resilience.js';

type Reader = {
  read: () => Promise<unknown>;
  isReadBlocked: () => boolean;
  getLastFailure: () => { at: number; message: string } | null;
};

type Resilience = {
  READ_BLOCK_TTL_MS: number;
  isNetworkFailure: (error: unknown) => boolean;
  describeNetworkFailure: (error: unknown, url: string) => Error;
  createSelfHealingReader: (input: {
    readOnce: () => Promise<unknown>;
    rebind: () => void;
    now?: () => number;
    blockTtlMs?: number;
  }) => Reader;
  describeSessionStatus: (input: { sessionReady: boolean; readBlocked: boolean }) => {
    ready: boolean;
    message: string;
  };
};

const resilience = (globalThis as unknown as { HhrFichaMedicoReadResilience: Resilience })
  .HhrFichaMedicoReadResilience;

describe('HhrFichaMedicoReadResilience', () => {
  it('reconoce fallos de red por mensaje (Chrome, Firefox, Safari) y no confunde errores HTTP', () => {
    expect(resilience.isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(
      resilience.isNetworkFailure(new Error('NetworkError when attempting to fetch resource.'))
    ).toBe(true);
    expect(resilience.isNetworkFailure(new Error('Load failed'))).toBe(true);
    expect(resilience.isNetworkFailure(new Error('500 en /encounter/list/filter'))).toBe(false);
    expect(resilience.isNetworkFailure('texto suelto')).toBe(false);
  });

  it('describe el fallo conservando el mensaje original y el endpoint sin query', () => {
    const described = resilience.describeNetworkFailure(
      new TypeError('Failed to fetch'),
      'https://fichamedicoback.rayensalud.cl/encounter/list/filter?facilityId=1342&filterType=3'
    );
    expect(described.message).toBe(
      'Failed to fetch al consultar https://fichamedicoback.rayensalud.cl/encounter/list/filter'
    );
  });

  it('reintenta una sola vez tras re-anclar, y una lectura exitosa limpia el bloqueo', async () => {
    const calls: string[] = [];
    let attempt = 0;
    const reader = resilience.createSelfHealingReader({
      readOnce: async () => {
        attempt += 1;
        calls.push(`read-${attempt}`);
        if (attempt === 1) throw new TypeError('Failed to fetch');
        return { ok: attempt };
      },
      rebind: () => calls.push('rebind'),
    });

    await expect(reader.read()).resolves.toEqual({ ok: 2 });
    expect(calls).toEqual(['read-1', 'rebind', 'read-2']);
    expect(reader.isReadBlocked()).toBe(false);
  });

  it('si el reintento también falla en red, recuerda el fallo y bloquea la salud hasta la próxima lectura buena', async () => {
    let failing = true;
    const reader = resilience.createSelfHealingReader({
      readOnce: async () => {
        if (failing) throw new TypeError('Failed to fetch al consultar https://x/encounter');
        return { ok: true };
      },
      rebind: () => undefined,
      now: () => 1_700_000_000_000,
    });

    await expect(reader.read()).rejects.toThrow('Failed to fetch');
    expect(reader.isReadBlocked()).toBe(true);
    expect(reader.getLastFailure()).toEqual({
      at: 1_700_000_000_000,
      message: 'Failed to fetch al consultar https://x/encounter',
    });
    expect(resilience.describeSessionStatus({ sessionReady: true, readBlocked: true })).toEqual({
      ready: false,
      message: expect.stringContaining('Recarga la pestaña (Cmd+R)'),
    });

    failing = false;
    await expect(reader.read()).resolves.toEqual({ ok: true });
    expect(reader.isReadBlocked()).toBe(false);
    expect(resilience.describeSessionStatus({ sessionReady: true, readBlocked: false })).toEqual({
      ready: true,
      message: 'Ficha Médico disponible. Sesión clínica vigente.',
    });
  });

  it('el bloqueo de salud caduca solo (2 min) para no atrapar al operador tras un fallo transitorio', async () => {
    let clock = 1_000_000;
    const reader = resilience.createSelfHealingReader({
      readOnce: async () => {
        throw new TypeError('Failed to fetch');
      },
      rebind: () => undefined,
      now: () => clock,
    });

    await expect(reader.read()).rejects.toThrow('Failed to fetch');
    expect(reader.isReadBlocked()).toBe(true);
    clock += resilience.READ_BLOCK_TTL_MS - 1;
    expect(reader.isReadBlocked()).toBe(true);
    clock += 1;
    expect(reader.isReadBlocked()).toBe(false);
    // El fallo sigue registrado para diagnóstico aunque ya no bloquee.
    expect(reader.getLastFailure()?.message).toBe('Failed to fetch');
  });

  it('un error HTTP no reintenta ni bloquea; una sesión ausente sigue siendo la causa principal', async () => {
    let attempts = 0;
    const reader = resilience.createSelfHealingReader({
      readOnce: async () => {
        attempts += 1;
        throw new Error('401 en /encounter/list/filter');
      },
      rebind: () => {
        throw new Error('no debe re-anclar ante un error HTTP');
      },
    });

    await expect(reader.read()).rejects.toThrow('401');
    expect(attempts).toBe(1);
    expect(reader.isReadBlocked()).toBe(false);
    expect(resilience.describeSessionStatus({ sessionReady: false, readBlocked: true })).toEqual({
      ready: false,
      message: 'La sesión clínica de Ficha Médico no está disponible.',
    });
  });
});
