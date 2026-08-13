#!/usr/bin/env node

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const ANSI_ESCAPE_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

const normalizeFirebaseCliLine = output =>
  String(output ?? '')
    .replace(ANSI_ESCAPE_SEQUENCE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const FUNCTION_ABSENCE_PATTERNS = [
  /^(?:error:\s*)?the specified filters do not match any existing functions(?: in project [^.]+)?\.?$/,
  /^(?:error:\s*)?no (?:matching )?functions? (?:were )?(?:found|present)\.?$/,
  /^(?:error:\s*)?functions? [a-z0-9_:-]+ (?:was |were )?(?:not found|does not exist)\.?$/,
];

const BENIGN_OUTPUT_PATTERNS = [/^npm (?:warn|notice)\b/];

export const isFirebaseFunctionAlreadyAbsent = output => {
  const lines = String(output ?? '')
    .split(/\r?\n/)
    .map(normalizeFirebaseCliLine)
    .filter(Boolean);

  const isAbsenceLine = line => FUNCTION_ABSENCE_PATTERNS.some(pattern => pattern.test(line));
  const hasAbsenceLine = lines.some(isAbsenceLine);

  return (
    hasAbsenceLine &&
    lines.every(
      line => isAbsenceLine(line) || BENIGN_OUTPUT_PATTERNS.some(pattern => pattern.test(line))
    )
  );
};

const main = () => {
  const output = fs.readFileSync(0, 'utf8');
  process.exit(isFirebaseFunctionAlreadyAbsent(output) ? 0 : 1);
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
