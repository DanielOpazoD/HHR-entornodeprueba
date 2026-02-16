import { handler as sendCensusEmailHandler } from '../netlify/functions/send-census-email';
import { generateDemoRecord, formatDateDDMMYYYY } from '../services';
import { getTodayISO } from '../utils/dateUtils';

const run = async () => {
  const today = getTodayISO();
  const demoRecord = generateDemoRecord(today);
  const records = [demoRecord];
  type HandlerEvent = Parameters<typeof sendCensusEmailHandler>[0];

  const event: HandlerEvent = {
    httpMethod: 'POST',
    headers: {
      'x-user-role': 'nurse_hospital',
      'x-user-email': 'local-test@example.com',
    },
    body: JSON.stringify({
      date: today,
      records,
      recipients: process.env.TEST_CENSUS_EMAIL ? [process.env.TEST_CENSUS_EMAIL] : undefined,
      nursesSignature: `Script local - ${formatDateDDMMYYYY(today)}`,
    }),
  };

  const response = await sendCensusEmailHandler(event);
  console.log('Respuesta de prueba:', response);
};

run().catch(err => {
  console.error('Error ejecutando prueba local de envío de correo', err);
  process.exit(1);
});
