// cudyr and handoff also keep data access behind controllers/use-cases/ports.
export const DATA_ACCESS_RESTRICTION = {
  group: [
    '@/services/repositories/*',
    '@/context/RepositoryContext',
    '@/services/infrastructure/*',
  ],
  message:
    'Usa controllers/use-cases/ports para acceder a datos. No importes repositorios ni infraestructura directo desde UI/feature shell.',
};

export const FEATURES_WITHOUT_DIRECT_DATA_ACCESS = new Set(['cudyr', 'handoff']);

// Glossary enforcement — only terms with zero current usage are banned (see docs/GLOSSARY.md).
// Adding new ones requires first migrating all legitimate uses; otherwise the rule produces noise
// instead of signal.
const GLOSSARY_SYNTAX_RESTRICTIONS = [
  {
    selector: 'Identifier[name="intake"]',
    message: 'Use "admission" / "admisión" instead of "intake" — see docs/GLOSSARY.md',
  },
  {
    selector: 'Identifier[name="swap"]',
    message: 'Use "moveOrCopy" / "bedMovement" instead of "swap" — see docs/GLOSSARY.md',
  },
];

// One session scope: the sender in sessionStorageTransition notifies every listener
// synchronously. Listening to the window message elsewhere brought back reads of the
// previous person twice (clinical explorer, 2026-11-05).
export const SESSION_MESSAGE_RESTRICTION = {
  selector: 'Literal[value="HHR_RAYEN_SESSION_CHANGED"]',
  message:
    'Observa el cambio de sesión con onSessionChange() o useSessionEpoch(), no con el mensaje HHR_RAYEN_SESSION_CHANGED (AGENTS.md).',
};

// A copy of the RUT cleaner compares a passport by its digits as if it were a RUT. The helpers
// that know the difference live in one module.
export const RUT_REGEX_RESTRICTION = {
  selector: 'Literal[regex.pattern=/\\[\\^0-9(kK|Kk|k|K)\\]/]',
  message:
    'No copies la expresión de RUT: usa normalizeRut(), isSameRut(), isSameDocument() o documentIdentityKey() de src/utils/rutUtils.ts (AGENTS.md).',
};

// Identity is patient plus episode (ID-01): only the clinical-episode resolver builds or reads the
// legacy `rut__admission` episode key.
export const EPISODE_KEY_BUILD_RESTRICTION = {
  selector: "TemplateElement[value.raw='__'][tail=false]:not(:first-child)",
  message:
    'No armes una clave `${a}__${b}` a mano: la clave de episodio sale de buildClinicalEpisodeKey() en src/domain/clinical-episode/clinicalEpisode.ts. Si la clave no es clínica, exime el archivo junto a reminderShared.ts en eslint.config.js.',
};

export const EPISODE_KEY_PARSE_RESTRICTION = {
  selector:
    "CallExpression[callee.property.name=/^(split|includes)$/][arguments.0.value='__']:matches([callee.object.name='episodeKey'], [callee.object.property.name='episodeKey'])",
  message:
    'Lee una clave de episodio antigua con isLegacyClinicalEpisodeKey() o parseLegacyClinicalEpisodeKey() de src/domain/clinical-episode/clinicalEpisode.ts.',
};

// The audit loggers are one contract (`AuditLoggers` in src/hooks/useAudit.ts): `AuditContext`
// declared a second copy of it, ~100 lines that drifted apart (2026-11-18).
const AUDIT_LOGGER_NAME =
  '/^log(Event|DebouncedEvent|ViewEvent|PatientCleared|DailyRecord(Created|Deleted)|CudyrModified|HandoffNovedadesModified|MedicalHandoffModified|NurseHandoffModified|ClinicalDocument(Created|Edited|Deleted))$/';

export const AUDIT_CONTRACT_RESTRICTION = {
  selector: `:matches(TSMethodSignature[key.name=${AUDIT_LOGGER_NAME}], TSPropertySignature[key.name=${AUDIT_LOGGER_NAME}] > TSTypeAnnotation > TSFunctionType)`,
  message:
    "No escribas a mano la firma de un registrador de auditoría: tómala de AuditLoggers en src/hooks/useAudit.ts (p. ej. `logEvent: AuditLoggers['logEvent']`).",
};

// The admin pages with tabs share one frame. Four pages had copied its ~40 lines of title bar
// and tab buttons (2026-11-18); a copy starts with the tab button's classes.
export const ADMIN_TABS_FRAME_RESTRICTION = {
  selector:
    "Literal[value='px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5']",
  message:
    'No copies la barra de pestañas de administración: usa AdminTabsShell (src/features/admin/components/internal/AdminTabsShell.tsx) y pásale las pestañas como datos.',
};

// One owner of role decisions (W17-R1): a role compared or listed by hand drifted into copies
// (prescriptions in three files, admin plus nursing in four). A capability is a named predicate in
// src/shared/access, checked by the role truth table.
const ROLE_NAME = '/^(admin|nurse_hospital|editor|viewer|doctor_urgency|doctor_specialist)$/';
const ROLE_DECISION_MESSAGE =
  'No compares ni listes roles a mano: usa un predicado de src/shared/access/operationalAccessPolicy.ts (p. ej. isAdminAppRole, canEditPrescriptions, canAccessAppModuleRoute) o una columna de roleAccessMatrix.ts, o agrega uno con su columna en la tabla de verdad de src/tests/shared/access/operationalAccessPolicy.test.ts (AGENTS.md).';

const ROLE_LITERAL_RESTRICTION = {
  selector: `BinaryExpression[operator=/^[!=]==$/] > Literal[value=${ROLE_NAME}]`,
  message: ROLE_DECISION_MESSAGE,
};

const ROLE_LIST_RESTRICTION = {
  selector: `ArrayExpression > Literal[value=${ROLE_NAME}]`,
  message: ROLE_DECISION_MESSAGE,
};

export const ROLE_RESTRICTIONS = [ROLE_LITERAL_RESTRICTION, ROLE_LIST_RESTRICTION];

const FUNCTIONS_ROLE_DECISION_MESSAGE =
  'No compares ni listes roles a mano en Cloud Functions: usa un predicado de functions/lib/auth/rolePredicates.js (p. ej. isAdminRole, isAdminOrHospitalNurseRole, isClinicalStaffRole).';

export const FUNCTIONS_ROLE_RESTRICTIONS = [
  {
    selector: `BinaryExpression[operator=/^[!=]==$/] > Literal[value=${ROLE_NAME}]`,
    message: FUNCTIONS_ROLE_DECISION_MESSAGE,
  },
  {
    selector: `ArrayExpression > Literal[value=${ROLE_NAME}]`,
    message: FUNCTIONS_ROLE_DECISION_MESSAGE,
  },
];

// «¿Puede escribir este día?» is one predicate per operation (W17-D1): the census and Rayen
// corrections free the administrator, the invalid-episode cleanup binds every role. The window
// itself is computed once, and only those predicates read it.
export const DAY_WINDOW_RESTRICTION = {
  selector: "ImportSpecifier[imported.name='isWithinNurseEditingWindow']",
  message:
    'No uses la ventana de 48 h directamente: elige el predicado de la operación en src/shared/access/censusDayWriteAccessPolicy.ts (canWriteCensusDay, canCleanInvalidEpisodeDay, canApplyPreviousDayCudyr…) o agrega uno ahí; la limpieza de episodio inválido respeta las 48 h también para el administrador (SAVE-04).',
};

// W17-EXIT: CUDYR work leaves for its Functions through one door that asks the operation's
// session guard right before sending; a second transport would skip it.
export const CUDYR_FUNCTIONS_DOOR_RESTRICTION = {
  selector: ":matches(ImportDeclaration, ImportExpression)[source.value='firebase/functions']",
  message:
    'Un llamado CUDYR a Functions sale por callCudyrFunction() de src/services/cudyr/cudyrFunctionsCall.ts, con el guard que la operación capturó al empezar (AGENTS.md: cambio de propietario).',
};

const SOURCE_SYNTAX_RESTRICTIONS = [
  ...GLOSSARY_SYNTAX_RESTRICTIONS,
  SESSION_MESSAGE_RESTRICTION,
  RUT_REGEX_RESTRICTION,
  EPISODE_KEY_BUILD_RESTRICTION,
  EPISODE_KEY_PARSE_RESTRICTION,
  AUDIT_CONTRACT_RESTRICTION,
  ADMIN_TABS_FRAME_RESTRICTION,
  ...ROLE_RESTRICTIONS,
  DAY_WINDOW_RESTRICTION,
];

// One rule option per file: a later config replaces the whole list, so homes omit only their own.
export const syntaxRestrictions = ({ omit = [], add = [] } = {}) => [
  'warn',
  ...SOURCE_SYNTAX_RESTRICTIONS.filter(restriction => !omit.includes(restriction)),
  ...add,
];

// A test day cast through `unknown` keeps compiling when `DailyRecord` changes, so the test can stay
// green with data the app no longer produces.
const DOUBLE_CAST =
  "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']";

export const TEST_DAILY_RECORD_DOUBLE_CAST_RESTRICTION = {
  selector: [
    `${DOUBLE_CAST} > TSTypeReference[typeName.name='DailyRecord']`,
    `${DOUBLE_CAST} > TSArrayType > TSTypeReference[typeName.name='DailyRecord']`,
    `${DOUBLE_CAST} > TSIndexedAccessType TSTypeReference[typeName.name='DailyRecord']`,
  ].join(', '),
  message:
    '«as unknown as DailyRecord» deja la prueba en verde aunque cambie el tipo. Arma el día con DataFactory.createMockDailyRecord (src/tests/factories/DataFactory.ts); si la prueba necesita a propósito un dato incompleto o antiguo, usa asStoredDailyRecordShape.',
};

// Public entrypoints over focused modules: the code lives in those modules, not here again.
export const REEXPORT_ONLY_RESTRICTION = {
  selector: 'Program > :not(ExportNamedDeclaration[source], ExportAllDeclaration)',
  message:
    'Esta entrada pública solo reexporta (`export … from`): escribe el código o el tipo en su módulo enfocado y reexpórtalo aquí.',
};

export const BASE_MODAL_ENTRYPOINT_RESTRICTION = {
  selector:
    "ImportSpecifier[imported.name='createPortal'], TSInterfaceDeclaration, TSTypeAliasDeclaration",
  message:
    'BaseModal es la entrada pública: los tipos van en baseModalContracts.ts y el portal en baseModalContent.tsx.',
};
