const functions = require('firebase-functions/v1');
const { createAccountAdministration } = require('./accountAdministration');
const { createAccountCredentials } = require('./accountCredentials');

const createAccountFunctions = dependencies => {
  const admin = createAccountAdministration(dependencies);
  const credentials = createAccountCredentials(dependencies);
  const callable = handler =>
    functions
      .runWith({ timeoutSeconds: 60, maxInstances: 10 })
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
    signInWithRut: callable(credentials.signInWithRut),
    changeNursingPassword: callable(credentials.changeAccountPassword),
  };
};

module.exports = { createAccountFunctions };
