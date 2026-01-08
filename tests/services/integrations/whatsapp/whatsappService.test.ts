import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    checkBotHealth,
    sendWhatsAppMessage,
    getWhatsAppConfig,
    updateWhatsAppConfig,
    getMessageTemplates,
    saveMessageTemplates,
    formatHandoffMessage,
    saveManualShift
} from '@/services/integrations/whatsapp/whatsappService';
import * as firestore from 'firebase/firestore';

// Mock Firestore
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    collection: vi.fn(),
    addDoc: vi.fn(),
    query: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    onSnapshot: vi.fn(),
    Timestamp: {
        now: vi.fn(() => ({ toMillis: () => Date.now() }))
    }
}));

vi.mock('@/firebaseConfig', () => ({
    db: {}
}));

describe('whatsappService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn());
    });

    describe('Bot Communication', () => {
        it('checks bot health successfully', async () => {
            const mockResponse = { status: 'ok', whatsapp: 'connected' };
            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(mockResponse)
            } as any);

            const health = await checkBotHealth();
            expect(health.status).toBe('ok');
        });

        it('sends a message and logs it', async () => {
            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ messageId: '123' })
            } as any);

            const result = await sendWhatsAppMessage('group1', 'Hello');
            expect(result.success).toBe(true);
            expect(firestore.addDoc).toHaveBeenCalled();
        });
    });

    describe('Configuration and Templates', () => {
        it('returns default config if not found in firestore', async () => {
            vi.mocked(firestore.getDoc).mockResolvedValue({
                exists: () => false
            } as any);

            const config = await getWhatsAppConfig();
            expect(config?.enabled).toBe(true);
        });

        it('updates config in firestore', async () => {
            await updateWhatsAppConfig({ enabled: false });
            expect(firestore.setDoc).toHaveBeenCalledWith(undefined, { enabled: false }, { merge: true });
        });

        it('returns default templates if not found', async () => {
            vi.mocked(firestore.getDoc).mockResolvedValue({
                exists: () => false
            } as any);

            const templates = await getMessageTemplates();
            expect(templates.length).toBeGreaterThan(0);
            expect(templates[0].type).toBe('handoff');
        });
    });

    describe('Formatting', () => {
        it('replaces all placeholders in template', () => {
            const template = 'Date: {{date}}, By: {{signedBy}}, Url: {{handoffUrl}}';
            const data = {
                date: '2025-01-01',
                signedBy: 'Dr. Test',
                signedAt: '12:00',
                hospitalized: 10,
                freeBeds: 5,
                newAdmissions: 1,
                discharges: 1,
                handoffUrl: 'http://hhr.cl'
            };

            const formatted = formatHandoffMessage(template, data);
            expect(formatted).toBe('Date: 2025-01-01, By: Dr. Test, Url: http://hhr.cl');
        });
    });

    describe('Manual Shift Parsing', () => {
        it('parses a valid shift message', async () => {
            const message = 'TURNO PABELLON del 01/01/2025 hasta el 07/01/2025';
            const result = await saveManualShift(message);

            expect(result.success).toBe(true);
            expect(firestore.setDoc).toHaveBeenCalled();
            const logCall = vi.mocked(firestore.setDoc).mock.calls[0];
            expect(logCall[1]).toMatchObject({
                startDate: '2025-01-01',
                endDate: '2025-01-07',
                source: 'manual'
            });
        });

        it('fails if keyword is missing', async () => {
            const result = await saveManualShift('Something else');
            expect(result.success).toBe(false);
            expect(result.error).toContain('turno de pabellón');
        });
    });
});
