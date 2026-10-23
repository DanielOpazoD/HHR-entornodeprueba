const { POLICY } = require('../accounts/accountPolicy');
const { resolveIndividualAccountRole } = require('../accounts/accountAccess');
const { GENERAL_LOGIN_ROLES } = require('./authConfig');
const { normalizeEmail } = require('./authEmailUtils');
const { sanitizeLogValue } = require('../logging/redaction');

const createAuthHelpers = ({ auth, firestore }) => {
  const resolveRoleForEmail = async (email, context) => {
    const individualRole = await resolveIndividualAccountRole(firestore, context);
    if (individualRole !== null) return individualRole;
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) return 'unauthorized';

    try {
      const roleDoc = await firestore.collection('config').doc('roles').get();
      if (roleDoc.exists) {
        const rolesMap = roleDoc.data() || {};
        const resolvedRole = rolesMap[cleanEmail];
        if (resolvedRole === 'viewer_census') {
          return 'viewer';
        }

        if (typeof resolvedRole === 'string' && resolvedRole.trim()) {
          return resolvedRole;
        }
      }
    } catch (error) {
      console.warn(
        'resolveRoleForEmail dynamic lookup failed',
        sanitizeLogValue({ email: cleanEmail, error })
      );
    }

    return 'unauthorized';
  };

  const hasCallableClinicalAccess = async context => {
    if (!context?.auth) return false;

    const callerEmail = normalizeEmail(context.auth.token?.email);
    if (!callerEmail) return false;
    const resolvedRole = await resolveRoleForEmail(callerEmail, context);
    return GENERAL_LOGIN_ROLES.has(resolvedRole);
  };

  const assignRole = async user => {
    // Managed activation publishes its version only after private password establishment.
    if (
      user.uid?.startsWith('hhrn_') ||
      user.providerData?.some(provider => provider.providerId === 'password')
    )
      return 'unauthorized';
    const email = normalizeEmail(user.email);
    const role = await resolveRoleForEmail(email);

    try {
      await auth.setCustomUserClaims(user.uid, { role });
      return role;
    } catch (error) {
      console.error('Error assigning role to user', sanitizeLogValue({ email, error }));
      throw error;
    }
  };

  return {
    normalizeEmail,
    resolveRoleForEmail,
    hasCallableClinicalAccess,
    assignRole,
    isIndividualAccessEnabled: async () =>
      (await firestore.doc(POLICY).get()).data()?.enabled === true,
  };
};

module.exports = {
  createAuthHelpers,
};
