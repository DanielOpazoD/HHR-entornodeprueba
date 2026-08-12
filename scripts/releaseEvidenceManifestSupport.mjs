import fs from 'node:fs';
import path from 'node:path';
import { getGitReportState } from './gitReportState.mjs';
import {
  RELEASE_DECISION_REPORT_IDS,
  RELEASE_EVIDENCE_CONTRACT_VERSION,
  RELEASE_EVIDENCE_INVENTORY,
} from './releaseEvidenceContract.mjs';
import { getEvidenceNode } from './evidenceDependencyGraph.mjs';

const isSameCommit = (left, right) =>
  Boolean(left && right) &&
  (left === right || left.startsWith(right) || right.startsWith(left));

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));

export const buildReleaseEvidenceManifest = ({ root, generatedAt = new Date().toISOString() }) => {
  const gitState = getGitReportState(root);
  const decisionReports = RELEASE_DECISION_REPORT_IDS.map(id => {
    const inventory = RELEASE_EVIDENCE_INVENTORY.find(report => report.id === id);
    const artifact = getEvidenceNode(id).artifacts.find(file => file.endsWith('.json'));
    const absolutePath = path.join(root, artifact);

    if (!fs.existsSync(absolutePath)) {
      return { id, label: inventory.label, artifact, status: 'missing' };
    }

    try {
      const report = readJson(absolutePath);
      const reportSha = typeof report.gitSha === 'string' ? report.gitSha : '';
      const reportGeneratedAt =
        typeof report.generatedAt === 'string' ? report.generatedAt : 'unknown';
      const status =
        reportSha &&
        isSameCommit(reportSha, gitState.gitSha) &&
        report.gitDirty === gitState.gitDirty
          ? 'current'
          : 'stale';
      return {
        id,
        label: inventory.label,
        artifact,
        generatedAt: reportGeneratedAt,
        gitSha: reportSha || 'unknown',
        status,
      };
    } catch (error) {
      return {
        id,
        label: inventory.label,
        artifact,
        status: 'invalid',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const currentReports = decisionReports.filter(report => report.status === 'current').length;
  const staleReports = decisionReports.length - currentReports;

  return {
    schemaVersion: 1,
    contractVersion: RELEASE_EVIDENCE_CONTRACT_VERSION,
    generatedAt,
    ...gitState,
    status: staleReports === 0 && !gitState.gitDirty ? 'current' : 'stale',
    summary: {
      decisionReports: decisionReports.length,
      currentReports,
      staleReports,
    },
    reports: decisionReports,
    inventory: RELEASE_EVIDENCE_INVENTORY.map(report => ({
      ...report,
      producer: getEvidenceNode(report.id).command,
      artifacts: getEvidenceNode(report.id).artifacts,
    })),
  };
};

export const formatReleaseEvidenceManifestMarkdown = manifest => {
  const lines = [
    '# Contrato de evidencia de release',
    '',
    `- Generado: ${manifest.generatedAt}`,
    `- Commit: \`${manifest.gitSha}\``,
    `- Worktree: ${manifest.gitDirty ? 'dirty' : 'clean'}`,
    `- Vigencia: **${manifest.status}**`,
    `- Informes vigentes: ${manifest.summary.currentReports}/${manifest.summary.decisionReports}`,
    '',
    '## Inventario',
    '',
    '| Informe | Rol | Productor | Owner | Consumidores | Política | Estado |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const entry of manifest.inventory) {
    const report = manifest.reports.find(candidate => candidate.id === entry.id);
    lines.push(
      `| ${entry.label} (\`${entry.id}\`) | ${entry.role} | \`npm run ${entry.producer}\` | ${entry.owner} | ${entry.consumers.join(', ')} | ${entry.freshnessPolicy} | ${report?.status || 'supporting'} |`
    );
  }

  return `${lines.join('\n')}\n`;
};

export const buildRuntimeReleaseEvidenceManifest = manifest => ({
  schemaVersion: manifest.schemaVersion,
  contractVersion: manifest.contractVersion,
  generatedAt: manifest.generatedAt,
  gitSha: manifest.gitSha,
  status: manifest.status,
  summary: manifest.summary,
});

export const collectReleaseEvidenceManifestIssues = ({ manifest, currentGitState }) => {
  const issues = [];
  if (manifest.schemaVersion !== 1) issues.push('Release evidence manifest schemaVersion must be 1.');
  if (manifest.contractVersion !== RELEASE_EVIDENCE_CONTRACT_VERSION) {
    issues.push('Release evidence manifest contractVersion does not match the repository contract.');
  }
  if (!isSameCommit(String(manifest.gitSha || ''), currentGitState.gitSha)) {
    issues.push(
      `Release evidence manifest targets ${manifest.gitSha || 'unknown'}, current HEAD is ${currentGitState.gitSha}.`
    );
  }
  if (manifest.gitDirty !== currentGitState.gitDirty) {
    issues.push('Release evidence manifest worktree state does not match the current worktree.');
  }
  if (manifest.status !== 'current') issues.push(`Release evidence status is ${manifest.status}.`);
  if (manifest.summary?.staleReports !== 0) {
    issues.push(`Release evidence contains ${manifest.summary?.staleReports ?? 'unknown'} stale reports.`);
  }
  return issues;
};
