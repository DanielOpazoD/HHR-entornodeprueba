const FRONTEND_STARTUP_CRITICAL_ASSET_PATTERNS = [
  /^dist\/assets\/vendor-preload-[^/]+\.js$/,
  /^dist\/assets\/vendor-firebase-core-[^/]+\.js$/,
  /^dist\/assets\/app-authenticated-shell-[^/]+\.js$/,
];

const dedupeStrings = values => [...new Set(values.filter(Boolean))];

export const extractBootstrapTelemetrySignals = content =>
  dedupeStrings(
    [...content.matchAll(/'((?:bootstrap|indexeddb)_[a-z0-9_]+)'/g)].map(match => match[1])
  );

export const summarizePreviewGate = report => {
  const stats = report?.stats ?? {};
  const expected = Number(stats.expected ?? 0);
  const unexpected = Number(stats.unexpected ?? 0);
  const flaky = Number(stats.flaky ?? 0);
  const skipped = Number(stats.skipped ?? 0);
  const interrupted = Number(stats.interrupted ?? 0);
  const total = expected + unexpected + flaky + skipped;

  let status = 'unknown';
  if (unexpected > 0 || interrupted > 0) {
    status = 'blocked';
  } else if (flaky > 0 || skipped > 0) {
    status = 'degraded';
  } else if (expected > 0) {
    status = 'ok';
  }

  return {
    status,
    total,
    expected,
    unexpected,
    flaky,
    skipped,
    interrupted,
    durationMs: Number(stats.duration ?? 0),
  };
};

export const selectFrontendStartupCriticalAssets = ({
  buildAssets,
  entryAssets = [],
}) => {
  const criticalAssets = [
    ...entryAssets,
    ...(Array.isArray(buildAssets)
      ? buildAssets.filter(asset =>
          FRONTEND_STARTUP_CRITICAL_ASSET_PATTERNS.some(pattern => pattern.test(asset.file || ''))
        )
      : []),
  ];

  const deduped = new Map();
  for (const asset of criticalAssets) {
    if (!asset?.file) continue;
    deduped.set(asset.file, asset);
  }

  return [...deduped.values()];
};

export const summarizeFrontendStartupHealth = ({
  previewGate,
  criticalAssets,
  bootstrapTelemetrySignals,
}) => {
  const blockingAssets = criticalAssets.filter(asset => asset.status === 'blocking');
  const degradedAssets = criticalAssets.filter(asset =>
    ['target-miss', 'unknown'].includes(asset.status)
  );

  const issues = [];
  if (previewGate.status === 'blocked') {
    issues.push('El smoke de preview reporto fallas inesperadas del bootstrap.');
  } else if (previewGate.status === 'unknown') {
    issues.push('No hay artefacto reciente del smoke de preview para validar el arranque real.');
  } else if (previewGate.status === 'degraded') {
    issues.push('El smoke de preview paso con ruido operativo (flaky o skipped).');
  }

  if (blockingAssets.length > 0) {
    issues.push(
      `Chunks criticos bloqueados: ${blockingAssets.map(asset => asset.file.split('/').pop()).join(', ')}`
    );
  } else if (degradedAssets.length > 0) {
    issues.push(
      `Chunks criticos cerca del limite: ${degradedAssets.map(asset => asset.file.split('/').pop()).join(', ')}`
    );
  }

  let status = 'ok';
  if (previewGate.status === 'blocked' || blockingAssets.length > 0) {
    status = 'blocked';
  } else if (
    previewGate.status === 'unknown' ||
    previewGate.status === 'degraded' ||
    degradedAssets.length > 0
  ) {
    status = 'degraded';
  }

  return {
    status,
    issues,
    previewGate,
    criticalAssets,
    bootstrapTelemetrySignals: dedupeStrings(bootstrapTelemetrySignals),
  };
};
