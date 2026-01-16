import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    checkBotHealth,
    sendWhatsAppMessage,
    getWhatsAppGroups,
    getWhatsAppConfig,
    updateWhatsAppConfig,
    getMessageTemplates,
    getDefaultTemplates,
    formatHandoffMessage,
    saveManualShift
} from '@/services/integrations/whatsapp/whatsappService';
import { getDoc, setDoc, addDoc, getDocs } from 'firebase/firestore';

// Mock Firebase
vi.mock('firebase/firestore', () => ({
    getFirestore: vi.fn(),
    doc: vi.fn(),
    collection: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    addDoc: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    onSnapshot: vi.fn(() => vi.fn()),
    where: vi.fn(),
    Timestamp: {
        now: () => ({ toDate: () => new Date() })
    }
}));

// Mock fetch
global.fetch = vi.fn();

describe('whatsappService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Bot Communication', () => {
        it('should check bot health', async () => {
            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ status: 'ok', whatsapp: 'connected' })
            } as any);

            const health = await checkBotHealth();
            expect(health.status).toBe('ok');
        });

        it('should send a message', async () => {
            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: true, messageId: '123' })
            } as any);

            const result = await sendWhatsAppMessage('group1', 'Hello');
            expect(result.success).toBe(true);
        });

        it('should get WhatsApp groups', async () => {
            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                json: () => Promise.resolve([{ id: 'g1', name: 'Group 1' }])
            } as any);

            const groups = await getWhatsAppGroups();
            expect(groups).toHaveLength(1);
            expect(groups[0].name).toBe('Group 1');
        });
    });

    describe('Configuration and Templates', () => {
        it('should get config from Firestore', async () => {
            vi.mocked(getDoc).mockResolvedValue({
                exists: () => true,
                data: () => ({ enabled: true, groupId: 'g1' })
            } as any);

            const config = await getWhatsAppConfig();
            expect(config?.enabled).toBe(true);
        });

        it('should update config', async () => {
            vi.mocked(setDoc).mockResolvedValue(undefined as any);
            const success = await updateWhatsAppConfig({ enabled: false });
            expect(success).toBe(true);
        });

        it('should get message templates from Firestore', async () => {
            vi.mocked(getDoc).mockResolvedValueOnce({
                exists: () => true,
                data: () => ({ templates: [{ name: 'T1', content: 'C1' }] })
            } as any);

            const templates = await getMessageTemplates();
            expect(templates).toHaveLength(1);
            expect(templates[0].name).toBe('T1');
        });

        it('should return default templates', () => {
            const defaults = getDefaultTemplates();
            expect(defaults.length).toBeGreaterThan(0);
        });
    });

    describe('Formatting and Parsing', () => {
        it('should format handoff message', () => {
            const template = 'Date: {{date}}, Patients: {{hospitalized}}';
            const data = {
                date: '2025-01-01',
                signedBy: 'Dr. Test',
                signedAt: '10:00',
                hospitalized: 20,
                freeBeds: 5,
                newAdmissions: 2,
                discharges: 1,
                handoffUrl: 'http://link'
            };
            const msg = formatHandoffMessage(template, data);
            expect(msg).toContain('2025-01-01');
            expect(msg).toContain('20');
        });

        it('should parse and save manual shift message', async () => {
            const msg = 'Turno PABELLON del 01/01/2025 hasta el 07/01/2025\nLunes: Juan\nMartes: Pedro';
            vi.mocked(addDoc).mockResolvedValue({ id: '123' } as any);

            const result = await saveManualShift(msg);
            expect(result.success).toBe(true);
        });
    });
});
