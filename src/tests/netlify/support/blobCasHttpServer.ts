import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AlertLedger } from '../../../../netlify/functions/lib/telemetry-alerts/queue';

export const LOCAL_BLOBS_TOKEN = 'local-test-token';
export const BLOB_PATH = '/test-site/site:integration/delivery-ledger';
export const PRIVATE_PROVIDER_ERROR = 'synthetic-provider-secret patient=synthetic-person';
type DiskReceipt = { version: number; ledger: AlertLedger };
type RequestRecord = { method: string; path: string; condition?: string; status: number };

/**
 * Controlled SDK contract fixture, NOT Netlify's emulator or cloud service.
 * BlobsServer 11.0.3 GET omits ETag and its PUT check/write is not atomic.
 * This fixture serializes conditional checks with writes and persists a single
 * versioned JSON file by fsync + rename before acknowledging a successful PUT.
 */
export class BlobCasHttpServer {
  readonly requests: RequestRecord[] = [];
  readonly gmailRequests: Array<{ subject?: string; body?: string; messageId?: string }> = [];
  gmailReplies: Array<number | 'hang'> = [];
  blockTerminalWrites = false;
  failPut?: number;
  blockedWrites = 0;
  url = '';
  private server?: Server;
  private tail: Promise<void> = Promise.resolve();
  private constructor(readonly directory: string) {}

  static async create() {
    const fixture = new BlobCasHttpServer(await mkdtemp(join(tmpdir(), 'hhr-alert-cas-')));
    await fixture.start();
    return fixture;
  }
  async start() {
    if (this.server) throw new Error('fixture_already_started');
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        if (!res.headersSent && !res.destroyed) res.writeHead(500).end('fixture_error');
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('fixture_address_missing');
    this.url = `http://127.0.0.1:${address.port}`;
  }
  async stop() {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    const closed = new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
    server.closeAllConnections();
    await closed;
    await this.tail;
  }
  async dispose() {
    await this.stop();
    await rm(this.directory, { recursive: true, force: true });
  }
  async receipt(): Promise<DiskReceipt | null> {
    try {
      return JSON.parse(await readFile(join(this.directory, 'ledger.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async rawReceipt(): Promise<string> {
    return readFile(join(this.directory, 'ledger.json'), 'utf8');
  }
  private async persist(receipt: DiskReceipt) {
    const temporary = join(this.directory, 'ledger.next');
    const file = await open(temporary, 'w');
    try {
      await file.writeFile(JSON.stringify(receipt));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, join(this.directory, 'ledger.json'));
    const directory = await open(this.directory, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  private async serial(action: () => Promise<void>) {
    const next = this.tail.then(action);
    this.tail = next.catch(() => {});
    await next;
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? '/', 'http://fixture').pathname;
    if (path !== '/gmail' && req.headers.authorization !== `Bearer ${LOCAL_BLOBS_TOKEN}`) {
      res.writeHead(401).end('unauthorized');
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf8');
    if (path === '/gmail' && req.method === 'POST') {
      this.gmailRequests.push(JSON.parse(body));
      const status = this.gmailReplies.shift() ?? 200;
      if (status === 'hang') return; // Deliberately accepted request with no acknowledgement.
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(status === 200 ? '{"id":"synthetic-mail-id"}' : PRIVATE_PROVIDER_ERROR);
      return;
    }
    if (path !== BLOB_PATH) {
      res.writeHead(404).end();
      return;
    }
    await this.serial(async () => {
      const receipt = await this.receipt();
      const etag = receipt ? `"revision-${receipt.version}"` : undefined;
      const record: RequestRecord = {
        method: req.method ?? '',
        path,
        status: 0,
        condition: String(req.headers['if-match'] ?? req.headers['if-none-match'] ?? ''),
      };
      this.requests.push(record);
      const reply = (status: number, data = '', tag = etag) => {
        record.status = status;
        res.writeHead(status, {
          'content-type': 'application/json',
          ...(tag ? { ETag: tag } : {}),
        });
        res.end(data);
      };
      if (req.method === 'GET') {
        if (!receipt) reply(404);
        else if (req.headers['if-none-match'] === etag) reply(304);
        else reply(200, JSON.stringify(receipt.ledger));
        return;
      }
      if (req.method !== 'PUT') {
        reply(405);
        return;
      }
      if (this.failPut !== undefined) {
        reply(this.failPut, PRIVATE_PROVIDER_ERROR);
        return;
      }
      if (
        (req.headers['if-none-match'] === '*' && receipt) ||
        (req.headers['if-match'] && req.headers['if-match'] !== etag)
      ) {
        reply(412);
        return;
      }
      if (!req.headers['if-match'] && req.headers['if-none-match'] !== '*') {
        reply(428);
        return;
      }
      const ledger = JSON.parse(body) as AlertLedger;
      if (this.blockTerminalWrites && ledger.jobs.some(job => job.state === 'sent')) {
        this.blockedWrites++;
        record.status = 0;
        res.destroy(); // No receipt commit, including every SDK transport retry.
        return;
      }
      const version = (receipt?.version ?? 0) + 1;
      await this.persist({ version, ledger });
      reply(200, '', `"revision-${version}"`);
    });
  }
}
