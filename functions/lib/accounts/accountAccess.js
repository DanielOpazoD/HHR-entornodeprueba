const { ACCESS, POLICY, hasCurrentAccountSession, protectedRole } = require('./accountPolicy');

// null means the legacy policy applies; unauthorized is a definitive denial.
const resolveIndividualAccountRole = async (firestore, context) => {
  if (!context?.auth?.uid) return null;
  const account = await firestore.collection(ACCESS).doc(context.auth.uid).get();
  if (account.exists) {
    return hasCurrentAccountSession(account.data(), context) ? account.data().role : 'unauthorized';
  }
  if (
    context.auth.uid.startsWith('hhrn_') ||
    context.auth.token?.hhrAccountVersion !== undefined ||
    context.auth.token?.firebase?.sign_in_provider === 'password'
  ) {
    return 'unauthorized';
  }
  const policy = await firestore.doc(POLICY).get();
  return policy.data()?.enabled ? protectedRole(policy.data(), context) || 'unauthorized' : null;
};

module.exports = { resolveIndividualAccountRole };
