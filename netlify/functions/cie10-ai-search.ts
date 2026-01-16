import { GoogleGenAI } from '@google/genai';

interface CIE10Entry {
    code: string;
    description: string;
    category?: string;
}

interface NetlifyEvent {
    httpMethod: string;
    body?: string;
}

const handler = async (event: NetlifyEvent) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Get API key from environment (server-side only, never exposed to client)
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

    if (!apiKey) {
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                available: false,
                results: [],
                message: 'AI not configured'
            })
        };
    }

    try {
        const { query } = JSON.parse(event.body || '{}');

        if (!query || query.length < 2) {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ available: true, results: [] })
            };
        }

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

        let results: CIE10Entry[] = [];
        if (Array.isArray(parsed)) {
            results = parsed.filter(item =>
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

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ available: true, results })
        };

    } catch (error) {
        console.error('Error in AI CIE-10 search:', error);
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                available: true,
                results: [],
                error: 'AI search failed'
            })
        };
    }
};

export { handler };
