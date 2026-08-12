import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
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
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['Release evidence manifest must be an object.'];
  }
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

  const reports = Array.isArray(manifest.reports) ? manifest.reports : [];
  if (!Array.isArray(manifest.reports)) {
    issues.push('Release evidence manifest reports must be an array.');
  }
  const reportIds = reports.map(report => report?.id).filter(Boolean);
  const uniqueReportIds = new Set(reportIds);
  if (
    reports.length !== RELEASE_DECISION_REPORT_IDS.length ||
    uniqueReportIds.size !== RELEASE_DECISION_REPORT_IDS.length ||
    RELEASE_DECISION_REPORT_IDS.some(id => !uniqueReportIds.has(id))
  ) {
    issues.push('Release evidence manifest must contain every decision report exactly once.');
  }

  for (const id of RELEASE_DECISION_REPORT_IDS) {
    const report = reports.find(candidate => candidate?.id === id);
    if (!report) continue;
    const inventory = RELEASE_EVIDENCE_INVENTORY.find(candidate => candidate.id === id);
    const expectedArtifact = getEvidenceNode(id).artifacts.find(file => file.endsWith('.json'));
    if (report.label !== inventory.label || report.artifact !== expectedArtifact) {
      issues.push(`Release evidence report ${id} does not match the declared inventory.`);
    }
    if (report.status !== 'current') {
      issues.push(`Release evidence report ${id} is ${report.status || 'invalid'}.`);
    }
    if (!isSameCommit(report.gitSha, currentGitState.gitSha)) {
      issues.push(`Release evidence report ${id} does not target the current HEAD.`);
    }
    if (
      typeof report.generatedAt !== 'string' ||
      Number.isNaN(Date.parse(report.generatedAt))
    ) {
      issues.push(`Release evidence report ${id} has no valid generation date.`);
    }
  }

  const inventory = Array.isArray(manifest.inventory) ? manifest.inventory : [];
  if (!Array.isArray(manifest.inventory)) {
    issues.push('Release evidence manifest inventory must be an array.');
  }
  const inventoryIds = inventory.map(report => report?.id).filter(Boolean);
  const uniqueInventoryIds = new Set(inventoryIds);
  if (
    inventory.length !== RELEASE_EVIDENCE_INVENTORY.length ||
    uniqueInventoryIds.size !== RELEASE_EVIDENCE_INVENTORY.length ||
    RELEASE_EVIDENCE_INVENTORY.some(entry => !uniqueInventoryIds.has(entry.id))
  ) {
    issues.push('Release evidence manifest inventory is incomplete or duplicated.');
  }
  for (const expected of RELEASE_EVIDENCE_INVENTORY) {
    const entry = inventory.find(candidate => candidate?.id === expected.id);
    if (!entry) continue;
    const node = getEvidenceNode(expected.id);
    if (
      entry.label !== expected.label ||
      entry.owner !== expected.owner ||
      entry.role !== expected.role ||
      entry.freshnessPolicy !== expected.freshnessPolicy ||
      entry.producer !== node.command ||
      !isDeepStrictEqual(entry.consumers, expected.consumers) ||
      !isDeepStrictEqual(entry.artifacts, node.artifacts)
    ) {
      issues.push(`Release evidence inventory entry ${expected.id} differs from the contract.`);
    }
  }

  const currentReports = reports.filter(report => report?.status === 'current').length;
  const staleReports = RELEASE_DECISION_REPORT_IDS.length - currentReports;
  const expectedSummary = {
    decisionReports: RELEASE_DECISION_REPORT_IDS.length,
    currentReports,
    staleReports,
  };
  if (!isDeepStrictEqual(manifest.summary, expectedSummary)) {
    issues.push('Release evidence summary does not match the validated report entries.');
  }
  const expectedStatus = staleReports === 0 && manifest.gitDirty === false ? 'current' : 'stale';
  if (manifest.status !== expectedStatus) {
    issues.push(`Release evidence status is ${manifest.status || 'invalid'}, expected ${expectedStatus}.`);
  }
  if (manifest.gitDirty !== false) {
    issues.push('Release evidence was generated from a dirty worktree.');
  }
  if (manifest.status !== 'current') {
    issues.push('Release evidence is not current and cannot authorize a release.');
  }
  if (staleReports !== 0) {
    issues.push(`Release evidence contains ${staleReports} stale reports.`);
  }
  return issues;
};

export const collectBuiltReleaseEvidenceIssues = ({
  runtimeManifest,
  manifest,
  expectedRuntimeManifest = manifest
    ? buildRuntimeReleaseEvidenceManifest(manifest)
    : undefined,
}) => {
  return isDeepStrictEqual(runtimeManifest, expectedRuntimeManifest)
    ? []
    : ['Built release evidence does not match the complete verified runtime contract.'];
};
