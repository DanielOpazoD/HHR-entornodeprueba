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

console.log(
  `[runtime-contracts] OK (client=${clientVersion}, backend=${backendVersion}, min-backend=${minBackendVersion}, min-client=${minClientVersion}, schema=v${currentSchemaVersion})`
);
