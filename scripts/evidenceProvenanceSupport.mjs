import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getEvidenceReportDependencyFiles } from './evidenceDependencyGraph.mjs';

const uniqueSorted = values => [...new Set(values.filter(Boolean))].sort();

const readFingerprintPayload = dependencyPath => {
  const content = fs.readFileSync(dependencyPath);
  if (!dependencyPath.endsWith('.json')) {
    return content;
  }

  try {
    const parsed = JSON.parse(content.toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const { generatedFor, ...semanticPayload } = parsed;
      return `${JSON.stringify(semanticPayload)}\n`;
    }
  } catch {
    return content;
  }

  return content;
};

export const buildDependencyFingerprint = ({ root, dependencyFiles }) => {
  const hash = crypto.createHash('sha256');
  const files = [];
  const missingFiles = [];

  for (const dependencyFile of uniqueSorted(dependencyFiles)) {
    const dependencyPath = path.join(root, dependencyFile);
    hash.update(`${dependencyFile}\0`);
    if (!fs.existsSync(dependencyPath)) {
      missingFiles.push(dependencyFile);
      hash.update('missing\0');
      continue;
    }

    files.push(dependencyFile);
    hash.update(readFingerprintPayload(dependencyPath));
    hash.update('\0');
  }

  return {
    algorithm: 'sha256:dependency-files-v1',
    value: hash.digest('hex'),
    files,
    missingFiles,
  };
};

const getGitTreeHash = root => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
};

export const buildEvidenceProvenance = ({ root, reportId, gitState }) => {
  const dependencies = getEvidenceReportDependencyFiles(reportId);

  return {
    gitSha: gitState.gitSha,
    gitDirty: gitState.gitDirty,
    treeHash: getGitTreeHash(root),
    reportId,
    dependencyFingerprint: buildDependencyFingerprint({
      root,
      dependencyFiles: dependencies,
    }),
  };
};

export const normalizeDependencyFingerprintValue = fingerprint => {
  if (typeof fingerprint === 'string') return fingerprint;
  if (typeof fingerprint?.value === 'string') return fingerprint.value;
  return '';
};
