import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.resolve(ROOT, relativePath), 'utf8');

const collectProductionSourceFiles = (directory: string): string[] => {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap(entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests') {
        return [];
      }
      return collectProductionSourceFiles(absolutePath);
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [absolutePath];
  });
};

const toRelative = (absolutePath: string): string => path.relative(ROOT, absolutePath);

let productionFilesCache: string[] | null = null;

const productionFiles = () => {
  productionFilesCache ??= collectProductionSourceFiles(path.resolve(ROOT, 'src'));
  return productionFilesCache;
};

const findsRuntimeImport = (source: string, moduleName: string): boolean => {
  const escapedModuleName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:from\\s+['"]${escapedModuleName}|import\\(\\s*['"]${escapedModuleName})`
  ).test(source);
};

describe('runtime asset import boundary', () => {
  it('keeps heic2any behind the shared image runtime loader', () => {
    const allowedImporters = new Set([
      path.resolve(ROOT, 'src/shared/images/heicConverterLoader.ts'),
    ]);

    const offenders = productionFiles()
      .filter(file => !allowedImporters.has(file))
      .filter(file => findsRuntimeImport(readSource(toRelative(file)), 'heic2any'))
      .map(toRelative);

    expect(offenders).toEqual([]);
  });

  it('keeps pdf-lib value imports behind the PDF generation runtime loader', () => {
    const allowedImporters = new Set([path.resolve(ROOT, 'src/services/pdf/pdfLibRuntime.ts')]);

    const offenders = productionFiles()
      .filter(file => !allowedImporters.has(file))
      .filter(file => {
        const source = readSource(toRelative(file));
        return (
          /import\s+(?!type\b)[\s\S]*?\s+from ['"]pdf-lib['"]/.test(source) ||
          /import\(\s*['"]pdf-lib['"]/.test(source)
        );
      })
      .map(toRelative);

    expect(offenders).toEqual([]);
  });

  it('keeps PDF.js text extraction behind the PDF reading runtime loader', () => {
    const allowedImporters = new Set([path.resolve(ROOT, 'src/services/pdf/pdfJsTextRuntime.ts')]);

    const offenders = productionFiles()
      .filter(file => !allowedImporters.has(file))
      .filter(file => readSource(toRelative(file)).includes('pdfjs-dist/legacy/build/pdf'))
      .map(toRelative);

    expect(offenders).toEqual([]);
  });

  it('keeps heavy runtime asset imports out of startup shell files', () => {
    const startupBoundaryFiles = [
      'src/App.tsx',
      'src/app-shell/bootstrap/authenticatedRoutePreloadController.ts',
      'src/app-shell/bootstrap/useAppBootstrapState.ts',
      'src/app-shell/runtime/AuthenticatedAppShell.tsx',
      'src/app-shell/runtime/useAuthenticatedAppRuntime.ts',
      'src/components/AppProviders.tsx',
      'src/components/layout/AppContent.tsx',
    ];

    for (const file of startupBoundaryFiles) {
      const source = readSource(file);
      expect(source, file).not.toMatch(/heic2any|pdf-lib|pdfjs-dist/);
    }
  });

  it('keeps Firebase Storage avatar operations behind a profile storage runtime loader', () => {
    const avatarProfileServiceSource = readSource(
      'src/services/user-profile/userAvatarProfileService.ts'
    );
    const avatarStorageRuntimeSource = readSource(
      'src/services/user-profile/userAvatarStorageRuntime.ts'
    );

    expect(avatarProfileServiceSource).not.toMatch(
      /from ['"]firebase\/storage['"]|import\(\s*['"]firebase\/storage['"]/
    );
    expect(avatarProfileServiceSource).toContain(
      "from '@/services/user-profile/userAvatarStorageRuntime'"
    );
    expect(avatarStorageRuntimeSource).toContain("import('firebase/storage')");
    expect(avatarStorageRuntimeSource).toContain('storageModulePromise = null');
  });
});
