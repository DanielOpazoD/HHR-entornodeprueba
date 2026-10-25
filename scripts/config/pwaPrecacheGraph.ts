import type { Plugin, Rollup } from 'vite';

// Existing optional features are not an offline promise. These exceptions never
// apply to a dependency of the login screen or authenticated census shell.
export const PRECACHE_STATIC_IMPORT_EXCEPTIONS = [
  { name: 'replanRayenStructure', reason: 'Historical reconstruction needs fresh Eloisa reports.' },
  { name: 'RayenImportButton', reason: 'Eloisa import requires the online source and extension.' },
  { name: 'LineChart', reason: 'Optional laboratory trend viewer, opened from a report.' },
  { name: 'vendor-dicom-vtk', reason: 'Optional imaging renderer and codecs.' },
  { name: 'dicomTypes', reason: 'Shared runtime contracts for the optional imaging viewer.' },
  { name: 'vendor-pdf-core', reason: 'Optional PDF rendering and download runtime.' },
  { name: 'vendor-excel-zip', reason: 'Optional Excel archive generation runtime.' },
  { name: 'clinicalDocumentTemplateEditorController', reason: 'Online document template editing.' },
  { name: 'healthService', reason: 'Optional operational diagnostics.' },
  { name: 'cudyrReportModel', reason: 'Optional historical CUDYR report.' },
  { name: 'CudyrReportExplorer', reason: 'Optional historical CUDYR explorer.' },
  { name: 'cudyrReportFacts', reason: 'Optional historical CUDYR facts.' },
  { name: 'cudyrReportLoader', reason: 'Historical CUDYR reads require server authority.' },
  { name: 'useCudyrReport', reason: 'Optional historical CUDYR report state.' },
  { name: 'ClinicalFormTool', reason: 'Optional network-loaded clinical forms.' },
  { name: 'ClinicalPanelDrawer', reason: 'Eloisa clinical drawer needs the online source.' },
  { name: 'terminologyService', reason: 'Online clinical terminology search.' },
];

type Chunk = Pick<Rollup.OutputChunk, 'fileName' | 'imports' | 'isEntry'>;

export const assertPrecacheStaticImports = (chunks: readonly Chunk[], urls: readonly string[]) => {
  const precached = new Set(urls.map(url => url.replace(/^\//, '').split('?')[0]));
  const byName = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
  const boot = new Set<string>();
  const visit = (name: string) => {
    if (boot.has(name)) return;
    boot.add(name);
    byName.get(name)?.imports.forEach(visit);
  };
  chunks
    .filter(chunk => chunk.isEntry || /\/App-|\/app-authenticated-shell-/.test(chunk.fileName))
    .forEach(chunk => visit(chunk.fileName));
  const violations: string[] = [];
  for (const chunk of chunks) {
    if (!precached.has(chunk.fileName)) continue;
    for (const dependency of chunk.imports) {
      if (!byName.has(dependency) || precached.has(dependency)) continue;
      const exception = PRECACHE_STATIC_IMPORT_EXCEPTIONS.find(entry =>
        dependency.startsWith(`assets/${entry.name}-`)
      );
      if (!exception || boot.has(chunk.fileName)) {
        violations.push(`${chunk.fileName} -> ${dependency}`);
      }
    }
  }
  if (violations.length) {
    throw new Error(
      `Precached chunks have uncached static imports. Precache them or defer their callers:\n${violations.join('\n')}`
    );
  }
};

export const createPrecacheGraphGuard = () => {
  let chunks: Rollup.OutputChunk[] = [];
  const plugin: Plugin = {
    name: 'pwa-precache-static-import-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      chunks = Object.values(bundle).filter(output => output.type === 'chunk');
    },
  };
  const manifestTransform = async <Entry extends { url: string }>(manifest: Entry[]) => {
    assertPrecacheStaticImports(
      chunks,
      manifest.map(entry => entry.url)
    );
    return { manifest, warnings: [] };
  };
  return { plugin, manifestTransform };
};
