const {
  auth,
  firestore,
  storage,
  FieldValue,
  Timestamp,
  HOSPITAL_CAPACITY,
} = require('./lib/appContext');
const { createAuthHelpers, createAuthFunctions } = require('./lib/authFunctions');
const { createMinsalFunctions } = require('./lib/minsalFunctions');
const { createHandoffSignatureFunctions } = require('./lib/handoffSignatureFunctions');
const {
  createSpecialistMedicalHandoffFunctions,
} = require('./lib/specialistMedicalHandoffFunctions');
const {
  createDailyRecordWriteAuthorityFunctions,
} = require('./lib/dailyRecordWriteAuthorityFunctions');
const {
  createRayenClinicalEnrichmentFunctions,
} = require('./lib/rayenClinicalEnrichmentFunctions');
const { createClinicalDocumentExportFunctions } = require('./lib/clinicalDocumentExportFunctions');
const {
  createClinicalDocumentPdfRenderFunctions,
} = require('./lib/clinicalDocumentPdfRenderFunctions');
const { createWoundCareMobileUploadFunctions } = require('./lib/woundCareMobileUploadFunctions');
const { createPrescriptionAccessFunctions } = require('./lib/prescriptionAccessFunctions');
const {
  validatePinAgainstConfig,
  resolveUploadPatientOptionForExactDate,
} = require('./lib/prescriptionAccessFunctions');
const { createDocumentScannerFunctions } = require('./lib/documentScannerFunctions');
const {
  createMedicalHandoffSpreadsheetFunctions,
} = require('./lib/medicalHandoffSpreadsheetFunctions');

const authHelpers = createAuthHelpers({ auth, firestore });

module.exports = {
  ...createMinsalFunctions({
    firestore,
    hospitalCapacity: HOSPITAL_CAPACITY,
    hasCallableClinicalAccess: authHelpers.hasCallableClinicalAccess,
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
  }),
  ...createAuthFunctions({
    auth,
    helpers: authHelpers,
  }),
  ...createHandoffSignatureFunctions({
    firestore,
  }),
  ...createSpecialistMedicalHandoffFunctions({
    firestore,
    Timestamp,
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
  }),
  ...createDailyRecordWriteAuthorityFunctions({
    firestore,
    Timestamp,
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
  }),
  ...createRayenClinicalEnrichmentFunctions({
    firestore,
    Timestamp,
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
  }),
  ...createClinicalDocumentExportFunctions({
    firestore,
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
  }),
  ...createClinicalDocumentPdfRenderFunctions({
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
  }),
  ...createWoundCareMobileUploadFunctions({
    firestore,
    storage,
    FieldValue,
  }),
  ...createPrescriptionAccessFunctions({
    firestore,
    storage,
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
  }),
  ...createDocumentScannerFunctions({
    firestore,
    storage,
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
    validatePin: validatePinAgainstConfig,
    resolvePatientOption: resolveUploadPatientOptionForExactDate,
  }),
  ...createMedicalHandoffSpreadsheetFunctions({
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
  }),
};
