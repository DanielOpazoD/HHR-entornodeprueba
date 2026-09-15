import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CONFIG_PATH = 'scripts/config/ci-change-scope.json';
const SAFE_FILE_STATUSES = new Set(['added', 'modified']);

const normalizePath = value => String(value || '').replace(/^\.\//, '');

const globToRegex = glob => {
  const escaped = normalizePath(glob)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '__DOUBLE_STAR__')
    .replaceAll('*', '[^/]*')
    .replaceAll('__DOUBLE_STAR__', '.*');
  return new RegExp(`^${escaped}$`);
};

const matchesAny = (file, patterns = []) => patterns.some(pattern => globToRegex(pattern).test(file));

export const loadCiChangeScopeConfig = root =>
  JSON.parse(fs.readFileSync(path.join(root, CONFIG_PATH), 'utf8'));

export const classifyCiChangeScope = ({ eventName, files, config }) => {
  if (eventName !== 'pull_request') {
    return { scope: 'full', reason: 'non_pull_request_event', usedFallback: false };
  }

  if (!Array.isArray(files) || files.length === 0) {
    return { scope: 'full', reason: 'missing_changed_files', usedFallback: true };
  }

  if (files.length > Number(config.maxFiles || 0)) {
    return { scope: 'full', reason: 'change_set_too_large', usedFallback: true };
  }

  const normalizedFiles = files.map(file => ({
    filename: normalizePath(file?.filename),
    status: String(file?.status || '').toLowerCase(),
  }));

  if (normalizedFiles.some(file => !file.filename || !SAFE_FILE_STATUSES.has(file.status))) {
    return { scope: 'full', reason: 'unsafe_file_metadata', usedFallback: true };
  }

  const docs = config.docsOnly || {};
  const isDocsOnly = normalizedFiles.every(({ filename }) => {
    if (matchesAny(filename, docs.excluded)) return false;
    return (docs.rootFiles || []).includes(filename) || matchesAny(filename, docs.directories);
  });
  if (isDocsOnly) {
    return { scope: 'docs-only', reason: 'docs_allowlist', usedFallback: false };
  }

  const functions = config.functionsOnly || {};
  const isFunctionsOnly = normalizedFiles.every(({ filename }) => {
    if (matchesAny(filename, functions.excluded)) return false;
    return (functions.supportFiles || []).includes(filename) || matchesAny(filename, functions.directories);
  });
  if (isFunctionsOnly) {
    return { scope: 'functions-only', reason: 'functions_allowlist', usedFallback: false };
  }

  return { scope: 'full', reason: 'unclassified_or_mixed_change', usedFallback: true };
};

const splitNullDelimitedBuffers = value => {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(value || '');
  const fields = [];
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== 0) continue;
    if (index > start) fields.push(input.subarray(start, index));
    start = index + 1;
  }
  if (start < input.length) fields.push(input.subarray(start));
  return fields;
};

export const parseGitNameStatus = value => {
  const fields = splitNullDelimitedBuffers(value);
  const files = [];
  for (let index = 0; index < fields.length; ) {
    const gitStatus = fields[index].toString('ascii');
    index += 1;
    const isRenameOrCopy = gitStatus.startsWith('R') || gitStatus.startsWith('C');
    if (isRenameOrCopy) index += 1;
    const pathname = fields[index];
    index += 1;
    if (!pathname) throw new Error(`Missing pathname for Git status ${gitStatus}.`);
    files.push({
      filename: normalizePath(pathname.toString('utf8')),
      status: gitStatus === 'A' || gitStatus === 'M' ? 'modified' : 'unsafe',
    });
  }
  return files;
};

export const collectChangedFilesFromGit = ({ root, baseSha, headSha, execFile = execFileSync }) => {
  const shaPattern = /^[0-9a-f]{40}$/i;
  if (!shaPattern.test(baseSha) || !shaPattern.test(headSha)) {
    throw new Error('Change scope requires full 40-character base and head SHAs.');
  }

  const output = execFile(
    'git',
    ['-C', root, 'diff', '--name-status', '-z', `${baseSha}...${headSha}`],
    { encoding: 'buffer' }
  );
  return parseGitNameStatus(output);
};
