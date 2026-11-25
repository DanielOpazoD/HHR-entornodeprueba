const { HttpsError } = require('firebase-functions/v2/https');
const { MANAGED_ASSIGNABLE_ROLES } = require('./authConfig');
const { normalizeEmail } = require('./authEmailUtils');
const { isAdminRole } = require('./rolePredicates');

const assertRoleMutationAccess = async ({ context, resolveRoleForEmail }) => {
  const email = normalizeEmail(context?.auth?.token?.email);
  if (!context?.auth || !email || !isAdminRole(await resolveRoleForEmail(email, context))) {
    throw new HttpsError('permission-denied', 'Only admins can set roles');
  }
};

const parseRoleMutationRequest = data => {
  const rawEmail = typeof data?.email === 'string' ? data.email : '';
  const rawRole = typeof data?.role === 'string' ? data.role : '';

  return { rawEmail, rawRole };
};

const assertAssignableRole = (email, role) => {
  if (!email || !role) {
    throw new HttpsError('invalid-argument', 'Email and role are required');
  }

  if (!MANAGED_ASSIGNABLE_ROLES.has(role)) {
    throw new HttpsError(
      'invalid-argument',
      `Invalid role. Allowed roles: ${Array.from(MANAGED_ASSIGNABLE_ROLES).join(', ')}`
    );
  }
};

module.exports = {
  assertAssignableRole,
  assertRoleMutationAccess,
  parseRoleMutationRequest,
};
