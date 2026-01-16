/**
 * AI-Enhanced CIE-10 Search Service
 * 
 * Uses a serverless function to call Gemini AI
 * API key is kept secure on the server side.
 */

import { CIE10Entry } from './cie10SpanishDatabase';

// Track AI availability (checked once on first search)
let aiAvailabilityChecked = false;
let aiIsAvailable = false;

/**
 * Check if AI search is available
 * This is determined by calling the serverless function
 */
export function isAIAvailable(): boolean {
    return aiIsAvailable;
}

/**
 * Searches for CIE-10 codes using Gemini AI via serverless function
 * @param query The diagnosis text to search for
 * @returns Array of CIE-10 entries suggested by AI
 */
export async function searchCIE10WithAI(query: string): Promise<CIE10Entry[]> {
    try {
        const response = await fetch('/.netlify/functions/cie10-ai-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });

        if (!response.ok) {
            console.warn('AI search endpoint not available');
            return [];
        }

        const data = await response.json();

        // Update AI availability status
        if (!aiAvailabilityChecked) {
            aiAvailabilityChecked = true;
            aiIsAvailable = data.available === true;
        }

        return data.results || [];
    } catch (error) {
        console.warn('AI search failed:', error);
        // For local development without Netlify functions
        aiAvailabilityChecked = true;
        aiIsAvailable = false;
        return [];
    }
}

/**
 * Check AI availability by making a test request
 */
export async function checkAIAvailability(): Promise<boolean> {
    if (aiAvailabilityChecked) {
        return aiIsAvailable;
    }

    try {
        const response = await fetch('/.netlify/functions/cie10-ai-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: '' })
        });

        if (response.ok) {
            const data = await response.json();
            aiAvailabilityChecked = true;
            aiIsAvailable = data.available === true;
            return aiIsAvailable;
        }
    } catch {
        // Function not available (local dev without Netlify)
    }

    aiAvailabilityChecked = true;
    aiIsAvailable = false;
    return false;
}
