#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const constantsContent = fs.readFileSync(
  path.join(workspaceRoot, 'src/constants/runtimeContracts.ts'),
  'utf8'
);
const versionContent = fs.readFileSync(
  path.join(workspaceRoot, 'src/constants/version.ts'),
  'utf8'
);
const backendRuntimeContent = fs.readFileSync(
  path.join(workspaceRoot, 'functions/lib/runtime/runtimeContract.js'),
  'utf8'
);
const migrationLedgerContent = fs.readFileSync(
  path.join(workspaceRoot, 'src/services/repositories/migrationLedger.ts'),
  'utf8'
);
const parseConstant = (content, name) => {
  const match = content.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
};

const clientVersion = parseConstant(constantsContent, 'CLIENT_RUNTIME_CONTRACT_VERSION');
const backendVersion = parseConstant(constantsContent, 'BACKEND_RUNTIME_CONTRACT_VERSION');
const minBackendVersion = parseConstant(
  constantsContent,
  'MIN_SUPPORTED_BACKEND_RUNTIME_CONTRACT_VERSION'
);
const minClientVersion = parseConstant(
  constantsContent,
  'MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION'
);
const currentSchemaVersion = parseConstant(versionContent, 'CURRENT_SCHEMA_VERSION');
const legacySchemaVersion = parseConstant(versionContent, 'LEGACY_SCHEMA_VERSION');
const backendRuntimeVersionFromFunctions = parseConstant(
  backendRuntimeContent,
  'BACKEND_RUNTIME_CONTRACT_VERSION'
);
const minClientVersionFromFunctions = parseConstant(
  backendRuntimeContent,
  'MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION'
);
const backendSupportedSchemaVersion = parseConstant(
  backendRuntimeContent,
  'SUPPORTED_SCHEMA_VERSION'
);
const backendLegacyFloorVersion = parseConstant(
  backendRuntimeContent,
  'LEGACY_SCHEMA_FLOOR_VERSION'
);
const stepMatches = [
  ...migrationLedgerContent.matchAll(/fromVersion:\s*(\d+),[\s\S]*?toVersion:\s*(\d+)/g),
];
const firstLedgerFromVersion = stepMatches[0] ? Number(stepMatches[0][1]) : null;
const lastLedgerToVersion = stepMatches.at(-1) ? Number(stepMatches.at(-1)[2]) : null;

if (
  ![
    clientVersion,
    backendVersion,
    minBackendVersion,
    minClientVersion,
    currentSchemaVersion,
    legacySchemaVersion,
    backendRuntimeVersionFromFunctions,
    minClientVersionFromFunctions,
    backendSupportedSchemaVersion,
    backendLegacyFloorVersion,
  ].every(Number.isInteger)
) {
  console.error('[runtime-contracts] Missing runtime contract constants.');
  process.exit(1);
}

if (backendVersion < minBackendVersion) {
  console.error(
    `[runtime-contracts] BACKEND_RUNTIME_CONTRACT_VERSION (${backendVersion}) cannot be lower than MIN_SUPPORTED_BACKEND_RUNTIME_CONTRACT_VERSION (${minBackendVersion}).`
  );
  process.exit(1);
}

if (clientVersion < minClientVersion) {
  console.error(
    `[runtime-contracts] CLIENT_RUNTIME_CONTRACT_VERSION (${clientVersion}) cannot be lower than MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION (${minClientVersion}).`
  );
  process.exit(1);
}

if (backendRuntimeVersionFromFunctions !== backendVersion) {
  console.error(
    `[runtime-contracts] functions runtime backend contract (${backendRuntimeVersionFromFunctions}) must match src/constants/runtimeContracts.ts (${backendVersion}).`
  );
  process.exit(1);
}

if (minClientVersionFromFunctions !== minClientVersion) {
  console.error(
    `[runtime-contracts] functions runtime min client contract (${minClientVersionFromFunctions}) must match src/constants/runtimeContracts.ts (${minClientVersion}).`
  );
  process.exit(1);
}

if (backendSupportedSchemaVersion !== currentSchemaVersion) {
  console.error(
    `[runtime-contracts] functions supported schema (${backendSupportedSchemaVersion}) must match CURRENT_SCHEMA_VERSION (${currentSchemaVersion}).`
  );
  process.exit(1);
}

if (backendLegacyFloorVersion !== legacySchemaVersion) {
  console.error(
    `[runtime-contracts] functions legacy schema floor (${backendLegacyFloorVersion}) must match LEGACY_SCHEMA_VERSION (${legacySchemaVersion}).`
  );
  process.exit(1);
}

if (
  firstLedgerFromVersion !== legacySchemaVersion ||
  lastLedgerToVersion !== currentSchemaVersion
) {
  console.error(
    `[runtime-contracts] migration ledger must span legacy v${legacySchemaVersion} to current v${currentSchemaVersion}.`
  );
  process.exit(1);
}

// Schema migrators: exactly one per step from LEGACY_SCHEMA_VERSION to CURRENT_SCHEMA_VERSION.
if (legacySchemaVersion > currentSchemaVersion) {
  console.error(
    `[runtime-contracts] LEGACY_SCHEMA_VERSION (${legacySchemaVersion}) cannot be greater than CURRENT_SCHEMA_VERSION (${currentSchemaVersion}).`
  );
  process.exit(1);
}

const registryBlock = fs
  .readFileSync(path.join(workspaceRoot, 'src/services/repositories/schemaGovernance.ts'), 'utf8')
  .match(
    /const schemaMigrators\s*:\s*Record<number,\s*SchemaMigrator>\s*=\s*\{([\s\S]*?)\n\};/
  )?.[1];
if (registryBlock === undefined) {
  console.error(
    '[runtime-contracts] schemaMigrators registry not found in src/services/repositories/schemaGovernance.ts.'
  );
  process.exit(1);
}
const configuredKeys = [...registryBlock.matchAll(/^\s*(\d+)\s*:/gm)]
  .map(match => Number(match[1]))
  .sort((a, b) => a - b);
const expectedKeys = Array.from(
  { length: currentSchemaVersion - legacySchemaVersion },
  (_, index) => legacySchemaVersion + index
);
const missingKeys = expectedKeys.filter(key => !configuredKeys.includes(key));
const extraKeys = configuredKeys.filter(key => !expectedKeys.includes(key));
if (missingKeys.length > 0 || extraKeys.length > 0) {
  console.error(
    `[runtime-contracts] Invalid schemaMigrators registry: add a migrator for each version in [${expectedKeys.join(', ')}] (missing [${missingKeys.join(', ')}], extra [${extraKeys.join(', ')}]).`
  );
  process.exit(1);
}

const repositoryReadme = fs.readFileSync(
  path.join(workspaceRoot, 'src/services/repositories/README.md'),
  'utf8'
);
const missingReadmeTerms = [
  'schemaEvolutionPolicy.ts',
  'migrationLedger.ts',
  'dataMigration.ts',
].filter(term => !repositoryReadme.includes(term));
if (missingReadmeTerms.length > 0) {
  console.error(
    `[runtime-contracts] src/services/repositories/README.md must still name ${missingReadmeTerms.join(', ')}.`
  );
  process.exit(1);
}

console.log(
  `[runtime-contracts] OK (client=${clientVersion}, backend=${backendVersion}, min-backend=${minBackendVersion}, min-client=${minClientVersion}, schema=v${currentSchemaVersion}, migrators=[${configuredKeys.join(', ')}])`
);
