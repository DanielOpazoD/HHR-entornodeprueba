/**
 * Tests: Búsqueda IA CIE-10 (cie10AISearch)
 *
 * FLUJO DE FALLBACK:
 * ┌──────────────────────────────────────────────────────────┐
 * │ 1. Intenta endpoint serverless (Netlify Functions)      │
 * │    POST /.netlify/functions/cie10-ai-search              │
 * │    → Si responde available:true → usa esos resultados   │
 * │                                                          │
 * │ 2. Si serverless NO disponible (404 en local dev):      │
 * │    → Fallback directo a Gemini API con key local        │
 * │    → Usa VITE_LOCAL_GEMINI_API_KEY de .env.local        │
 * │    → Modelo: gemini-3-flash-preview                     │
 * │                                                          │
 * │ 3. Si ninguno funciona → retorna []                     │
 * └──────────────────────────────────────────────────────────┘
 *
 * FUNCIONES EXPORTADAS:
 *  - searchCIE10WithAI(query, signal?) → CIE10Entry[]
 *  - checkAIAvailability() → boolean
 *  - isAIAvailable() → boolean (sync, cached)
 *
 * SEGURIDAD:
 *  - En producción: SOLO usa endpoint serverless (key nunca en frontend)
 *  - En desarrollo: fallback directo a Gemini con key local en .env.local
 *  - API key NUNCA se commitea a Git (.env.local está en .gitignore)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
let aiRequestManager: typeof import('@/services/ai/aiRequestManager').aiRequestManager;
let cie10Module: typeof import('@/services/terminology/cie10AISearch');

// Mock AI Request Manager — simula el rate limiter
vi.mock('@/services/ai/aiRequestManager', () => ({
  aiRequestManager: {
    enqueue: vi.fn((_id, fn, signal) => fn(signal)),
  },
}));

vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: vi.fn().mockResolvedValue({
    Authorization: 'Bearer token-123',
  }),
}));

// Mock fetch — simula el endpoint serverless de Netlify
const mockFetch = vi.fn<typeof fetch>();

// Mock @google/genai — simula respuesta de Gemini API
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify([{ code: 'A00', description: 'Cólera', category: 'Infecciosas' }]),
        }),
      };
      constructor(_config: { apiKey: string }) {}
    },
  };
});

describe('Búsqueda IA CIE-10 (cie10AISearch)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    ({ aiRequestManager } = await import('@/services/ai/aiRequestManager'));
    cie10Module = await import('@/services/terminology/cie10AISearch');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // ── Validaciones de entrada ──
  describe('Validaciones de entrada', () => {
    it('retorna [] si la consulta tiene menos de 2 caracteres', async () => {
      const result = await cie10Module.searchCIE10WithAI('a');
      expect(result).toEqual([]);
      expect(aiRequestManager.enqueue).not.toHaveBeenCalled();
    });
  });

  // ── checkAIAvailability: verificación de disponibilidad ──
  describe('checkAIAvailability() — Verificar si IA está disponible', () => {
    it('retorna true si el endpoint serverless responde available:true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ available: true }),
      } as Response);

      const available = await cie10Module.checkAIAvailability();
      expect(available).toBe(true);
    });
  });

  describe('availability recovery', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
      vi.stubEnv('DEV', false);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const response = (available: boolean) =>
      ({ ok: true, json: async () => ({ available }) }) as Response;

    it('shares one in-flight probe across concurrent callers', async () => {
      let finish!: (value: Response) => void;
      const pending = new Promise<Response>(resolve => {
        finish = resolve;
      });
      mockFetch.mockReturnValue(pending);
      const first = cie10Module.checkAIAvailability();
      const second = cie10Module.checkAIAvailability();
      await vi.advanceTimersByTimeAsync(0);
      finish(response(true));
      await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it.each(['network', 'unconfigured'])(
      'recovers after a %s result without a page reload',
      async failure => {
        if (failure === 'network') mockFetch.mockRejectedValueOnce(new Error('offline'));
        else mockFetch.mockResolvedValueOnce(response(false));
        await expect(cie10Module.checkAIAvailability()).resolves.toBe(false);
        await expect(cie10Module.checkAIAvailability()).resolves.toBe(false);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(30_000);
        mockFetch.mockResolvedValueOnce(response(true));
        await expect(cie10Module.checkAIAvailability()).resolves.toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      }
    );

    it('rechecks a successful probe after its bounded cache expires', async () => {
      mockFetch.mockResolvedValueOnce(response(true));
      await expect(cie10Module.checkAIAvailability()).resolves.toBe(true);
      await vi.advanceTimersByTimeAsync(59_999);
      await expect(cie10Module.checkAIAvailability()).resolves.toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      mockFetch.mockResolvedValueOnce(response(false));
      await expect(cie10Module.checkAIAvailability()).resolves.toBe(false);
    });

    it('releases a stalled probe at the deadline and permits a later retry', async () => {
      mockFetch.mockReturnValueOnce(new Promise<Response>(() => {}));
      const pending = cie10Module.checkAIAvailability();
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toBe(false);
      const signal = mockFetch.mock.calls[0][1]?.signal;
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(30_000);
      mockFetch.mockResolvedValueOnce(response(true));
      await expect(cie10Module.checkAIAvailability()).resolves.toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not let an older probe overwrite a newer successful search', async () => {
      let finish!: (value: Response) => void;
      mockFetch.mockReturnValueOnce(
        new Promise<Response>(resolve => {
          finish = resolve;
        })
      );
      const probe = cie10Module.checkAIAvailability();
      await vi.advanceTimersByTimeAsync(0);
      mockFetch.mockResolvedValueOnce(response(true));
      await cie10Module.searchCIE10WithAI('synthetic');
      finish(response(false));
      await expect(probe).resolves.toBe(true);
      expect(cie10Module.isAIAvailable()).toBe(true);
    });
  });

  // ── searchCIE10WithAI: búsqueda principal ──
  describe('searchCIE10WithAI() — Búsqueda con cadena de fallback', () => {
    it('usa resultados de serverless si está disponible', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          available: true,
          results: [{ code: 'B01', description: 'Varicela' }],
        }),
      } as Response);

      const controller = new AbortController();
      const results = await cie10Module.searchCIE10WithAI('varicela', controller.signal);
      expect(aiRequestManager.enqueue).toHaveBeenCalledExactlyOnceWith(
        'cie10-varicela',
        expect.any(Function),
        controller.signal
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal })
      );

      expect(results).toEqual([{ code: 'B01', description: 'Varicela' }]);
    });

    it('ignora payloads malformados del serverless y cae a no disponible', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          available: 'si',
          results: 'invalidos',
        }),
      } as Response);

      vi.stubEnv('VITE_LOCAL_GEMINI_API_KEY', '');
      const results = await cie10Module.searchCIE10WithAI('varicela');
      vi.unstubAllEnvs();

      expect(results).toEqual([]);
    });

    it('retorna [] si serverless no disponible Y no hay API key local', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ available: false }),
      } as Response);

      vi.stubEnv('VITE_LOCAL_GEMINI_API_KEY', '');

      const results = await cie10Module.searchCIE10WithAI('query-sin-key');
      vi.unstubAllEnvs();

      expect(results).toEqual([]);
    });

    it('usa fallback local (Gemini directo) cuando serverless no disponible Y hay API key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ available: false }),
      } as Response);

      vi.stubEnv('VITE_LOCAL_GEMINI_API_KEY', 'test-local-key');
      const results = await cie10Module.searchCIE10WithAI('colera');
      vi.unstubAllEnvs();

      // Usa el mock de GoogleGenAI que retorna cólera
      expect(results).toEqual([{ code: 'A00', description: 'Cólera', category: 'Infecciosas' }]);
    });
  });
  it('propaga la cancelación del transporte sin devolver resultados ni activar fallback', async () => {
    const controller = new AbortController();
    mockFetch.mockImplementationOnce(async () => {
      controller.abort();
      throw controller.signal.reason;
    });
    await expect(
      cie10Module.searchCIE10WithAI('synthetic', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
