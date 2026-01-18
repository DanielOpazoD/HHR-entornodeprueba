/**
 * AI-Enhanced CIE-10 Search Service
 * 
 * Hybrid approach:
 * - In Netlify: Uses serverless function (API key secured server-side)
 * - In local dev: Uses API key directly from .env
 */

import { GoogleGenAI } from '@google/genai';
import { CIE10Entry } from './cie10SpanishDatabase';

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
 */
const getLocalApiKey = (): string | undefined => {
    try {
        return (import.meta as any).env?.GEMINI_API_KEY ||
            (import.meta as any).env?.API_KEY;
    } catch {
        return undefined;
    }
};

/**
 * Search CIE-10 using local Gemini API (for development)
 */
async function searchWithLocalAPI(query: string): Promise<CIE10Entry[]> {
    const apiKey = getLocalApiKey();
    if (!apiKey) return [];

    try {
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `
Eres un experto en codificación CIE-10 (Clasificación Internacional de Enfermedades, 10a revisión) en español, especializado en terminología médica chilena.

El usuario busca: "${query}"

INTERPRETA el término considerando:
1. ABREVIACIONES MÉDICAS: IAM, NAC, TVP, TEP, AKI, EPOC, ITU, AVE, ACV, HTA, IC, FA, DM, TEC, GEA, etc.
2. TÉRMINOS COLOQUIALES CHILENOS: "presión alta" = hipertensión, "azúcar" = diabetes, "derrame" = ACV, "pulmonia" = neumonía
3. ERRORES ORTOGRÁFICOS COMUNES: "neumonia" = neumonía, "diabetis" = diabetes
4. TÉRMINOS EN INGLÉS: stroke, heart attack, pneumonia, kidney failure

Responde ÚNICAMENTE con un array JSON de hasta 8 códigos CIE-10 más relevantes.
Cada elemento debe tener: code (código CIE-10), description (descripción en español), category (categoría).

Ejemplo de formato de respuesta (solo el JSON, sin texto adicional):
[
  {"code": "J18.9", "description": "Neumonía, no especificada", "category": "Respiratorias"},
  {"code": "J15.9", "description": "Neumonía bacteriana, no especificada", "category": "Respiratorias"}
]

IMPORTANTE: Responde SOLO con el JSON, sin explicaciones ni markdown.
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
async function searchWithServerlessFunction(query: string): Promise<{ available: boolean; results: CIE10Entry[] }> {
    try {
        const response = await fetch('/.netlify/functions/cie10-ai-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
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
export async function searchCIE10WithAI(query: string): Promise<CIE10Entry[]> {
    if (!query || query.length < 2) return [];

    // First try serverless function (Netlify)
    const serverlessResult = await searchWithServerlessFunction(query);

    if (serverlessResult.available) {
        aiAvailabilityChecked = true;
        aiIsAvailable = true;
        return serverlessResult.results;
    }

    // Fallback to local API (development mode)
    const localApiKey = getLocalApiKey();
    if (localApiKey) {
        console.log('🔧 Using local Gemini API for development');
        aiAvailabilityChecked = true;
        aiIsAvailable = true;
        return searchWithLocalAPI(query);
    }

    // No AI available
    aiAvailabilityChecked = true;
    aiIsAvailable = false;
    return [];
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
