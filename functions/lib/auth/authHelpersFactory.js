const { GENERAL_LOGIN_ROLES } = require('./authConfig');
const { normalizeEmail } = require('./authEmailUtils');
const { sanitizeLogValue } = require('../logging/redaction');

const createAuthHelpers = ({ auth, firestore }) => {
  const resolveRoleForEmail = async email => {
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
    const resolvedRole = await resolveRoleForEmail(callerEmail);
    return GENERAL_LOGIN_ROLES.has(resolvedRole);
  };

  const assignRole = async user => {
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
  };
};

module.exports = {
  createAuthHelpers,
};
