// @vitest-environment node
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
  renderPdfFromHtml,
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

    expect(resolveRoleForEmail).toHaveBeenCalledWith('removed@hospitalhangaroa.cl', {
      auth: { uid: 'u1', token: { email: 'removed@hospitalhangaroa.cl', role: 'doctor_urgency' } },
    });
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

  it('disables JavaScript on the Chromium page before calling setContent and always closes the browser', async () => {
    const events: string[] = [];
    const page = {
      setJavaScriptEnabled: vi.fn(async (enabled: boolean) => {
        events.push(`setJavaScriptEnabled:${String(enabled)}`);
      }),
      setContent: vi.fn(async () => {
        events.push('setContent');
      }),
      pdf: vi.fn(async () => {
        events.push('pdf');
        return Uint8Array.from(Buffer.from('%PDF-1.4\nsynthetic'));
      }),
    };
    const browser = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => {
        events.push('close');
      }),
    };
    const chromium = {
      executablePath: vi.fn(async () => '/usr/bin/chromium'),
      args: ['--no-sandbox'],
    };
    const puppeteer = {
      defaultArgs: vi.fn(async ({ args }: { args: string[] }) => args),
      launch: vi.fn(async () => browser),
    };

    const buffer = await renderPdfFromHtml('<html><body>Epicrisis</body></html>', () => ({
      chromium,
      puppeteer,
    }));

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(page.setJavaScriptEnabled).toHaveBeenCalledWith(false);
    expect(events).toEqual(['setJavaScriptEnabled:false', 'setContent', 'pdf', 'close']);
  });

  it('closes the browser even if setContent fails after disabling JavaScript', async () => {
    const close = vi.fn(async () => undefined);
    const page = {
      setJavaScriptEnabled: vi.fn(async () => undefined),
      setContent: vi.fn(async () => {
        throw new Error('render failed');
      }),
      pdf: vi.fn(),
    };
    const browser = { newPage: vi.fn(async () => page), close };
    const chromium = { executablePath: vi.fn(async () => '/usr/bin/chromium'), args: [] };
    const puppeteer = {
      defaultArgs: vi.fn(async () => []),
      launch: vi.fn(async () => browser),
    };

    await expect(
      renderPdfFromHtml('<html><body>Broken</body></html>', () => ({ chromium, puppeteer }))
    ).rejects.toThrow('render failed');

    expect(page.setJavaScriptEnabled).toHaveBeenCalledWith(false);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
