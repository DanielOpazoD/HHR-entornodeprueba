import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = 'scripts/config/guardrail-governance.json';
const PACKAGE_JSON_PATH = 'package.json';
const RELEASE_CONFIDENCE_CONFIG_PATH = 'scripts/config/release-confidence-pack.json';

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));

export const readGuardrailGovernanceSummary = root => {
  const config = readJson(path.join(root, CONFIG_PATH));
  const blockingTiers = Array.isArray(config.blockingTiers) ? config.blockingTiers : [];
  const reportOnly = Array.isArray(config.reportOnly) ? config.reportOnly : [];

  return {
    blockingTierCount: blockingTiers.length,
    reportOnlyCount: reportOnly.length,
  };
};

export const extractReferencedScripts = command =>
  Array.from(String(command).matchAll(/npm run ([A-Za-z0-9:_-]+)/g)).map(match => match[1]);

export const collectReferencedScripts = (scripts, scriptNames, visited = new Set()) => {
  const referencedScripts = new Set();

  for (const scriptName of scriptNames) {
    if (visited.has(scriptName)) {
      continue;
    }
    visited.add(scriptName);
    referencedScripts.add(scriptName);

    const scriptCommand = scripts[scriptName];
    if (typeof scriptCommand !== 'string') {
      continue;
    }

    for (const nestedScriptName of extractReferencedScripts(scriptCommand)) {
      referencedScripts.add(nestedScriptName);
      for (const transitiveScriptName of collectReferencedScripts(
        scripts,
        [nestedScriptName],
        visited
      )) {
        referencedScripts.add(transitiveScriptName);
      }
    }
  }

  return referencedScripts;
};

export const collectGuardrailGovernanceIssues = root => {
  const configPath = path.join(root, CONFIG_PATH);
  const packageJsonPath = path.join(root, PACKAGE_JSON_PATH);
  const releaseConfidenceConfigPath = path.join(root, RELEASE_CONFIDENCE_CONFIG_PATH);
  const missingCoreFiles = [
    !fs.existsSync(configPath) ? `Missing ${CONFIG_PATH}` : null,
    !fs.existsSync(packageJsonPath) ? `Missing ${PACKAGE_JSON_PATH}` : null,
  ].filter(Boolean);

  if (missingCoreFiles.length > 0) {
    return missingCoreFiles;
  }

  const config = readJson(configPath);
  const packageJson = readJson(packageJsonPath);
  const releaseConfidenceConfig = fs.existsSync(releaseConfidenceConfigPath)
    ? readJson(releaseConfidenceConfigPath)
    : null;
  const issues = [];

  if (config.version !== 1) {
    issues.push(`Expected version 1, received ${String(config.version || 'unknown')}`);
  }

  const scripts = packageJson.scripts || {};
  const blockingTiers = Array.isArray(config.blockingTiers) ? config.blockingTiers : [];
  const reportOnly = Array.isArray(config.reportOnly) ? config.reportOnly : [];
  const releaseConfidence =
    config.releaseConfidence && typeof config.releaseConfidence === 'object'
      ? config.releaseConfidence
      : null;
  const qualityAggregate =
    config.qualityAggregate && typeof config.qualityAggregate === 'object'
      ? config.qualityAggregate
      : null;

  const ensureScriptExists = (scriptName, ownerLabel) => {
    if (typeof scripts[scriptName] !== 'string') {
      issues.push(`${ownerLabel}: missing package.json script ${scriptName}`);
      return false;
    }
    return true;
  };

  const ensureArtifactExists = (artifactPath, ownerLabel) => {
    if (!fs.existsSync(path.join(root, artifactPath))) {
      issues.push(`${ownerLabel}: missing artifact ${artifactPath}`);
    }
  };

  for (const tier of blockingTiers) {
    const label = `blockingTiers.${tier?.id || 'unknown'}`;
    const gateScript = String(tier?.script || '');
    const requiredScripts = Array.isArray(tier?.requiredScripts) ? tier.requiredScripts : [];

    if (!gateScript) {
      issues.push(`${label}: missing script`);
      continue;
    }

    if (!ensureScriptExists(gateScript, label)) {
      continue;
    }

    if (!['inner-loop', 'merge-gate', 'release-gate'].includes(String(tier?.level || ''))) {
      issues.push(`${label}: invalid level ${String(tier?.level || 'unknown')}`);
    }

    const referencedScripts = extractReferencedScripts(scripts[gateScript]);
    for (const requiredScript of requiredScripts) {
      ensureScriptExists(requiredScript, label);
      if (!referencedScripts.includes(requiredScript)) {
        issues.push(`${label}: ${gateScript} does not reference ${requiredScript}`);
      }
    }
  }

  if (!releaseConfidence) {
    issues.push('Missing releaseConfidence section');
  } else {
    const label = 'releaseConfidence';
    const scriptName = String(releaseConfidence.script || '');
    const requiredScripts = Array.isArray(releaseConfidence.requiredScripts)
      ? releaseConfidence.requiredScripts
      : [];

    ensureScriptExists(scriptName, label);
    for (const requiredScript of requiredScripts) {
      ensureScriptExists(requiredScript, label);
    }

    if (!releaseConfidenceConfig || !Array.isArray(releaseConfidenceConfig.steps)) {
      issues.push('releaseConfidence: missing scripts/config/release-confidence-pack.json');
    } else {
      const directConfiguredScripts = releaseConfidenceConfig.steps.flatMap(step =>
        extractReferencedScripts(step?.command || '')
      );
      const configuredScripts = [...collectReferencedScripts(scripts, directConfiguredScripts)];

      for (const requiredScript of requiredScripts) {
        if (!configuredScripts.includes(requiredScript)) {
          issues.push(`releaseConfidence: release-confidence-pack is missing ${requiredScript}`);
        }
      }
    }
  }

  if (!qualityAggregate) {
    issues.push('Missing qualityAggregate section');
  } else {
    const label = 'qualityAggregate';
    const scriptName = String(qualityAggregate.script || '');
    const checks = Array.isArray(qualityAggregate.checks) ? qualityAggregate.checks : [];

    ensureScriptExists(scriptName, label);

    const checkIds = checks.map(entry => entry?.id).filter(Boolean);
    const duplicateCheckIds = checkIds.filter((id, index) => checkIds.indexOf(id) !== index);
    if (duplicateCheckIds.length > 0) {
      issues.push(`${label}: duplicate checks ${[...new Set(duplicateCheckIds)].join(', ')}`);
    }

    for (const check of checks) {
      const checkId = String(check?.id || '');
      const group = String(check?.group || '');
      if (!checkId) {
        issues.push(`${label}: check entry missing id`);
        continue;
      }
      ensureScriptExists(checkId, label);
      if (!group) {
        issues.push(`${label}: ${checkId} missing group`);
      }
    }
  }

  for (const reportEntry of reportOnly) {
    const label = `reportOnly.${reportEntry?.id || 'unknown'}`;
    const scriptName = String(reportEntry?.script || '');
    const artifact = String(reportEntry?.artifact || '');
    if (!scriptName) {
      issues.push(`${label}: missing script`);
      continue;
    }
    ensureScriptExists(scriptName, label);
    if (!artifact) {
      issues.push(`${label}: missing artifact`);
      continue;
    }
    ensureArtifactExists(artifact, label);
  }

  return issues;
};
