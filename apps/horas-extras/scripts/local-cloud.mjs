// Local Firestore emulator only; never accepts a real project or real staff.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { configuredStore } from '../server/firestore.mjs';
import { createApi } from '../server/api.mjs';
import { provisionPerson } from '../server/provision.mjs';
import { initialMonth } from '../src/domain/month.mjs';
if (
  process.env.OVERTIME_FIREBASE_PROJECT_ID !== 'demo-overtime' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8187'
)
  throw new Error('Solo emulador demo-overtime.');
const store = configuredStore();
for (const person of initialMonth().sheets) {
  try {
    await provisionPerson(store, person);
  } catch (error) {
    if (error.status !== 409) throw error;
  }
}
const handler = createApi({ store, origin: 'http://127.0.0.1:8801', secureCookies: false });
createServer(async (req, res) => {
  try {
    const request = new Request(`http://127.0.0.1:8801${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(!['GET', 'HEAD'].includes(req.method)
        ? { body: Readable.toWeb(req), duplex: 'half' }
        : {}),
    });
    const response = await handler(request, { ip: 'local-browser' });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end('Local emulator error');
  }
}).listen(8802, '127.0.0.1', () => console.log('Local API connected to demo-overtime emulator.'));
