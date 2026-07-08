import fs from 'node:fs';
import path from 'node:path';

const UNIT_SHARD_BALANCE_CONFIG_PATH = 'scripts/config/unit-shard-balance.json';

export const extractExcludePatterns = script => {
  const patterns = [];
  const excludePattern = /--exclude\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
  let match;
  while ((match = excludePattern.exec(script)) !== null) {
    patterns.push(match[1] || match[2] || match[3]);
  }
  return patterns;
};

export const normalizePatterns = patterns => [...new Set(patterns || [])].sort();

export const patternExcludesFile = (pattern, file) => {
  if (pattern === file) {
    return true;
  }
  if (pattern.endsWith('/**')) {
    return file.startsWith(pattern.slice(0, -3));
  }
  return false;
};

export const resolveUnitSuiteExcludePatterns = ({ root, scriptCommand }) => {
  if (scriptCommand.includes('scripts/run-unit-shard.mjs')) {
    const configPath = path.join(root, UNIT_SHARD_BALANCE_CONFIG_PATH);
    if (!fs.existsSync(configPath)) {
      throw new Error(`Missing ${UNIT_SHARD_BALANCE_CONFIG_PATH}`);
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return Array.isArray(config.excludedFromUnitSuite) ? config.excludedFromUnitSuite : [];
  }

  return extractExcludePatterns(scriptCommand);
};
