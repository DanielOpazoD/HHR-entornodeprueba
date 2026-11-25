const ADMIN_OR_HOSPITAL_NURSE_ROLES = new Set(['admin', 'nurse_hospital']);

const CLINICAL_STAFF_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
]);

const DAILY_RECORD_WRITE_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
]);

const CLINICAL_DOCUMENT_PDF_RENDER_ROLES = new Set([
  'admin',
  'doctor_urgency',
  'nurse_hospital',
  'editor',
]);

// Same roles as Netlify's MMRAD_ALLOWED_ROLES (mmrad-session.ts); the parity test keeps them equal.
const MMRAD_ALLOWED_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
  'viewer',
]);

const isAdminRole = role => role === 'admin';
const isHospitalNurseRole = role => role === 'nurse_hospital';
const isAdminOrHospitalNurseRole = role => ADMIN_OR_HOSPITAL_NURSE_ROLES.has(role);
const isClinicalStaffRole = role => CLINICAL_STAFF_ROLES.has(role);
const canWriteDailyRecordRole = role => DAILY_RECORD_WRITE_ROLES.has(role);
const canRenderClinicalDocumentPdfRole = role => CLINICAL_DOCUMENT_PDF_RENDER_ROLES.has(role);
const canAccessMmradRole = role => MMRAD_ALLOWED_ROLES.has(role);

module.exports = {
  ADMIN_OR_HOSPITAL_NURSE_ROLES,
  MMRAD_ALLOWED_ROLES,
  canAccessMmradRole,
  canRenderClinicalDocumentPdfRole,
  canWriteDailyRecordRole,
  isAdminOrHospitalNurseRole,
  isAdminRole,
  isClinicalStaffRole,
  isHospitalNurseRole,
};
