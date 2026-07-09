const { admin, HOSPITAL_CAPACITY } = require('./lib/appContext');
const { createAuthHelpers, createAuthFunctions } = require('./lib/authFunctions');
const { createMinsalFunctions } = require('./lib/minsalFunctions');
const { createHandoffSignatureFunctions } = require('./lib/handoffSignatureFunctions');
const {
  createSpecialistMedicalHandoffFunctions,
} = require('./lib/specialistMedicalHandoffFunctions');
const {
  createDailyRecordWriteAuthorityFunctions,
} = require('./lib/dailyRecordWriteAuthorityFunctions');
const { createClinicalDocumentExportFunctions } = require('./lib/clinicalDocumentExportFunctions');
const {
  createClinicalDocumentPdfRenderFunctions,
} = require('./lib/clinicalDocumentPdfRenderFunctions');
const { createWoundCareMobileUploadFunctions } = require('./lib/woundCareMobileUploadFunctions');
const { createPrescriptionAccessFunctions } = require('./lib/prescriptionAccessFunctions');

const authHelpers = createAuthHelpers(admin);

module.exports = {
  ...createMinsalFunctions({
    admin,
    hospitalCapacity: HOSPITAL_CAPACITY,
    hasCallableClinicalAccess: authHelpers.hasCallableClinicalAccess,
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
  }),
  ...createAuthFunctions({
    admin,
    helpers: authHelpers,
  }),
  ...createHandoffSignatureFunctions({
    admin,
  }),
  ...createSpecialistMedicalHandoffFunctions({
    admin,
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
  }),
  ...createDailyRecordWriteAuthorityFunctions({
    admin,
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
  }),
  ...createClinicalDocumentExportFunctions({
    admin,
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
  }),
  ...createClinicalDocumentPdfRenderFunctions({
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
  }),
  ...createWoundCareMobileUploadFunctions({
    admin,
  }),
  ...createPrescriptionAccessFunctions({
    admin,
    resolveRoleForEmail: authHelpers.resolveRoleForEmail,
  }),
};
