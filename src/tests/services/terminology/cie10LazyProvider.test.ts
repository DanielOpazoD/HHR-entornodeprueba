import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/ai/aiRequestManager', () => ({
  aiRequestManager: { enqueue: vi.fn((_id, recipe, signal) => recipe(signal)) },
}));
vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: vi.fn().mockResolvedValue({}),
}));

const fetchMock = vi.fn<typeof fetch>();
const loadSDK = vi.fn();
const generateContent = vi.fn();
const provider = () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
});
const serverlessResponse = (available: boolean) =>
  ({ ok: true, json: async () => ({ available, results: [] }) }) as Response;

describe('CIE-10 local provider loading', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    fetchMock.mockReset();
    generateContent.mockReset().mockResolvedValue({
      text: JSON.stringify([{ code: 'Z00', description: 'Synthetic result' }]),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_LOCAL_AI_PROVIDER', 'gemini');
    vi.stubEnv('VITE_LOCAL_GEMINI_API_KEY', 'test-local-key');
    vi.doMock('@google/genai', () => {
      loadSDK();
      return provider();
    });
  });

  afterEach(() => {
    vi.doUnmock('@google/genai');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('loads Gemini only when the development fallback is actually needed', async () => {
    const { searchCIE10WithAI } = await import('@/services/terminology/cie10AISearch');
    expect(loadSDK).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(serverlessResponse(true));
    await searchCIE10WithAI('synthetic');
    expect(loadSDK).not.toHaveBeenCalled();

    vi.stubEnv('DEV', false);
    fetchMock.mockResolvedValueOnce(serverlessResponse(false));
    await expect(searchCIE10WithAI('synthetic')).resolves.toEqual([]);
    const { callLocalAI } = await import('@/services/ai/aiProviderConfig');
    await expect(callLocalAI('synthetic')).resolves.toBe('');
    expect(loadSDK).not.toHaveBeenCalled();

    vi.stubEnv('DEV', true);
    fetchMock.mockResolvedValueOnce(serverlessResponse(false));
    const controller = new AbortController();
    await expect(searchCIE10WithAI('synthetic', controller.signal)).resolves.toEqual([
      { code: 'Z00', description: 'Synthetic result', category: 'IA' },
    ]);
    expect(loadSDK).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ config: { abortSignal: controller.signal } })
    );
  });

  it('does not call the provider when canceled while its module is loading', async () => {
    let finishLoading!: () => void;
    let markLoading!: () => void;
    const loading = new Promise<void>(resolve => {
      markLoading = resolve;
    });
    const blocked = new Promise<void>(resolve => {
      finishLoading = resolve;
    });
    vi.doMock('@google/genai', async () => {
      markLoading();
      await blocked;
      return provider();
    });
    const { searchCIE10WithAI } = await import('@/services/terminology/cie10AISearch');
    fetchMock.mockResolvedValueOnce(serverlessResponse(false));
    const controller = new AbortController();
    const request = expect(searchCIE10WithAI('synthetic', controller.signal)).rejects.toMatchObject(
      {
        name: 'AbortError',
      }
    );
    await loading;
    controller.abort();
    finishLoading();
    await request;
    expect(generateContent).not.toHaveBeenCalled();
  });
});
