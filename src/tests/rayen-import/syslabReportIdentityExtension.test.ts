// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TextDecoder, TextEncoder } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import '../../../extension/lab-result-parser.js';
import '../../../extension/lab-viewer.js';

const source = readFileSync('extension/syslab-bridge.js', 'utf8');
const readReport = async (input: string | string[]) => {
  const pages = Array.isArray(input) ? input : [input];
  let listener: (message: unknown, sender: unknown, reply: (value: unknown) => void) => void;
  const context: Record<string, unknown> = {
    HhrLabViewer: (globalThis as typeof globalThis & { HhrLabViewer: unknown }).HhrLabViewer,
    document,
    DOMParser,
    location: { href: 'http://10.4.69.90/syslab/' },
    URL,
    TextDecoder,
    Uint8Array,
    AbortController,
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    chrome: {
      runtime: {
        getURL: () => 'chrome-extension://test/',
        onMessage: {
          addListener: (callback: typeof listener) => {
            listener = callback;
          },
        },
      },
    },
    fetch: vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      url: 'http://10.4.69.90/syslab/detalleexamenes.php?id=123',
      headers: { get: (key: string) => (key === 'content-type' ? 'text/html' : null) },
      arrayBuffer: async () =>
        new TextEncoder().encode(pages[Number(new URL(url).searchParams.get('id')) - 123]).buffer,
    })),
  };
  context.window = context;
  context.self = context;
  context.parent = context;
  vm.runInNewContext(source, context);
  return new Promise<{ ok?: boolean; error?: string; details?: unknown[] }>(resolve => {
    listener(
      {
        type: 'RAYEN_SYSLAB_READ_DETAILS',
        rutBody: '11111111',
        exams: pages.map((_, index) => ({
          id: String(123 + index),
          date: '22/10/2026',
          link: `http://10.4.69.90/syslab/detalleexamenes.php?id=${123 + index}`,
        })),
      },
      {},
      value => resolve(value as Awaited<ReturnType<typeof readReport>>)
    );
  });
};

describe('Syslab report identity diagnostics through the real bridge', () => {
  it('identifies the order/date and does not accuse a mismatch when the header is absent', async () => {
    const result = await readReport('<p>Informe pendiente</p>');
    expect(result.error).toContain('Informe #123 · 22/10/2026');
    expect(result.error).toContain('No se pudo verificar el RUN');
    expect(result.error).not.toContain('es distinto');
    expect(result.details).toBeUndefined();
  });
  it.each(['exámenes', 'ex�menes'])(
    'omits an explicitly pending order without an error (%s)',
    async word => {
      const result = await readReport(`<script>alert('No hay ${word} validados');</script>`);
      expect(result.error).toBeUndefined();
      expect(result.details).toEqual([{ examId: '123', status: 'no_validated_results' }]);
    }
  );
  it('keeps valid reports in a mixed batch and never suppresses an identity failure', async () => {
    const pending = '<script>alert("No hay exámenes validados");</script>';
    const valid = '<p>Rut/Fic: 11.111.111-1</p><p>Potasio: 4 mmol/L</p>';
    const result = await readReport([pending, valid]);
    expect(result.ok).toBe(true);
    expect(result.details).toEqual([
      { examId: '123', status: 'no_validated_results' },
      expect.objectContaining({ examId: '124', rutBody: '11111111' }),
    ]);
    const mismatch = await readReport([pending, valid.replace('11.111.111-1', '22.222.222-2')]);
    expect(mismatch.error).toContain('Informe #124');
    expect(mismatch.details).toBeUndefined();
    const embedded = await readReport(pending + valid.replace('11.111.111-1', '22.222.222-2'));
    expect(embedded.error).toContain('El RUN leído');
  });
  it('blocks an actual mismatch without disclosing the other patient identifier', async () => {
    const result = await readReport('<p>Rut/Fic: 22.222.222-2</p><p>Potasio: 4 mmol/L</p>');
    expect(result.error).toContain('El RUN leído en el informe es distinto');
    expect(result.error).not.toContain('22222222');
    expect(result.details).toBeUndefined();
  });
  it('keeps complete matching reports usable and removes unit column artifacts', async () => {
    const result = await readReport(
      '<p>Rut/Fic: 11.111.111-1</p><p>Potasio: 3,6 mmol/L | 3,5 - 5,0</p>'
    );
    expect(result.ok).toBe(true);
    expect(result.details).toEqual([
      expect.objectContaining({
        examId: '123',
        rutBody: '11111111',
        findings: [expect.objectContaining({ unit: 'mmol/L' })],
      }),
    ]);
  });
  it('does not accept the first matching header of a mixed-patient document', async () => {
    const result = await readReport('<p>Rut/Fic: 11.111.111-1</p><p>Rut/Fic: 22.222.222-2</p>');
    expect(result.error).toContain('No se pudo verificar el RUN');
    expect(result.details).toBeUndefined();
  });
  it('distinguishes an expired session from patient identity errors', async () => {
    const result = await readReport('<form><input type="password"></form>');
    expect(result.error).toContain('Informe #123');
    expect(result.error).toContain('La sesión de Syslab venció');
    expect(result.details).toBeUndefined();
  });
});
