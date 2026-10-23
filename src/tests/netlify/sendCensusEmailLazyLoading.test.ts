import { afterEach, expect, it, vi } from 'vitest';
import type { NetlifyEventLike } from '../../../netlify/functions/lib/http';

const mocks = vi.hoisted(() => {
  vi.resetModules();
  return {
    workbookInitialized: vi.fn(),
    encryptionInitialized: vi.fn(),
    buildBuffer: vi.fn(),
    validateBuffer: vi.fn(),
    validateFilename: vi.fn(),
    authorize: vi.fn(),
    fromData: vi.fn(),
    output: vi.fn(),
    send: vi.fn(),
  };
});

vi.mock('@/services/security/passwordGenerator', () => ({
  generateCensusPassword: () => 'PIN-123',
}));
vi.mock('@/services/email/gmailClient', () => ({ sendCensusEmail: mocks.send }));
vi.mock('@/services/exporters/censusMasterWorkbook', () => {
  mocks.workbookInitialized();
  return {
    buildCensusMasterBuffer: mocks.buildBuffer,
    getCensusMasterFilename: () => 'censo-2026-03-24.xlsx',
  };
});
vi.mock('@/services/exporters/excelValidation', () => ({
  validateExcelBuffer: mocks.validateBuffer,
  validateExcelFilename: mocks.validateFilename,
  MIN_EXCEL_SIZE: 10,
}));
vi.mock('xlsx-populate', () => {
  mocks.encryptionInitialized();
  return { default: { fromDataAsync: mocks.fromData } };
});
vi.mock('../../../netlify/functions/lib/firebase-server', () => ({
  getFirebaseServer: () => ({ db: {} }),
}));
vi.mock('../../../netlify/functions/lib/firebase-auth', () => ({
  authorizeRoleRequest: mocks.authorize,
  extractBearerToken: (authorization?: string) => {
    if (!authorization) throw new Error('Missing Authorization bearer token.');
    return 'token-123';
  },
}));

afterEach(() => vi.unstubAllEnvs());

it('initializes workbook and encryption modules only after their validation gates', async () => {
  for (const [name, value] of Object.entries({
    URL: 'https://app.example.com',
    DEPLOY_PRIME_URL: '',
    DEPLOY_URL: '',
    SITE_URL: '',
    APP_URL: '',
  })) {
    vi.stubEnv(name, value);
  }
  const rawBuffer = Buffer.from('raw workbook');
  const encryptedBuffer = Buffer.from('encrypted workbook payload');
  mocks.buildBuffer.mockResolvedValue(rawBuffer);
  mocks.validateBuffer.mockReturnValue({ valid: true });
  mocks.validateFilename.mockReturnValue({ valid: true });
  mocks.authorize.mockResolvedValue({ role: 'admin' });
  mocks.fromData.mockResolvedValue({ outputAsync: mocks.output });
  mocks.output.mockResolvedValue(encryptedBuffer);
  mocks.send.mockResolvedValue({ id: 'gmail-123' });

  let requestNumber = 0;
  const payload = { date: '2026-03-24', records: [{ date: '2026-03-24', beds: {} }] };
  const request = (overrides: Partial<NetlifyEventLike> = {}): NetlifyEventLike => ({
    httpMethod: 'POST',
    headers: {
      origin: 'https://app.example.com',
      authorization: 'Bearer token-123',
      'x-nf-client-connection-ip': `192.0.2.${++requestNumber}`,
    },
    body: JSON.stringify(payload),
    ...overrides,
  });
  const { handler } = await import('../../../netlify/functions/send-census-email');
  expect(mocks.workbookInitialized).not.toHaveBeenCalled();
  expect(mocks.encryptionInitialized).not.toHaveBeenCalled();

  mocks.authorize.mockRejectedValueOnce(new Error("Access denied for role 'viewer'."));
  expect((await handler(request())).statusCode).toBe(403);

  const rejectedRequests = [
    { event: request({ httpMethod: 'OPTIONS' }), status: 200 },
    { event: request({ httpMethod: 'GET' }), status: 405 },
    { event: request({ headers: { origin: 'https://evil.example.com' } }), status: 403 },
    { event: request({ headers: { origin: 'https://app.example.com' } }), status: 401 },
    { event: request({ body: '{' }), status: 400 },
    { event: request({ body: JSON.stringify({ ...payload, records: [{}] }) }), status: 400 },
    {
      event: request({ body: JSON.stringify({ ...payload, shareLink: 'https://legacy.example' }) }),
      status: 400,
    },
    { event: request({ body: JSON.stringify({ ...payload, date: '' }) }), status: 400 },
    { event: request({ body: JSON.stringify({ ...payload, records: [] }) }), status: 400 },
    {
      event: request({ body: JSON.stringify({ ...payload, records: [{ date: '', beds: {} }] }) }),
      status: 400,
    },
  ];
  for (const { event, status } of rejectedRequests) {
    expect((await handler(event)).statusCode).toBe(status);
    expect(mocks.workbookInitialized).not.toHaveBeenCalled();
    expect(mocks.encryptionInitialized).not.toHaveBeenCalled();
  }

  const rateLimitedRequest = request({ body: '{' });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    expect((await handler(rateLimitedRequest)).statusCode).toBe(400);
  }
  expect((await handler({ ...rateLimitedRequest, body: JSON.stringify(payload) })).statusCode).toBe(
    429
  );
  expect(mocks.workbookInitialized).not.toHaveBeenCalled();
  expect(mocks.encryptionInitialized).not.toHaveBeenCalled();

  mocks.validateBuffer.mockReturnValueOnce({ valid: false, error: 'invalid workbook' });
  expect((await handler(request())).statusCode).toBe(500);
  expect(mocks.workbookInitialized).toHaveBeenCalledOnce();
  expect(mocks.encryptionInitialized).not.toHaveBeenCalled();

  mocks.validateFilename.mockReturnValueOnce({ valid: false, error: 'invalid filename' });
  expect((await handler(request())).statusCode).toBe(500);
  expect(mocks.encryptionInitialized).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();

  expect((await handler(request())).statusCode).toBe(200);
  expect(mocks.workbookInitialized).toHaveBeenCalledOnce();
  expect(mocks.encryptionInitialized).toHaveBeenCalledOnce();
  expect(mocks.fromData).toHaveBeenCalledWith(rawBuffer);
  expect(mocks.output).toHaveBeenCalledWith({ password: 'PIN-123' });
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({ attachmentBuffer: encryptedBuffer, encryptionPin: 'PIN-123' })
  );

  mocks.output.mockResolvedValueOnce(Buffer.from('tiny'));
  expect((await handler(request())).statusCode).toBe(500);
  expect(mocks.send).toHaveBeenCalledOnce();
});
