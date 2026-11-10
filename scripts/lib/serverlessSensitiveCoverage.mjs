#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = path.join('scripts', 'config', 'serverless-sensitive-coverage.json');

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));

export const buildServerlessSensitiveCoverageReport = root => {
  const absoluteConfigPath = path.join(root, CONFIG_PATH);
  if (!fs.existsSync(absoluteConfigPath)) {
    throw new Error(`Missing ${CONFIG_PATH}`);
  }

  const config = readJson(absoluteConfigPath);
  const contractsDoc = String(config.contractsDoc || '').trim();
  const contractsDocPath = contractsDoc ? path.join(root, contractsDoc) : null;
  const contractsDocContent =
    contractsDocPath && fs.existsSync(contractsDocPath)
      ? fs.readFileSync(contractsDocPath, 'utf8')
      : '';

  const entries = Array.isArray(config.entries) ? config.entries : [];
  const issues = [];
  if (entries.length === 0) {
    issues.push(
      `${CONFIG_PATH}: add at least one sensitive function to entries with id, functionFile, endpoint and testFiles.`
    );
  }
  const exempt = Array.isArray(config.exempt) ? config.exempt : [];
  const normalizedExempt = exempt.map(item => {
    const functionFile = String(item?.functionFile || '').trim();
    const reason = typeof item?.reason === 'string' ? item.reason.trim() : '';
    if (!functionFile) issues.push(`${CONFIG_PATH}: exempt must include functionFile.`);
    if (!reason)
      issues.push(
        `${CONFIG_PATH}: add a non-empty reason to exempt for ${functionFile || 'unknown'}.`
      );
    if (functionFile && !fs.existsSync(path.join(root, functionFile))) {
      issues.push(
        `${CONFIG_PATH}: exempt names missing function file ${functionFile}; remove or correct functionFile.`
      );
    }
    return { functionFile, reason };
  });

  const normalizedEntries = entries.map(entry => {
    const id = String(entry?.id || '').trim();
    const functionFile = String(entry?.functionFile || '').trim();
    const endpoint = String(entry?.endpoint || '').trim();
    const testFiles = Array.isArray(entry?.testFiles)
      ? entry.testFiles
          .filter(value => typeof value === 'string' && value.trim())
          .map(value => value.trim())
      : [];

    const missing = [];

    if (!id) missing.push('missing id');
    if (!functionFile) missing.push('missing functionFile');
    if (!endpoint) missing.push('missing endpoint');
    if (testFiles.length === 0) missing.push('missing testFiles');

    const functionExists = functionFile ? fs.existsSync(path.join(root, functionFile)) : false;
    if (functionFile && !functionExists) {
      missing.push(`missing function file ${functionFile}`);
    }

    const tests = testFiles.map(testFile => ({
      file: testFile,
      exists: fs.existsSync(path.join(root, testFile)),
    }));
    const missingTests = tests.filter(test => !test.exists).map(test => test.file);
    if (missingTests.length > 0) {
      missing.push(`missing tests ${missingTests.join(', ')}`);
    }

    const documentedInContracts =
      Boolean(contractsDocContent) && endpoint
        ? contractsDocContent.includes(`\`${endpoint}\``)
        : false;
    if (!documentedInContracts) {
      missing.push(`contracts doc missing endpoint ${endpoint}`);
    }

    const entryIssues = missing.map(
      message => `${CONFIG_PATH}: ${id || functionFile || 'unknown'}: ${message}`
    );
    issues.push(...entryIssues);

    return {
      id,
      endpoint,
      functionFile,
      functionExists,
      testFiles: tests,
      documentedInContracts,
      status: entryIssues.length === 0 ? 'ok' : 'invalid',
      issues: entryIssues,
    };
  });

  const entryFiles = new Set(normalizedEntries.map(entry => path.normalize(entry.functionFile)));
  const exemptFiles = new Set(normalizedExempt.map(item => path.normalize(item.functionFile)));
  for (const file of exemptFiles) {
    if (entryFiles.has(file)) {
      issues.push(
        `${CONFIG_PATH}: ${file} is in both entries and exempt; keep it in exactly one list.`
      );
    }
  }
  const functionsDir = path.join(root, 'netlify/functions');
  const functionFiles = fs.existsSync(functionsDir)
    ? fs
        .readdirSync(functionsDir, { withFileTypes: true })
        .filter(item => item.isFile() && /\.(ts|mts|js)$/.test(item.name))
        .map(item => `netlify/functions/${item.name}`)
        .sort()
    : [];
  for (const file of functionFiles) {
    if (!entryFiles.has(file) && !exemptFiles.has(file)) {
      issues.push(
        `${file}: add to entries (id, functionFile, endpoint, testFiles) or exempt (functionFile, non-empty reason) in ${CONFIG_PATH}.`
      );
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    version: config.version ?? null,
    contractsDoc,
    checkedEntries: normalizedEntries.length,
    entries: normalizedEntries,
    functionFiles,
    exempt: normalizedExempt,
    issues,
  };
};

export const formatServerlessSensitiveCoverageMarkdown = report => {
  const lines = [
    '# Serverless Sensitive Coverage',
    '',
    `Generated at: ${report.generatedAt}`,
    `Version: ${String(report.version ?? 'unknown')}`,
    `Contracts doc: \`${report.contractsDoc || 'missing'}\``,
    `Checked entries: ${report.checkedEntries}`,
    '',
    '| Id | Endpoint | Function file | Tests | Contracts doc | Status |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const entry of report.entries) {
    lines.push(
      `| ${entry.id} | \`${entry.endpoint}\` | \`${entry.functionFile}\` | ${
        entry.testFiles.length > 0
          ? entry.testFiles
              .map(test => `${test.exists ? 'ok' : 'missing'}:${test.file}`)
              .join('<br/>')
          : '-'
      } | ${entry.documentedInContracts ? 'ok' : 'missing'} | ${entry.status} |`
    );
  }

  lines.push('', '## Exempt', '', '| Function file | Reason |', '| --- | --- |');
  for (const item of report.exempt) {
    lines.push(`| \`${item.functionFile}\` | ${item.reason} |`);
  }

  lines.push('', '## Issues', '');
  if (report.issues.length === 0) {
    lines.push('- none');
  } else {
    for (const issue of report.issues) {
      lines.push(`- ${issue}`);
    }
  }

  return lines.join('\n');
};
