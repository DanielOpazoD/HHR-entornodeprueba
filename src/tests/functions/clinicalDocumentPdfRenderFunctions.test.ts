import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v1', () => ({
  runWith: () => ({
    https: {
      onCall: (handler: (data: unknown, context: unknown) => unknown) => ({ run: handler }),
    },
  }),
  https: {
    onCall: (handler: (data: unknown, context: unknown) => unknown) => ({ run: handler }),
    HttpsError: class HttpsError extends Error {
      code: string;

      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    },
  },
}));

const require = createRequire(import.meta.url);
const {
  createClinicalDocumentPdfRenderFunctions,
  resolveChromiumDependency,
} = require('../../../functions/lib/clinicalDocumentPdfRenderFunctions.js');

describe('functions clinicalDocumentPdfRenderFunctions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves both current default and legacy direct Chromium module shapes', () => {
    const currentChromium = { executablePath: vi.fn() };
    const legacyChromium = { executablePath: vi.fn() };

    expect(resolveChromiumDependency({ default: currentChromium })).toBe(currentChromium);
    expect(resolveChromiumDependency(legacyChromium)).toBe(legacyChromium);
  });

  it('rejects unauthenticated calls', async () => {
    const functionsApi = createClinicalDocumentPdfRenderFunctions({
      resolveRoleForEmail: vi.fn(),
    });

    await expect(
      functionsApi.renderClinicalDocumentPdfFromHtml.run({}, { auth: null })
    ).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('rejects role without render permission', async () => {
    const functionsApi = createClinicalDocumentPdfRenderFunctions({
      resolveRoleForEmail: vi.fn().mockResolvedValue('viewer'),
    });

    await expect(
      functionsApi.renderClinicalDocumentPdfFromHtml.run(
        { html: '<html><body>Hola</body></html>' },
        { auth: { uid: 'u1', token: { email: 'viewer@hospitalhangaroa.cl' } } }
      )
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('ignores stale token claims when render access has been revoked', async () => {
    const resolveRoleForEmail = vi.fn().mockResolvedValue('unauthorized');
    const functionsApi = createClinicalDocumentPdfRenderFunctions({
      resolveRoleForEmail,
    });

    await expect(
      functionsApi.renderClinicalDocumentPdfFromHtml.run(
        { html: '<html><body>Hola</body></html>' },
        {
          auth: {
            uid: 'u1',
            token: {
              email: 'removed@hospitalhangaroa.cl',
              role: 'doctor_urgency',
            },
          },
        }
      )
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });

    expect(resolveRoleForEmail).toHaveBeenCalledWith('removed@hospitalhangaroa.cl');
  });

  it('renders pdf for authorized doctor role', async () => {
    const renderOverride = vi.fn().mockResolvedValue(Buffer.from('fake-pdf-content'));
    const functionsApi = createClinicalDocumentPdfRenderFunctions({
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_urgency'),
      renderPdfFromHtmlOverride: renderOverride,
    });

    const response = await functionsApi.renderClinicalDocumentPdfFromHtml.run(
      {
        html: '<!doctype html><html><body><div class="clinical-document-sheet">Epicrisis</div></body></html>',
      },
      { auth: { uid: 'u1', token: { email: 'doctor@hospitalhangaroa.cl' } } }
    );

    expect(response.mimeType).toBe('application/pdf');
    expect(typeof response.contentBase64).toBe('string');
    expect(response.contentBase64.length).toBeGreaterThan(0);
    expect(renderOverride).toHaveBeenCalled();
  });
});
