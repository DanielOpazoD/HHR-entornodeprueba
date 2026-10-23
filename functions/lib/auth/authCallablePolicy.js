const functions = require('firebase-functions/v1');
const { MANAGED_ASSIGNABLE_ROLES } = require('./authConfig');
const { normalizeEmail } = require('./authEmailUtils');

const assertRoleMutationAccess = async ({ context, resolveRoleForEmail }) => {
  const email = normalizeEmail(context?.auth?.token?.email);
  if (!context?.auth || !email || (await resolveRoleForEmail(email, context)) !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can set roles');
  }
};

const parseRoleMutationRequest = data => {
  const rawEmail = typeof data?.email === 'string' ? data.email : '';
  const rawRole = typeof data?.role === 'string' ? data.role : '';

  return { rawEmail, rawRole };
};

const assertAssignableRole = (email, role) => {
  if (!email || !role) {
    throw new functions.https.HttpsError('invalid-argument', 'Email and role are required');
  }

  if (!MANAGED_ASSIGNABLE_ROLES.has(role)) {
    throw new functions.https.HttpsError(
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
