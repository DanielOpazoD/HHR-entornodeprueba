import { afterEach, beforeEach, vi } from 'vitest';
import { suppressProcessStdout, type RestorableSpy } from '@/tests/utils/consoleTestUtils';

/** Every suite owns fresh mocks and restores its environment; no shared mutable test state. */
export const createSyslabProxyHarness = () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();
  const getFirebaseServerMock = vi.fn();
  const authorizeRoleRequestMock = vi.fn();
  const extractBearerTokenMock = vi.fn();
  let stdoutSpy: RestorableSpy;
  const loadHandler = async () => {
    const { createSyslabProxyHandler } = await import('../../../../netlify/functions/syslab-proxy');
    return createSyslabProxyHandler({
      getFirebaseServer: getFirebaseServerMock as typeof getFirebaseServerMock,
      authorizeRoleRequest: authorizeRoleRequestMock as typeof authorizeRoleRequestMock,
      extractBearerToken: extractBearerTokenMock as typeof extractBearerTokenMock,
    });
  };
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      SYSLAB_PROXY_URL: 'https://lab.example.com',
      SYSLAB_API_TOKEN: 'gateway-token',
      URL: 'https://app.example.com',
      DEPLOY_PRIME_URL: '',
      DEPLOY_URL: '',
      SITE_URL: '',
      APP_URL: '',
    };
    vi.stubGlobal('fetch', fetchMock);
    getFirebaseServerMock.mockReturnValue({ db: { kind: 'firestore' } });
    authorizeRoleRequestMock.mockResolvedValue({
      email: 'doctor@hospital.cl',
      role: 'doctor_urgency',
    });
    extractBearerTokenMock.mockReturnValue('token-123');
    stdoutSpy = suppressProcessStdout();
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });
  return {
    fetchMock,
    getFirebaseServerMock,
    authorizeRoleRequestMock,
    extractBearerTokenMock,
    loadHandler,
  };
};
