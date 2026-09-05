#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'scripts', 'config', 'compatibility-governance.json');
const REPORTS_DIR = path.join(ROOT, 'reports');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
// This supporting snapshot is versioned; wall-clock provenance belongs to the release manifest.
const generatedAt = 'stable:compatibility-governance';

const KIND_RISK_DEFAULTS = {
  compatibility_facade: 'Aumenta el costo de cambio y puede perpetuar imports legacy.',
  migration_shim: 'Puede ocultar deuda transicional y retrasar el retiro del modelo legacy.',
  legacy_bridge: 'Extiende superficie de compatibilidad y riesgo operativo en reglas o datos.',
  compatibility_barrel: 'Permite que consumidores nuevos sigan entrando por surfaces no canónicas.',
  deprecated_bridge: 'Mantiene acoplamiento a controladores históricos y frena la convergencia al dominio nuevo.',
};

const entries = (config.entries || []).map(entry => ({
  ...entry,
  exists: fs.existsSync(path.join(ROOT, entry.path)),
  riskIfRetained: entry.riskIfRetained || KIND_RISK_DEFAULTS[entry.kind] || 'Riesgo transicional no explicitado.',
}));

const report = {
  generatedAt,
  policyVersion: config.policyVersion || 'unknown',
  expansionRule: config.expansionRule || '',
  documentationRule: config.documentationRule || '',
  exceptionProcess: config.exceptionProcess || '',
  trackedEntries: entries.length,
  missingEntries: entries.filter(entry => !entry.exists).map(entry => entry.path),
  entries,
};

fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.writeFileSync(
  path.join(REPORTS_DIR, 'compatibility-governance.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8'
);

const markdown = `# Compatibility Governance Snapshot

- Generated: ${generatedAt}
- Policy version: ${report.policyVersion}
- Tracked entries: ${report.trackedEntries}

## Policy

- Expansion rule: ${report.expansionRule}
- Documentation rule: ${report.documentationRule}
- Exception process: ${report.exceptionProcess}

## Compatibility Inventory

| Path | Owner | Kind | Exists | Remaining consumers | Risk if retained | Target |
| --- | --- | --- | --- | --- | --- | --- |
${entries
  .map(
    entry =>
      `| \`${entry.path}\` | ${entry.owner} | ${entry.kind} | ${entry.exists ? 'yes' : 'no'} | ${entry.remainingConsumers} | ${entry.riskIfRetained} | ${entry.target} |`
  )
  .join('\n')}

## Retirement Criteria

${entries
  .map(
    entry =>
      `- \`${entry.path}\`: ${entry.retirementCriteria} (reason: ${entry.reason})`
  )
  .join('\n')}
`;

fs.writeFileSync(
  path.join(REPORTS_DIR, 'compatibility-governance.md'),
  `${markdown}\n`,
  'utf8'
);

console.log('[compatibility-governance] Report generated at reports/compatibility-governance.{md,json}');
