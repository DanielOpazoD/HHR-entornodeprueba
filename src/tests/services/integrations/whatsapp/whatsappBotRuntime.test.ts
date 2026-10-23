import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveCurrentUserAuthHeadersMock = vi.fn();

vi.mock('@/services/auth/authRequestHeaders', () => ({
  resolveCurrentUserAuthHeaders: () => resolveCurrentUserAuthHeadersMock(),
}));

import { buildBotUrl, fetchBotJson } from '@/services/integrations/whatsapp/whatsappBotRuntime';

describe('whatsappBotRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCurrentUserAuthHeadersMock.mockResolvedValue({
      Authorization: 'Bearer firebase-token-123',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response));
  });

  it('injects bearer auth headers into proxy requests', async () => {
    await fetchBotJson('/groups', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    expect(resolveCurrentUserAuthHeadersMock).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/groups'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers),
      })
    );

    const [, init] = vi.mocked(fetch).mock.calls[0] || [];
    const headers = init?.headers as Headers;
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer firebase-token-123');
  });

  it('preserves an explicit authorization header when one is already present', async () => {
    await fetchBotJson('/groups', {
      method: 'GET',
      headers: { Authorization: 'Bearer explicit-token' },
    });

    const [, init] = vi.mocked(fetch).mock.calls[0] || [];
    const headers = init?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer explicit-token');
  });
});

describe('buildBotUrl', () => {
  it('normalizes paths with leading slash', () => {
    const url = buildBotUrl('/health');
    expect(url).toMatch(/\/health$/);
  });

  it('adds a leading slash when path lacks one', () => {
    const url = buildBotUrl('groups');
    expect(url).toMatch(/\/groups$/);
  });
});
