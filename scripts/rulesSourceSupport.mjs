#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

export const RULE_ASSETS = {
  firestore: {
    output: 'firestore.rules',
    generatedFormat: {
      stripBlankLines: true,
      stripLineComments: true,
    },
    sources: [
      'rules/firestore/00-auth-and-role-helpers.rules',
      'rules/firestore/10-specialist-bed-update-helpers.rules',
      'rules/firestore/11-specialist-structured-handoff-helpers.rules',
      'rules/firestore/12-specialist-handoff-boundary-helpers.rules',
      'rules/firestore/12-clinical-document-permission-helpers.rules',
      'rules/firestore/20-clinical-and-access-helpers.rules',
      'rules/firestore/22-invitation-and-receipt-helpers.rules',
      'rules/firestore/24-system-health-payload-helpers.rules',
      'rules/firestore/26-rayen-import-policy-helpers.rules',
      'rules/firestore/30-daily-record-write-helpers.rules',
      'rules/firestore/40-hospitals.rules',
      'rules/firestore/50-global-rules.rules',
    ],
  },
  storage: {
    output: 'storage.rules',
    sources: [
      'rules/storage/00-helper-functions.rules',
      'rules/storage/10-storage-paths.rules',
    ],
  },
};

const ensureTrailingNewline = content => (content.endsWith('\n') ? content : `${content}\n`);

export const normalizeGeneratedRuleFragment = (content, generatedFormat = {}) => {
  const normalized = content.replace(/\r\n/g, '\n');
  const withoutFinalNewline = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  const lines = withoutFinalNewline.length === 0 ? [] : withoutFinalNewline.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    if (generatedFormat.stripBlankLines && trimmed === '') {
      return false;
    }
    if (generatedFormat.stripLineComments && trimmed.startsWith('//')) {
      return false;
    }
    return true;
  });

  return filteredLines.length === 0 ? '' : ensureTrailingNewline(filteredLines.join('\n'));
};

export const buildRuleAssetContent = (root, assetName) => {
  const asset = RULE_ASSETS[assetName];
  if (!asset) {
    throw new Error(`Unknown rules asset: ${assetName}`);
  }

  return asset.sources
    .map(relativePath => {
      const absolutePath = path.join(root, relativePath);
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Missing rules source fragment: ${relativePath}`);
      }

      return normalizeGeneratedRuleFragment(fs.readFileSync(absolutePath, 'utf8'), asset.generatedFormat);
    })
    .join('');
};

export const writeRuleAssets = root => {
  for (const [assetName, asset] of Object.entries(RULE_ASSETS)) {
    const content = ensureTrailingNewline(buildRuleAssetContent(root, assetName));
    fs.writeFileSync(path.join(root, asset.output), content, 'utf8');
  }
};

export const getRuleAssetDrift = root =>
  Object.entries(RULE_ASSETS).flatMap(([assetName, asset]) => {
    const expected = ensureTrailingNewline(buildRuleAssetContent(root, assetName));
    const outputPath = path.join(root, asset.output);
    const actual = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;

    return actual === expected
      ? []
      : [
          {
            assetName,
            output: asset.output,
            sources: asset.sources,
          },
        ];
  });
