#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { isDirectCliEntry, runIssueListCli } from './lib/cliEntry.mjs';
import { RULE_ASSETS } from './rulesSourceSupport.mjs';

export const DEFAULT_RULES_SOURCE_GOVERNANCE_LIMITS = {
  maxFirestoreFragmentLines: 180,
};

/**
 * @typedef {object} RulesSourceGovernanceLimits
 * @property {number=} maxFirestoreFragmentLines
 * @property {string[]=} firestoreSources
 */

const countSourceLines = content => {
  const normalized = content.replace(/\r\n/g, '\n');
  const withoutFinalNewline = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return withoutFinalNewline.length === 0 ? 0 : withoutFinalNewline.split('\n').length;
};

/**
 * @param {string} root
 * @param {RulesSourceGovernanceLimits} [limits]
 * @returns {string[]}
 */
export const collectRulesSourceGovernanceIssues = (root, limits = {}) => {
  const maxFirestoreFragmentLines =
    limits.maxFirestoreFragmentLines ??
    DEFAULT_RULES_SOURCE_GOVERNANCE_LIMITS.maxFirestoreFragmentLines;

  const firestoreSources = limits.firestoreSources ?? RULE_ASSETS.firestore.sources;

  return firestoreSources.flatMap(relativePath => {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return [`${relativePath} is missing from the editable Firestore rules source.`];
    }

    const lineCount = countSourceLines(fs.readFileSync(absolutePath, 'utf8'));
    return lineCount > maxFirestoreFragmentLines
      ? [
          `${relativePath} has ${lineCount} lines; split or simplify before exceeding ${maxFirestoreFragmentLines} lines.`,
        ]
      : [];
  });
};

if (isDirectCliEntry(import.meta.url)) {
  runIssueListCli({
    tag: 'rules-source-governance',
    failureHeader: 'Firestore rules source governance failed:',
    issues: collectRulesSourceGovernanceIssues(process.cwd()),
    okMessage: 'Firestore rules fragments are within governance limits.',
  });
}
