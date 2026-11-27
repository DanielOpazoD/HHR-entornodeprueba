#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const workspaceRoot = process.cwd();
const parseSourceFile = relativePath => {
  const fullPath = path.join(workspaceRoot, relativePath);
  return ts.createSourceFile(
    relativePath,
    fs.readFileSync(fullPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
};

const unwrapExpression = node => {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
};

const readIntegerLiteral = node => {
  const expr = unwrapExpression(node);
  if (!expr) return null;
  if (ts.isNumericLiteral(expr)) {
    const value = Number(expr.text);
    return Number.isInteger(value) ? value : null;
  }
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  ) {
    const value = -Number(expr.operand.text);
    return Number.isInteger(value) ? value : null;
  }
  return null;
};

const readPropertyName = name => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
};

const parseConstant = (sourceFile, name) => {
  let found = null;
  const visit = node => {
    if (found !== null) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      found = readIntegerLiteral(node.initializer);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

const parseMigrationLedgerSteps = sourceFile => {
  const steps = [];
  const visit = node => {
    if (ts.isObjectLiteralExpression(node)) {
      let fromVersion = null;
      let toVersion = null;
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = readPropertyName(property.name);
        if (key === 'fromVersion') fromVersion = readIntegerLiteral(property.initializer);
        if (key === 'toVersion') toVersion = readIntegerLiteral(property.initializer);
      }
      if (Number.isInteger(fromVersion) && Number.isInteger(toVersion)) {
        steps.push({ fromVersion, toVersion });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return steps;
};

const parseSchemaMigratorKeys = sourceFile => {
  let registryObject = null;
  const visit = node => {
    if (registryObject !== null) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'schemaMigrators' &&
      node.initializer
    ) {
      const expr = unwrapExpression(node.initializer);
      if (expr && ts.isObjectLiteralExpression(expr)) {
        registryObject = expr;
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!registryObject) return null;

  const keys = [];
  for (const property of registryObject.properties) {
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isMethodDeclaration(property) &&
      !ts.isShorthandPropertyAssignment(property)
    ) {
      continue;
    }
    const rawKey = readPropertyName(property.name);
    if (rawKey !== null && /^\d+$/.test(rawKey)) {
      keys.push(Number(rawKey));
    }
  }
  return keys.sort((a, b) => a - b);
};

const constantsSource = parseSourceFile('src/constants/runtimeContracts.ts');
const versionSource = parseSourceFile('src/constants/version.ts');
const backendRuntimeSource = parseSourceFile('functions/lib/runtime/runtimeContract.js');
const migrationLedgerSource = parseSourceFile('src/services/repositories/migrationLedger.ts');
const schemaGovernanceSource = parseSourceFile('src/services/repositories/schemaGovernance.ts');

const clientVersion = parseConstant(constantsSource, 'CLIENT_RUNTIME_CONTRACT_VERSION');
const backendVersion = parseConstant(constantsSource, 'BACKEND_RUNTIME_CONTRACT_VERSION');
const minBackendVersion = parseConstant(
  constantsSource,
  'MIN_SUPPORTED_BACKEND_RUNTIME_CONTRACT_VERSION'
);
const minClientVersion = parseConstant(
  constantsSource,
  'MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION'
);
const currentSchemaVersion = parseConstant(versionSource, 'CURRENT_SCHEMA_VERSION');
const legacySchemaVersion = parseConstant(versionSource, 'LEGACY_SCHEMA_VERSION');
const backendRuntimeVersionFromFunctions = parseConstant(
  backendRuntimeSource,
  'BACKEND_RUNTIME_CONTRACT_VERSION'
);
const minClientVersionFromFunctions = parseConstant(
  backendRuntimeSource,
  'MIN_SUPPORTED_CLIENT_RUNTIME_CONTRACT_VERSION'
);
const backendSupportedSchemaVersion = parseConstant(
  backendRuntimeSource,
  'SUPPORTED_SCHEMA_VERSION'
);
const backendLegacyFloorVersion = parseConstant(
  backendRuntimeSource,
  'LEGACY_SCHEMA_FLOOR_VERSION'
);
const ledgerSteps = parseMigrationLedgerSteps(migrationLedgerSource);
const firstLedgerFromVersion = ledgerSteps[0]?.fromVersion ?? null;
const lastLedgerToVersion = ledgerSteps.at(-1)?.toVersion ?? null;

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

const configuredKeys = parseSchemaMigratorKeys(schemaGovernanceSource);
if (configuredKeys === null) {
  console.error(
    '[runtime-contracts] schemaMigrators registry not found in src/services/repositories/schemaGovernance.ts.'
  );
  process.exit(1);
}
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
