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
  classifyObservedRequestOrigin,
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

  describe('external request observation mode', () => {
    it('classifies request URLs to origins only and ignores data:, blob:, and about:', () => {
      expect(
        classifyObservedRequestOrigin('data:image/gif;base64,R0lGODlhAQABAAAAACw=')
      ).toBeNull();
      expect(classifyObservedRequestOrigin('blob:https://hhr.netlify.app/1234-5678')).toBeNull();
      expect(classifyObservedRequestOrigin('about:blank')).toBeNull();
      expect(
        classifyObservedRequestOrigin(
          'https://user:secret@firebasestorage.googleapis.com/v0/b/hhr/o/11.111.111-1%2Fphoto.jpg?alt=media&token=secret-token#hash'
        )
      ).toBe('https://firebasestorage.googleapis.com');
      expect(classifyObservedRequestOrigin('file:///etc/passwd')).toBe('file://(opaque)');
      expect(classifyObservedRequestOrigin('not-a-valid-url')).toBe('(unparseable)');
    });

    it('logs aggregated external origins without credentials, paths, or tokens and detaches listener', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const events: string[] = [];
      let requestListener:
        | ((req: { url: () => string; resourceType: () => string }) => void)
        | null = null;

      const page = {
        on: vi.fn(
          (
            event: string,
            listener: (req: { url: () => string; resourceType: () => string }) => void
          ) => {
            events.push(`on:${event}`);
            if (event === 'request') requestListener = listener;
          }
        ),
        off: vi.fn((event: string) => {
          events.push(`off:${event}`);
          if (event === 'request') requestListener = null;
        }),
        setJavaScriptEnabled: vi.fn(async () => {
          events.push('setJavaScriptEnabled:false');
        }),
        setContent: vi.fn(async () => {
          events.push('setContent');
          requestListener?.({ url: () => 'about:blank', resourceType: () => 'document' });
          requestListener?.({
            url: () => 'data:image/png;base64,AAAA',
            resourceType: () => 'image',
          });
          requestListener?.({
            url: () => 'blob:https://app.hhr.cl/uuid-1',
            resourceType: () => 'image',
          });
          requestListener?.({
            url: () => 'https://app.hhr.cl/assets/index.css?v=1',
            resourceType: () => 'stylesheet',
          });
          requestListener?.({
            url: () =>
              'https://user:pass@firebasestorage.googleapis.com/v0/b/hhr/o/patients%2F12.345.678-9%2Fimg.jpg?token=tok-secret',
            resourceType: () => 'image',
          });
          requestListener?.({
            url: () => 'https://app.hhr.cl/assets/inter.woff2',
            resourceType: () => 'font',
          });
          requestListener?.({
            url: () => 'https://app.hhr.cl/assets/outfit.woff2',
            resourceType: () => 'font',
          });
          // Malformed / throwing request must never break rendering.
          requestListener?.({
            url: () => {
              throw new Error('broken request');
            },
            resourceType: () => 'other',
          });
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
      const chromium = { executablePath: vi.fn(async () => '/usr/bin/chromium'), args: [] };
      const puppeteer = {
        defaultArgs: vi.fn(async () => []),
        launch: vi.fn(async () => browser),
      };

      try {
        const buffer = await renderPdfFromHtml('<html><body>Doc</body></html>', () => ({
          chromium,
          puppeteer,
        }));
        expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
        expect(events).toEqual([
          'setJavaScriptEnabled:false',
          'on:request',
          'setContent',
          'pdf',
          'off:request',
          'close',
        ]);
        expect(infoSpy).toHaveBeenCalledTimes(1);
        expect(infoSpy).toHaveBeenCalledWith(
          '[clinical-pdf-render] observed external page requests',
          {
            totalCount: 4,
            truncated: false,
            requests: [
              { origin: 'https://app.hhr.cl', resourceType: 'stylesheet', count: 1 },
              { origin: 'https://firebasestorage.googleapis.com', resourceType: 'image', count: 1 },
              { origin: 'https://app.hhr.cl', resourceType: 'font', count: 2 },
            ],
          }
        );
        const serializedLog = JSON.stringify(infoSpy.mock.calls);
        expect(serializedLog).not.toContain('tok-secret');
        expect(serializedLog).not.toContain('12.345.678-9');
        expect(serializedLog).not.toContain('user:pass');
      } finally {
        infoSpy.mockRestore();
      }
    });

    it('produces no log for self-contained renders and still logs observed origins when setContent fails', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      let requestListener:
        | ((req: { url: () => string; resourceType: () => string }) => void)
        | null = null;

      const makeEnv = (shouldFail: boolean) => {
        const page = {
          on: vi.fn(
            (
              _event: string,
              listener: (req: { url: () => string; resourceType: () => string }) => void
            ) => {
              requestListener = listener;
            }
          ),
          off: vi.fn(),
          setJavaScriptEnabled: vi.fn(async () => undefined),
          setContent: vi.fn(async () => {
            requestListener?.({ url: () => 'about:blank', resourceType: () => 'document' });
            requestListener?.({
              url: () => 'data:image/gif;base64,AA==',
              resourceType: () => 'image',
            });
            if (shouldFail) {
              requestListener?.({
                url: () => 'https://slow-cdn.example.invalid/style.css?secret=1',
                resourceType: () => 'stylesheet',
              });
              throw new Error('Navigation timeout');
            }
          }),
          pdf: vi.fn(async () => Uint8Array.from(Buffer.from('%PDF-1.4\n'))),
        };
        const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => undefined) };
        return () => ({
          chromium: { executablePath: vi.fn(async () => '/usr/bin/chromium'), args: [] },
          puppeteer: { defaultArgs: vi.fn(async () => []), launch: vi.fn(async () => browser) },
        });
      };

      try {
        await renderPdfFromHtml('<html><body>Inline</body></html>', makeEnv(false));
        expect(infoSpy).not.toHaveBeenCalled();

        await expect(
          renderPdfFromHtml('<html><body>Slow</body></html>', makeEnv(true))
        ).rejects.toThrow('Navigation timeout');
        expect(infoSpy).toHaveBeenCalledWith(
          '[clinical-pdf-render] observed external page requests',
          {
            totalCount: 1,
            truncated: false,
            requests: [
              { origin: 'https://slow-cdn.example.invalid', resourceType: 'stylesheet', count: 1 },
            ],
          }
        );
      } finally {
        infoSpy.mockRestore();
      }
    });
  });
});
