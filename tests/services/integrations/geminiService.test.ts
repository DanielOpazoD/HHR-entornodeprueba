import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateShiftReport } from '@/services/integrations/geminiService';
import { DailyRecord } from '@/types';

// Define the mock function outside so it can be controlled
const mockGenerateContent = vi.fn();

// Mock @google/genai
vi.mock('@google/genai', () => {
    return {
        GoogleGenAI: class {
            models = {
                generateContent: mockGenerateContent
            };
            constructor(config: { apiKey: string }) {
                if (!config || !config.apiKey) {
                    throw new Error("API Key is missing. Please set REACT_APP_GEMINI_API_KEY in your environment.");
                }
            }
        }
    };
});

describe('geminiService', () => {
    const mockRecord: DailyRecord = {
        date: '2025-01-01',
        beds: {
            'R1': {
                bedId: 'R1',
                patientName: 'Patient 1',
                pathology: 'Flu',
                specialty: 'Medicina',
                status: 'Estable',
                age: '30',
                devices: ['VVP'],
                admissionDate: '2025-01-01'
            }
        },
        discharges: [],
        transfers: [],
        lastUpdated: 'now',
        nurses: [],
        activeExtraBeds: [],
        cma: []
    } as any;

    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubEnv('API_KEY', 'mock-key');
        mockGenerateContent.mockResolvedValue({ text: 'AI Response' });
    });

    it('should generate a shift report', async () => {
        const report = await generateShiftReport(mockRecord);
        expect(report).toBe('AI Response');
        expect(mockGenerateContent).toHaveBeenCalled();
    });

    it('should handle missing API key', async () => {
        // We need to bypass the local stub for this test
        vi.stubEnv('API_KEY', '');
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        const report = await generateShiftReport(mockRecord);

        expect(report).toContain('No se pudo generar el reporte');
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('should handle API errors', async () => {
        mockGenerateContent.mockRejectedValueOnce(new Error('AI Failed'));

        const report = await generateShiftReport(mockRecord);
        expect(report).toContain('No se pudo generar el reporte');
    });
});
