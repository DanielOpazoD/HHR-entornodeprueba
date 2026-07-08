export const CRITICAL_FIRESTORE_ACCESS_MATRIX = [
  {
    path: 'dailyRecords',
    matchPath: '/dailyRecords/{date}',
    read: 'canReadClinicalData()',
    create: 'canEdit()',
    update: 'canUpdatePersistedDailyRecord()',
    delete: 'isAdmin()',
  },
  {
    path: 'clinicalDocuments',
    matchPath: '/clinicalDocuments/{documentId}',
    read: 'canReadClinicalData()',
    create: 'canWriteClinicalDocument()',
    update: 'canWriteClinicalDocument()',
    delete: 'canDeleteClinicalDocument()',
  },
  {
    path: 'auditLogs',
    matchPath: '/auditLogs/{logId}',
    read: 'canReadAppendOnlyOperationalLog()',
    create: 'canCreateAppendOnlyOperationalLogEntry()',
    update: 'false',
    delete: 'false',
  },
  {
    path: 'transferRequests',
    matchPath: '/transferRequests/{transferId}',
    read: 'canReadClinicalData()',
    create: 'canEdit()',
    update: 'canEdit()',
    delete: 'canEdit()',
  },
  {
    path: 'backupFiles',
    matchPath: '/backupFiles/{fileId}',
    read: 'canReadClinicalData()',
    create: 'canCreateEditableHospitalDocument()',
    update: 'canAdminMaintainHospitalDocument()',
    delete: 'canAdminMaintainHospitalDocument()',
  },
  {
    path: 'patients',
    matchPath: '/patients/{rut}',
    read: 'canReadClinicalData()',
    create: 'canEdit()',
    update: 'canEdit()',
    delete: 'canEdit()',
  },
  {
    path: 'reminders',
    matchPath: '/reminders/{reminderId}',
    read: 'canReadClinicalData()',
    create: 'isAdmin()',
    update: 'isAdmin()',
    delete: 'isAdmin()',
  },
  {
    path: 'prescriptions',
    matchPath: '/prescriptions/{prescriptionId}',
    read: 'canReadClinicalData()',
    create: 'false',
    update: 'canEdit()',
    delete: 'canEdit()',
  },
  {
    path: 'systemHealthUsers',
    matchPath: '/stats/system_health/users/{userId}',
    read: 'canReportSystemHealth()',
    create: 'isValidSystemHealthWrite(userId)',
    update: 'isValidSystemHealthWrite(userId)',
    delete: 'canManageSystemHealthOperations()',
  },
  {
    path: 'systemHealthResolutions',
    matchPath: '/stats/system_health/resolutions/{resolutionId}',
    read: 'canReportSystemHealth()',
    create: 'isValidSystemHealthResolutionWrite()',
    update: 'isValidSystemHealthResolutionWrite()',
    delete: 'false',
  },
  {
    path: 'configRoles',
    matchPath: '/config/roles',
    read: 'isAdmin()',
    create: 'isAdmin()',
    update: 'isAdmin()',
    delete: 'isAdmin()',
  },
  {
    path: 'configPrescriptionsAccess',
    matchPath: '/config/prescriptionsAccess',
    read: 'isAdmin()',
    create: 'false',
    update: 'false',
    delete: 'false',
  },
];

const OPERATIONS = ['read', 'create', 'update', 'delete'];

function findMatchingBrace(source, openBraceIndex) {
  let depth = 0;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];

    if (char === '{') {
      depth += 1;
    }

    if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractMatchBlock(rules, matchPath) {
  const matchToken = `match ${matchPath}`;
  const matchIndex = rules.indexOf(matchToken);

  if (matchIndex < 0) {
    return null;
  }

  const openBraceIndex = rules.indexOf('{', matchIndex + matchToken.length);
  if (openBraceIndex < 0) {
    return null;
  }

  const closeBraceIndex = findMatchingBrace(rules, openBraceIndex);
  if (closeBraceIndex < 0) {
    return null;
  }

  return rules.slice(openBraceIndex + 1, closeBraceIndex);
}

function collectAllowRules(block) {
  const access = {};
  const allowPattern = /allow\s+([^:]+):\s*if\s+([^;]+);/;
  let depth = 0;

  for (const line of block.split('\n')) {
    const trimmedLine = line.trim();
    const match = depth === 0 ? allowPattern.exec(trimmedLine) : null;

    if (match != null) {
      const operations = match[1].split(',').map(operation => operation.trim());
      const condition = match[2].trim();

      for (const operation of operations.flatMap(operation =>
        operation === 'write' ? ['create', 'update', 'delete'] : [operation]
      )) {
        access[operation] = condition;
      }
    }

    depth += (line.match(/{/g) ?? []).length;
    depth -= (line.match(/}/g) ?? []).length;
  }

  return access;
}

export function buildFirestoreRulesCriticalAccessMatrix(rules) {
  return CRITICAL_FIRESTORE_ACCESS_MATRIX.map(({ path, matchPath }) => {
    const block = extractMatchBlock(rules, matchPath);
    const access = block == null ? {} : collectAllowRules(block);

    return {
      path,
      read: access.read ?? null,
      create: access.create ?? null,
      update: access.update ?? null,
      delete: access.delete ?? null,
    };
  }).filter(entry => OPERATIONS.some(operation => entry[operation] !== null));
}

export function findCriticalAccessMatrixDrift(rules) {
  const actualByPath = new Map(
    buildFirestoreRulesCriticalAccessMatrix(rules).map(entry => [entry.path, entry])
  );
  const issues = [];

  for (const expected of CRITICAL_FIRESTORE_ACCESS_MATRIX) {
    const actual = actualByPath.get(expected.path);

    if (actual == null) {
      issues.push(`${expected.path} expected match ${expected.matchPath} but it was not found`);
      continue;
    }

    for (const operation of OPERATIONS) {
      if (actual[operation] !== expected[operation]) {
        issues.push(
          `${expected.path} ${operation} expected ${expected[operation]} but found ${actual[operation]}`
        );
      }
    }
  }

  return issues;
}
