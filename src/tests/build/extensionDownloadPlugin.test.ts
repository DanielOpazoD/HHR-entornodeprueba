// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { packageRayenExtension } from '../../../scripts/config/extensionDownloadPlugin';

describe('extension distribution artifact', () => {
  it('packages the complete runtime with a root manifest and deterministic versioned URL', () => {
    const artifact = packageRayenExtension(process.cwd());
    const entries = unzipSync(artifact.zip);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest.version).toBe(artifact.version);
    expect(artifact.fileName).toMatch(
      new RegExp(`^downloads/eloisa-extension-${artifact.version}-[a-f0-9]{12}\\.zip$`)
    );
    expect(
      Buffer.from(packageRayenExtension(process.cwd()).zip).equals(Buffer.from(artifact.zip))
    ).toBe(true);
    for (const file of fs.readdirSync(path.join(process.cwd(), 'extension'), { recursive: true })) {
      const name = String(file).split(path.sep).join('/');
      if (
        fs.statSync(path.join(process.cwd(), 'extension', name)).isFile() &&
        name !== 'README.md'
      ) {
        expect(entries[name], name).toBeDefined();
        expect(
          Buffer.from(entries[name]).equals(
            fs.readFileSync(path.join(process.cwd(), 'extension', name))
          ),
          name
        ).toBe(true);
      }
    }
  });

  it('excludes unrelated files and rejects missing or escaping declared resources', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-extension-package-'));
    const extension = path.join(root, 'extension');
    fs.mkdirSync(extension);
    const writeManifest = (resources: string[]) =>
      fs.writeFileSync(
        path.join(extension, 'manifest.json'),
        JSON.stringify({ version: '1.0.0', web_accessible_resources: [{ resources }] })
      );
    try {
      fs.writeFileSync(path.join(extension, 'vendor-lock.json'), '{}');
      fs.writeFileSync(path.join(extension, '.env'), 'PRIVATE');
      fs.writeFileSync(path.join(extension, 'capture.har'), 'PRIVATE');
      fs.writeFileSync(path.join(extension, 'notes.pdf'), 'PRIVATE');
      writeManifest([]);
      expect(Object.keys(unzipSync(packageRayenExtension(root).zip))).toEqual([
        'manifest.json',
        'vendor-lock.json',
      ]);
      writeManifest(['missing.js']);
      expect(() => packageRayenExtension(root)).toThrow();
      writeManifest(['../outside.js']);
      expect(() => packageRayenExtension(root)).toThrow(/Unsafe/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
