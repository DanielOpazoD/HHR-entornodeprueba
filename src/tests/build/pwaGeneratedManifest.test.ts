// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { getManifest } from 'workbox-build';
import { expect, it } from 'vitest';

it('generates the same precache membership that the budget accounts for', async () => {
  const config = ts.createSourceFile(
    'vite.config.ts',
    fs.readFileSync('vite.config.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const globIgnores: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(config) === 'globIgnores' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      node.initializer.elements.forEach(element => {
        if (ts.isStringLiteral(element)) globIgnores.push(element.text);
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(config);
  expect(globIgnores.length).toBeGreaterThan(0);
  const budget = JSON.parse(fs.readFileSync('scripts/config/bundle-budget.json', 'utf8')) as {
    precacheIgnoredAssetPatterns: string[];
  };
  const patterns = budget.precacheIgnoredAssetPatterns.map(pattern => new RegExp(pattern));
  const assets = Array.from(
    new Set([
      ...globIgnores.map(glob =>
        glob
          .replace(/^\*\*\//, '')
          .replace(/\*\*/g, 'fixture.js')
          .replace(/\*/g, 'fixture')
          .replace(/^fixture\.wasm$/, 'assets/fixture.wasm')
      ),
      'assets/clinicalFormDocx-fixture.js',
      'assets/ClinicalFormTool-fixture.js',
      'assets/clinicalCarryoverVerification-fixture.js',
      'assets/CudyrReportExplorer-fixture.js',
      'assets/cudyrReportWorkbook-fixture.js',
      'assets/cudyrReportLoader-fixture.js',
      'downloads/optional.js',
      'assets/app-authenticated-shell-fixture.js',
      'assets/dexieDailyRecordOutbox-fixture.js',
      'assets/clinicalDerivedConstants-fixture.js',
      'assets/ClinicalLibraryDrawer-fixture.js',
      'assets/TransferCoverTool-fixture.js',
      'assets/ScoresTool-fixture.js',
    ])
  );
  const cache = path.join(process.cwd(), 'node_modules/.cache');
  fs.mkdirSync(cache, { recursive: true });
  const directory = fs.mkdtempSync(path.join(cache, 'pwa-manifest-'));
  try {
    for (const asset of assets) {
      const file = path.join(directory, asset);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '/* synthetic asset */');
    }
    const { manifestEntries, warnings } = await getManifest({
      globDirectory: directory,
      globPatterns: ['**/*'],
      globIgnores,
    });
    expect(warnings).toEqual([]);
    const urls = manifestEntries.map(entry => entry.url).sort();
    expect(urls).toEqual(assets.filter(asset => !patterns.some(p => p.test(asset))).sort());
    expect(urls).not.toContain('assets/clinicalFormDocx-fixture.js');
    expect(urls).toContain('assets/dexieDailyRecordOutbox-fixture.js');
    expect(urls).toContain('assets/TransferCoverTool-fixture.js');
    expect(urls).toContain('assets/ScoresTool-fixture.js');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
