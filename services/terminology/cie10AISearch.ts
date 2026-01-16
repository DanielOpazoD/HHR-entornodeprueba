/**
 * AI-Enhanced CIE-10 Search Service
 * 
 * Uses Gemini AI to suggest CIE-10 codes when local database
 * doesn't have enough matches.
 */

import { GoogleGenAI } from "@google/genai";
import { CIE10Entry } from './cie10SpanishDatabase';

const getApiKey = () => {
    // Try different environment variable formats
    return (import.meta as any).env?.GEMINI_API_KEY ||
        (import.meta as any).env?.API_KEY ||
        process.env.API_KEY ||
        process.env.GEMINI_API_KEY;
};

/**
 * Check if AI search is available (API key configured)
 */
export function isAIAvailable(): boolean {
    return !!getApiKey();
}

/**
 * Searches for CIE-10 codes using Gemini AI
 * @param query The diagnosis text to search for
 * @returns Array of CIE-10 entries suggested by AI
 */
export async function searchCIE10WithAI(query: string): Promise<CIE10Entry[]> {
    const apiKey = getApiKey();

    if (!apiKey) {
        console.warn('Gemini API key not configured, AI search unavailable');
        return [];
    }

    try {
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `
Eres un experto en codificación CIE-10 (Clasificación Internacional de Enfermedades, 10a revisión) en español.

El usuario busca: "${query}"

Responde ÚNICAMENTE con un array JSON de hasta 8 códigos CIE-10 más relevantes para esta búsqueda.
Cada elemento debe tener: code (código CIE-10), description (descripción en español), category (categoría).

Ejemplo de formato de respuesta (solo el JSON, sin texto adicional):
[
  {"code": "J18.9", "description": "Neumonía, no especificada", "category": "Respiratorias"},
  {"code": "J15.9", "description": "Neumonía bacteriana, no especificada", "category": "Respiratorias"}
]

IMPORTANTE: Responde SOLO con el JSON, sin explicaciones ni markdown.
`;

        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: prompt,
        });

        const text = response.text?.trim() || '';

        // Parse JSON from response
        // Handle potential markdown code blocks
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
        console.error('Error in AI CIE-10 search:', error);
        return [];
    }
}
