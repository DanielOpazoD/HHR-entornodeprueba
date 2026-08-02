#!/usr/bin/env node

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const ANSI_ESCAPE_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

const normalizeFirebaseCliOutput = output =>
  String(output ?? '')
    .replace(ANSI_ESCAPE_SEQUENCE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const FUNCTION_ABSENCE_PATTERNS = [
  /the specified filters do not match any existing functions(?: in project [^.]+)?\.?/,
  /\bno (?:matching )?functions? (?:were )?(?:found|present)\b/,
  /\bfunctions? [a-z0-9_:-]+ (?:was |were )?(?:not found|does not exist)\b/,
];

export const isFirebaseFunctionAlreadyAbsent = output => {
  const normalizedOutput = normalizeFirebaseCliOutput(output);
  return FUNCTION_ABSENCE_PATTERNS.some(pattern => pattern.test(normalizedOutput));
};

const main = () => {
  const output = fs.readFileSync(0, 'utf8');
  process.exit(isFirebaseFunctionAlreadyAbsent(output) ? 0 : 1);
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
