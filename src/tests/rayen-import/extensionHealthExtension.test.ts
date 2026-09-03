import { describe, expect, it, vi } from 'vitest';

import '../../../extension/health-check.js';

const health = (
  globalThis as typeof globalThis & {
    HhrExtensionHealth: {
      orderTabs: <T extends { active?: boolean; lastAccessed?: number }>(tabs: T[]) => T[];
      probeTabs: (input: {
        tabs: Array<{ id?: number; active?: boolean; lastAccessed?: number }>;
        sendMessage: (tabId: number, message: { type: string }) => Promise<unknown>;
        missingMessage: string;
        staleMessage: string;
        preferExpiryPublisher?: boolean;
      }) => Promise<{ status: string; message: string }>;
    };
  }
).HhrExtensionHealth;

describe('extension health helpers', () => {
  it('prefers the active and most recently used relay tab', () => {
    const tabs = [
      { id: 1, active: false, lastAccessed: 300 },
      { id: 2, active: true, lastAccessed: 100 },
      { id: 3, active: false, lastAccessed: 500 },
    ];
    expect(health.orderTabs(tabs).map(tab => tab.id)).toEqual([2, 3, 1]);
    expect(tabs.map(tab => tab.id)).toEqual([1, 2, 3]);
  });

  it('reports missing, ready and stale relays without reading clinical data', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('stale tab'))
      .mockResolvedValueOnce({ ready: true, message: 'Ficha Médico disponible.' });

    await expect(
      health.probeTabs({
        tabs: [],
        sendMessage,
        missingMessage: 'No abierta.',
        staleMessage: 'Recarga.',
      })
    ).resolves.toEqual({ status: 'missing', message: 'No abierta.' });

    await expect(
      health.probeTabs({
        tabs: [
          { id: 1, active: true },
          { id: 2, active: false },
        ],
        sendMessage,
        missingMessage: 'No abierta.',
        staleMessage: 'Recarga.',
      })
    ).resolves.toEqual({ status: 'ready', message: 'Ficha Médico disponible.' });

    await expect(
      health.probeTabs({
        tabs: [{ id: 3 }],
        sendMessage: vi.fn().mockResolvedValue({
          ready: false,
          message: 'La sesión clínica de Ficha Médico no está disponible.',
        }),
        missingMessage: 'No abierta.',
        staleMessage: 'Recarga.',
      })
    ).resolves.toEqual({
      status: 'stale',
      message: 'La sesión clínica de Ficha Médico no está disponible.',
    });

    expect(sendMessage.mock.calls[0]?.[1]).toEqual({ type: 'RAYEN_EXTENSION_HEALTH_PING' });
  });

  it('keeps the diagnostic from the highest-priority unavailable tab', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ ready: false, message: 'La sesión activa venció.' })
      .mockResolvedValueOnce({ ready: false, message: 'Recarga una pestaña antigua.' });

    await expect(
      health.probeTabs({
        tabs: [
          { id: 1, active: true, lastAccessed: 200 },
          { id: 2, active: false, lastAccessed: 100 },
        ],
        sendMessage,
        missingMessage: 'No abierta.',
        staleMessage: 'Recarga.',
      })
    ).resolves.toEqual({ status: 'stale', message: 'La sesión activa venció.' });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe('extension health helpers · vigencia de la fuente', () => {
  it('propaga la vigencia publicada por la pestaña lista (Ficha Médico ≥ 0.48.5) y omite valores no numéricos', async () => {
    await expect(
      health.probeTabs({
        tabs: [{ id: 1, active: true }],
        sendMessage: vi.fn().mockResolvedValue({
          ready: true,
          message: 'Ficha Médico disponible. Sesión clínica vigente.',
          identity: { fullName: 'Daniel Opazo', role: 'Médico' },
          expiresAt: 1_788_445_690_306,
          remainingSeconds: 82_800,
        }),
        missingMessage: 'No abierta.',
        staleMessage: 'Recarga.',
      })
    ).resolves.toEqual({
      status: 'ready',
      message: 'Ficha Médico disponible. Sesión clínica vigente.',
      identity: { fullName: 'Daniel Opazo', role: 'Médico' },
      expiresAt: 1_788_445_690_306,
      remainingSeconds: 82_800,
    });

    await expect(
      health.probeTabs({
        tabs: [{ id: 1, active: true }],
        sendMessage: vi.fn().mockResolvedValue({
          ready: true,
          message: 'Ficha Médico disponible.',
          expiresAt: null,
          remainingSeconds: 'pronto',
        }),
        missingMessage: 'No abierta.',
        staleMessage: 'Recarga.',
      })
    ).resolves.toEqual({ status: 'ready', message: 'Ficha Médico disponible.' });
  });

  it('prefiere la pestaña lista que publica vigencia sobre una activa con inject antiguo (0.48.6)', async () => {
    // Tras recargar la extensión, el inject de mundo principal de una pestaña ya
    // abierta sigue vivo y responde «lista» sin vigencia; la pestaña recargada sí la
    // publica. La salud debe reflejar la vigencia real y no depender del orden.
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ready: true,
        message: 'Ficha Médico disponible.',
        identity: { fullName: 'Daniel Opazo', role: 'Médico' },
      })
      .mockResolvedValueOnce({
        ready: true,
        message: 'Ficha Médico disponible. Sesión clínica vigente.',
        identity: { fullName: 'Daniel Opazo', role: 'Médico' },
        expiresAt: 1_788_445_690_306,
        remainingSeconds: 67_718,
      });
    await expect(
      health.probeTabs({
        tabs: [
          { id: 1, active: true },
          { id: 2, active: false, lastAccessed: 10 },
        ],
        sendMessage,
        missingMessage: 'No abierta.',
        staleMessage: 'Recarga.',
        preferExpiryPublisher: true,
      })
    ).resolves.toEqual({
      status: 'ready',
      message: 'Ficha Médico disponible. Sesión clínica vigente.',
      identity: { fullName: 'Daniel Opazo', role: 'Médico' },
      expiresAt: 1_788_445_690_306,
      remainingSeconds: 67_718,
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);

    // Si ninguna pestaña publica vigencia, gana la primera lista (comportamiento previo).
    const legacyOnly = vi
      .fn()
      .mockResolvedValueOnce({ ready: true, message: 'Primera lista.' })
      .mockResolvedValueOnce({ ready: true, message: 'Segunda lista.' })
      .mockResolvedValueOnce({ ready: false, message: 'No lista.' });
    await expect(
      health.probeTabs({
        tabs: [{ id: 1, active: true }, { id: 2 }, { id: 3 }],
        sendMessage: legacyOnly,
        missingMessage: 'No abierta.',
        staleMessage: 'Recarga.',
      })
    ).resolves.toEqual({ status: 'ready', message: 'Primera lista.' });
  });

  it('una sesión vencida (remainingSeconds 0) cuenta como vigencia publicada y gana a una pestaña sin vigencia', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ ready: true, message: 'Sin vigencia.' })
      .mockResolvedValueOnce({
        ready: true,
        message: 'Vencida.',
        remainingSeconds: 0,
        expiresAt: 1,
      });
    await expect(
      health.probeTabs({
        tabs: [{ id: 1, active: true }, { id: 2 }],
        sendMessage,
        missingMessage: 'No abierta.',
        staleMessage: 'Recarga.',
        preferExpiryPublisher: true,
      })
    ).resolves.toEqual({ status: 'ready', message: 'Vencida.', remainingSeconds: 0, expiresAt: 1 });
    // Sin la opción (Gestión de Camas), la primera lista gana sin sondear el resto.
    const gcSend = vi
      .fn()
      .mockResolvedValueOnce({ ready: true, message: 'GC lista.' })
      .mockResolvedValueOnce({ ready: true, message: 'Otra GC.', remainingSeconds: 5 });
    await expect(
      health.probeTabs({
        tabs: [{ id: 1, active: true }, { id: 2 }],
        sendMessage: gcSend,
        missingMessage: 'No abierta.',
        staleMessage: 'Recarga.',
      })
    ).resolves.toEqual({ status: 'ready', message: 'GC lista.' });
    expect(gcSend).toHaveBeenCalledTimes(1);
  });

  it('las pestañas restantes se sondean en paralelo y gana la primera por preferencia, no la más rápida', async () => {
    let releaseSecond!: () => void;
    const secondAnswered = new Promise<void>(resolve => (releaseSecond = resolve));
    const pinged: number[] = [];
    const sendMessage = vi.fn(async (tabId: number) => {
      pinged.push(tabId);
      if (tabId === 1) return { ready: true, message: 'Activa sin vigencia.' };
      if (tabId === 2) {
        await secondAnswered;
        return { ready: true, message: 'Segunda (lenta).', remainingSeconds: 600 };
      }
      // La tercera responde antes que la segunda; con sondeo paralelo ya fue pingueada
      // mientras la segunda sigue pendiente.
      expect(pinged).toEqual([1, 2, 3]);
      releaseSecond();
      return { ready: true, message: 'Tercera (rápida).', remainingSeconds: 300 };
    });
    await expect(
      health.probeTabs({
        tabs: [
          { id: 1, active: true },
          { id: 2, lastAccessed: 20 },
          { id: 3, lastAccessed: 10 },
        ],
        sendMessage,
        missingMessage: 'No abierta.',
        staleMessage: 'Recarga.',
        preferExpiryPublisher: true,
      })
    ).resolves.toEqual({ status: 'ready', message: 'Segunda (lenta).', remainingSeconds: 600 });
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });
});
