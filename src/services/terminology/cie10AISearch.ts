/**
 * AI-Enhanced CIE-10 Search Service
 * 
 * Hybrid approach:
 * - In Netlify: Uses serverless function (API key secured server-side)
 * - In local dev: Uses API key directly from .env
 */

import { GoogleGenAI } from '@google/genai';
import { CIE10Entry } from './cie10SpanishDatabase';
import { aiRequestManager } from '../ai/aiRequestManager';

// Track AI availability
let aiAvailabilityChecked = false;
let aiIsAvailable = false;

/**
 * Check if AI search is available
 */
export function isAIAvailable(): boolean {
    return aiIsAvailable;
}

/**
 * Get API key for local development
 * Access import.meta.env directly so Vite's static replacement works
 */
const getLocalApiKey = (): string | undefined => {
    // Vite replaces these at build time, must be accessed directly
    return import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY || undefined;
};

/**
 * Search CIE-10 using local Gemini API (for development)
 */
async function searchWithLocalAPI(query: string, signal?: AbortSignal): Promise<CIE10Entry[]> {
    const apiKey = getLocalApiKey();
    if (!apiKey) return [];
    if (signal?.aborted) return [];

    try {
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `
Eres un codificador experto de CIE-10 (Clasificación Internacional de Enfermedades, 10a edición) en español, trabajando para el Hospital Hanga Roa en Rapa Nui (Isla de Pascua).

TU TAREA: Dada la consulta del usuario: "${query}", devuelve hasta 8 códigos CIE-10 que mejor representen el diagnóstico clínico.

CONSIDERACIONES CRÍTICAS:
1. ABREVIACIONES MÉDICAS CHILENAS: Interpretación obligatoria:
   - IAM: Infarto agudo del miocardio (I21.9)
   - ACV / AVE: Accidente cerebrovascular (I63.9 o I64)
   - NAC: Neumonía adquirida en la comunidad (J18.9)
   - TVP: Trombosis venosa profunda (I82.4)
   - ITU: Infección del tracto urinario (N39.0)
   - HTA: Hipertensión arterial (I10)
   - DM / DM2: Diabetes mellitus (E11.9)
   - EPOC: Enfermedad pulmonar obstructiva crónica (J44.9)
   - AKI / IRA: Lesión renal aguda (N17.9)
   - TEP: Tromboembolismo pulmonar (I26.9)
   - GEA: Gastroenteritis aguda (A09.9)
   - TEC: Traumatismo encéfalo craneano (S06.9)
   - UPC: Unidad de Paciente Crítico (contexto grave)

2. CONTEXTO RAPA NUI:
   - "Dengue": A90
   - "Zika": A92.8
   - "Mordedura de perro": W54.0

3. CALIDAD DE RESPUESTA:
   - Responde ÚNICAMENTE con un array JSON válido.
   - Cada objeto debe tener: "code", "description" (en español formal), "category" (agregación médica).
   - No incluyas markdown, bloques de código \`\`\`json, ni texto explicativo.

Ejemplo:
[
  {"code": "I21.9", "description": "Infarto agudo del miocardio, sin otra especificación", "category": "Cardiovasculares"},
  {"code": "I10", "description": "Hipertensión esencial (primaria)", "category": "Cardiovasculares"}
]
`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt,
        });

        const text = response.text?.trim() || '';

        // Parse JSON from response
        let jsonText = text;
        if (text.startsWith('```')) {
            const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            jsonText = match ? match[1].trim() : text;
        }

        const parsed = JSON.parse(jsonText);

        if (Array.isArray(parsed)) {
            return parsed.filter(item =>
                item.code &&
                item.description &&
                typeof item.code === 'string' &&
                typeof item.description === 'string'
            ).map(item => ({
                code: item.code,
                description: item.description,
                category: item.category || 'IA'
            }));
        }

        return [];
    } catch (error) {
        console.error('Error in local AI search:', error);
        return [];
    }
}

/**
 * Search CIE-10 using Netlify serverless function
 */
async function searchWithServerlessFunction(query: string, signal?: AbortSignal): Promise<{ available: boolean; results: CIE10Entry[] }> {
    try {
        const response = await fetch('/.netlify/functions/cie10-ai-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
            signal
        });

        if (!response.ok) {
            return { available: false, results: [] };
        }

        const data = await response.json();
        return {
            available: data.available === true,
            results: data.results || []
        };
    } catch {
        return { available: false, results: [] };
    }
}

/**
 * Searches for CIE-10 codes using Gemini AI
 * Uses serverless function in Netlify, or direct API in local dev
 */
export async function searchCIE10WithAI(query: string, signal?: AbortSignal): Promise<CIE10Entry[]> {
    if (!query || query.length < 2) return [];

    return aiRequestManager.enqueue(
        `cie10-${query}`,
        async (innerSignal) => {
            // First try serverless function (Netlify)
            const serverlessResult = await searchWithServerlessFunction(query, innerSignal || signal);

            if (serverlessResult.available) {
                aiAvailabilityChecked = true;
                aiIsAvailable = true;
                return serverlessResult.results;
            }

            // Fallback to local API (development mode)
            const localApiKey = getLocalApiKey();
            if (localApiKey) {
                // console.info('🔧 Using local Gemini API for development');
                aiAvailabilityChecked = true;
                aiIsAvailable = true;
                return searchWithLocalAPI(query, innerSignal || signal);
            }

            // No AI available
            aiAvailabilityChecked = true;
            aiIsAvailable = false;
            return [];
        },
        signal
    );
}

/**
 * Check AI availability
 */
export async function checkAIAvailability(): Promise<boolean> {
    if (aiAvailabilityChecked) {
        return aiIsAvailable;
    }

    // Try serverless function first
    try {
        const response = await fetch('/.netlify/functions/cie10-ai-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: '' })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.available === true) {
                aiAvailabilityChecked = true;
                aiIsAvailable = true;
                return true;
            }
        }
    } catch {
        // Serverless not available
    }

    // Check local API key
    const localApiKey = getLocalApiKey();
    if (localApiKey) {
        aiAvailabilityChecked = true;
        aiIsAvailable = true;
        return true;
    }

    aiAvailabilityChecked = true;
    aiIsAvailable = false;
    return false;
}
