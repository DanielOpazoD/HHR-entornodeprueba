// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { packageRayenExtension } from '../../../scripts/config/extensionDownloadPlugin';

describe('extension distribution artifact', () => {
  it('packages the complete runtime with a root manifest and versioned URL', () => {
    const artifact = packageRayenExtension(process.cwd());
    const entries = unzipSync(artifact.zip);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest.version).toBe(artifact.version);
    expect(manifest.version_name).toBe(`${artifact.version}+hhr1.${artifact.buildId}`);
    expect(artifact.buildId).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.fileName).toContain(artifact.buildId.slice(0, 12));
    expect(artifact.fileName).toMatch(
      new RegExp(`^downloads/eloisa-extension-${artifact.version}-[a-f0-9]{12}\\.zip$`)
    );
    for (const removed of [
      'hhr-handoff-center.js',
      'hhr-scores-center.js',
      'hhr-scores-presentation.js',
      'hhr-vitals-center.js',
      'hhr-vitals.js',
    ]) {
      expect(entries[removed], removed).toBeUndefined();
    }
    for (const file of fs.readdirSync(path.join(process.cwd(), 'extension'), { recursive: true })) {
      const name = String(file).split(path.sep).join('/');
      if (
        fs.statSync(path.join(process.cwd(), 'extension', name)).isFile() &&
        name !== 'README.md'
      ) {
        expect(entries[name], name).toBeDefined();
        const source = fs.readFileSync(path.join(process.cwd(), 'extension', name));
        if (name === 'manifest.json') {
          const { version_name: _generated, ...packagedManifest } = manifest;
          expect(packagedManifest).toEqual(JSON.parse(source.toString()));
        } else expect(Buffer.from(entries[name]).equals(source), name).toBe(true);
      }
    }
  });

  it('is deterministic, excludes unrelated files and rejects unsafe declared resources', () => {
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
      const artifact = packageRayenExtension(root);
      const repeated = packageRayenExtension(root);
      expect(Buffer.from(repeated.zip).equals(Buffer.from(artifact.zip))).toBe(true);
      expect(repeated.fileName).toBe(artifact.fileName);
      const originalManifest = fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8');
      expect(JSON.parse(originalManifest).version_name).toBeUndefined();
      fs.writeFileSync(path.join(extension, 'new-feature.js'), 'const feature = 1;');
      const changed = packageRayenExtension(root);
      expect(changed.version).toBe(artifact.version);
      expect(changed.buildId).not.toBe(artifact.buildId);
      expect(changed.fileName).not.toBe(artifact.fileName);
      fs.unlinkSync(path.join(extension, 'new-feature.js'));
      fs.writeFileSync(
        path.join(extension, 'manifest.json'),
        JSON.stringify({
          ...JSON.parse(originalManifest),
          version_name: 'stale-build-marker',
        })
      );
      expect(packageRayenExtension(root).buildId).toBe(artifact.buildId);
      expect(Object.keys(unzipSync(artifact.zip))).toEqual(['manifest.json', 'vendor-lock.json']);
      writeManifest(['missing.js']);
      expect(() => packageRayenExtension(root)).toThrow();
      writeManifest(['../outside.js']);
      expect(() => packageRayenExtension(root)).toThrow(/Unsafe/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
