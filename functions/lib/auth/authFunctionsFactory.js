const functions = require('firebase-functions/v1');
const {
  assertAssignableRole,
  assertRoleMutationAccess,
  parseRoleMutationRequest,
} = require('./authCallablePolicy');
const { requireAuthenticatedEmail } = require('./authPolicies');
const { sanitizeLogValue } = require('../logging/redaction');

const applyRoleClaim = async (adminAuth, uid, role) => {
  const userRecord = await adminAuth.getUser(uid);
  const nextClaims = { ...(userRecord.customClaims || {}) };

  if (role) {
    nextClaims.role = role;
  } else {
    delete nextClaims.role;
  }

  await adminAuth.setCustomUserClaims(uid, nextClaims);
};

const createAuthFunctions = ({ auth, helpers }) => ({
  onUserCreated: functions.auth.user().onCreate(async user => helpers.assignRole(user)),
  setUserRole: functions.https.onCall(async (data, context) => {
    assertRoleMutationAccess({ context });

    const { rawEmail, rawRole } = parseRoleMutationRequest(data);
    const email = helpers.normalizeEmail(rawEmail);
    const role = helpers.normalizeEmail(rawRole);
    assertAssignableRole(email, role);

    try {
      const userRecord = await auth.getUserByEmail(email);
      await applyRoleClaim(auth, userRecord.uid, role);
      return { success: true, message: `Role ${role} assigned to ${email}` };
    } catch (error) {
      console.error('Error setting role for user', sanitizeLogValue({ email, error }));
      throw new functions.https.HttpsError('internal', 'Failed to update user role');
    }
  }),
  syncCurrentUserRoleClaim: functions.https.onCall(async (_data, context) => {
    const email = requireAuthenticatedEmail(context);

    try {
      const resolvedRole = await helpers.resolveRoleForEmail(email);
      await applyRoleClaim(
        auth,
        context.auth.uid,
        resolvedRole === 'unauthorized' ? null : resolvedRole
      );
      return {
        role: resolvedRole === 'unauthorized' ? null : resolvedRole,
        synced: true,
      };
    } catch (error) {
      console.error('Error syncing role claim for user', sanitizeLogValue({ email, error }));
      throw new functions.https.HttpsError('internal', 'Failed to sync current user role claim');
    }
  }),
  checkUserRole: functions.https.onCall(async (_data, context) => {
    const email = requireAuthenticatedEmail(context);

    try {
      const role = await helpers.resolveRoleForEmail(email);
      return { role };
    } catch (error) {
      console.error(
        'Discovery error while resolving user role',
        sanitizeLogValue({ email, error })
      );
      throw new functions.https.HttpsError('internal', 'Error retrieving account permissions.');
    }
  }),
});

module.exports = {
  createAuthFunctions,
};
