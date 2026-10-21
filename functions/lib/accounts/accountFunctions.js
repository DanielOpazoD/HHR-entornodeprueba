const { createAccountRecovery } = require('./accountRecovery');
const functions = require('firebase-functions/v1');
const { createAccountAdministration } = require('./accountAdministration');
const { createAccountCredentials } = require('./accountCredentials');

const createAccountFunctions = dependencies => {
  const admin = createAccountAdministration(dependencies);
  const credentials = createAccountCredentials(dependencies);
  const recovery = createAccountRecovery({
    ...dependencies,
    finalizePassword: credentials.finalizePassword,
  });
  const callable = (handler, secrets = []) =>
    functions
      .runWith({ timeoutSeconds: 60, maxInstances: 10, secrets })
      .https.onCall(async (data, context) => {
        try {
          return await handler(data, context);
        } catch (error) {
          if (error instanceof functions.https.HttpsError) throw error;
          // Credentials, invitation tokens and provider bodies never reach logs or clients.
          throw new functions.https.HttpsError(
            'internal',
            'No se pudo completar la operación de acceso.'
          );
        }
      });
  return {
    createNursingAccount: callable(admin.createAccount),
    listNursingAccounts: callable(admin.listAccounts),
    manageNursingAccount: callable(admin.manageAccount),
    enableIndividualAccounts: callable(admin.enableIndividualOnly),
    activateNursingAccount: callable(credentials.activateAccount),
    requestNursingPasswordRecovery: callable(recovery.requestRecovery),
    deliverNursingPasswordRecovery: functions
      .runWith({
        timeoutSeconds: 60,
        maxInstances: 10,
        secrets: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'],
      })
      .firestore.document('hhr_account_recovery/{challengeId}')
      .onCreate((_snapshot, context) => recovery.deliverRecovery(context.params.challengeId)),
    resetNursingPassword: callable(recovery.resetPassword),
    signInWithRut: callable(credentials.signInWithRut),
    changeNursingPassword: callable(credentials.changeAccountPassword),
  };
};

module.exports = { createAccountFunctions };
