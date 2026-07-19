import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const checkerPath = path.join(repositoryRoot, 'scripts/check-rayen-extension-release.mjs');
const temporaryRoots: string[] = [];

const createPackageFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rayen-extension-release-'));
  temporaryRoots.push(root);
  fs.cpSync(path.join(repositoryRoot, 'extension'), path.join(root, 'extension'), {
    recursive: true,
  });

  const bridgeDirectory = path.join(root, 'src/features/rayen-import/bridge');
  fs.mkdirSync(bridgeDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(bridgeDirectory, 'extensionHealthBridge.ts'),
    'export const RAYEN_EXTENSION_PROTOCOL_VERSION = 3;\n',
    'utf8'
  );
  return root;
};

const runChecker = (root: string) => spawnSync(process.execPath, [checkerPath], {
  cwd: root,
  encoding: 'utf8',
});

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Rayen extension release dependency graph', () => {
  it('accepts the complete packaged extension', () => {
    const result = runChecker(createPackageFixture());

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('dependencias verificadas');
  });

  it('rejects a Chrome minimum below the supported PDF.js legacy baseline', () => {
    const root = createPackageFixture();
    const manifestPath = path.join(root, 'extension/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.minimum_chrome_version = '111';
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('minimum_chrome_version 118 para el contrato legacy de PDF.js');
  });

  it('rejects PDF.js vendors without the reviewed legacy provenance', () => {
    const root = createPackageFixture();
    const lockPath = path.join(root, 'extension/vendor-lock.json');
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const pdfVendor = lock.vendors.find(
      (vendor: { file?: string }) => vendor.file === 'pdf.min.mjs'
    );
    pdfVendor.variant = 'modern';
    pdfVendor.source = 'pdfjs-dist/build/pdf.min.mjs';
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'extension/pdf.min.mjs debe provenir del build legacy de pdfjs-dist 5.6.205.'
    );
  });

  it('rejects a startup runtime that was renamed without updating importScripts', () => {
    const root = createPackageFixture();
    fs.renameSync(
      path.join(root, 'extension/clinical-handoff-runtime.js'),
      path.join(root, 'extension/clinical-handoff-runtime-renamed.js')
    );

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Falta la dependencia de background.js importScripts(): extension/clinical-handoff-runtime.js'
    );
  });

  it('rejects a missing script referenced by packaged HTML', () => {
    const root = createPackageFixture();
    fs.renameSync(
      path.join(root, 'extension/print-pdf.js'),
      path.join(root, 'extension/print-pdf-renamed.js')
    );

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Falta la dependencia de print-pdf.html <script src>: extension/print-pdf.js'
    );
  });

  it('rejects a duplicate path in the startup runtime list', () => {
    const root = createPackageFixture();
    const backgroundPath = path.join(root, 'extension/background.js');
    const background = fs.readFileSync(backgroundPath, 'utf8');
    fs.writeFileSync(
      backgroundPath,
      background.replace(
        "  'message-contract.js',",
        "  'message-contract.js',\n  'message-contract.js',"
      ),
      'utf8'
    );

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Referencia duplicada en background.js importScripts(): extension/message-contract.js'
    );
  });

  it('rejects an external script reference in packaged HTML', () => {
    const root = createPackageFixture();
    const htmlPath = path.join(root, 'extension/print-pdf.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    fs.writeFileSync(
      htmlPath,
      html.replace('src="print-pdf.js"', 'src="https://example.test/print-pdf.js"'),
      'utf8'
    );

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Referencia insegura o externa en print-pdf.html <script src>'
    );
  });

  it('rejects path traversal even when the target exists outside the extension', () => {
    const root = createPackageFixture();
    fs.writeFileSync(path.join(root, 'outside.js'), 'globalThis.outside = true;\n', 'utf8');
    const manifestPath = path.join(root, 'extension/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.content_scripts[0].js[0] = '../outside.js';
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Referencia insegura o externa en manifest.content_scripts[0].js: ../outside.js'
    );
  });

  it('does not treat an inline script as a packaged file reference', () => {
    const root = createPackageFixture();
    const htmlPath = path.join(root, 'extension/print-pdf.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    fs.writeFileSync(
      htmlPath,
      html.replace('</body>', '<script>globalThis.inlineFixture = true;</script>\n</body>'),
      'utf8'
    );

    const result = runChecker(root);

    expect(result.status, result.stderr).toBe(0);
  });

  it('parses script sources after a quoted greater-than sign', () => {
    const root = createPackageFixture();
    const htmlPath = path.join(root, 'extension/print-pdf.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    fs.writeFileSync(
      htmlPath,
      html.replace(
        '<script src="print-pdf.js"></script>',
        '<script data-note=">" src="missing-after-quote.js"></script>'
      ),
      'utf8'
    );

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Falta la dependencia de print-pdf.html <script src>: extension/missing-after-quote.js'
    );
  });

  it('ignores script-looking text inside HTML comments', () => {
    const root = createPackageFixture();
    const htmlPath = path.join(root, 'extension/print-pdf.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    fs.writeFileSync(
      htmlPath,
      html.replace('<body>', '<body>\n<!-- <script src="missing-comment.js"></script> -->'),
      'utf8'
    );

    const result = runChecker(root);

    expect(result.status, result.stderr).toBe(0);
  });

  it('does not accept a src-like decoy inside another quoted attribute', () => {
    const root = createPackageFixture();
    const htmlPath = path.join(root, 'extension/print-pdf.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    fs.writeFileSync(
      htmlPath,
      html.replace(
        '<script src="print-pdf.js"></script>',
        '<script data-note=" src=print-pdf.js" src="missing-real-src.js"></script>'
      ),
      'utf8'
    );

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Falta la dependencia de print-pdf.html <script src>: extension/missing-real-src.js'
    );
  });

  it('retains mandatory roots when an import edge and its target are removed together', () => {
    const root = createPackageFixture();
    const backgroundPath = path.join(root, 'extension/background.js');
    const background = fs.readFileSync(backgroundPath, 'utf8');
    fs.writeFileSync(
      backgroundPath,
      background.replace("  'runtime-loader.js',\n", ''),
      'utf8'
    );
    fs.rmSync(path.join(root, 'extension/runtime-loader.js'));

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'runtime-loader.js debe registrarse durante la evaluación inicial del service worker MV3.'
    );
  });

  it('fails closed when the service worker declares a second importScripts call', () => {
    const root = createPackageFixture();
    const backgroundPath = path.join(root, 'extension/background.js');
    const background = fs.readFileSync(backgroundPath, 'utf8');
    fs.writeFileSync(
      backgroundPath,
      background.replace(
        "  'runtime-loader.js',\n);",
        "  'runtime-loader.js',\n);\nimportScripts('missing-second-call.js');"
      ),
      'utf8'
    );

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'background.js debe registrar sus runtimes en una única llamada importScripts() inicial.'
    );
  });

  it('rejects base elements that can redirect local script resolution', () => {
    const root = createPackageFixture();
    const htmlPath = path.join(root, 'extension/print-pdf.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    fs.writeFileSync(
      htmlPath,
      html.replace('<head>', '<head>\n    <base href="https://example.test/assets/">'),
      'utf8'
    );

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No se permite <base> en extension/print-pdf.html');
  });
});
