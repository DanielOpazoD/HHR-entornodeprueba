const BOT_BASE_URL = (
    process.env.WHATSAPP_BOT_URL ||
    process.env.WHATSAPP_BOT_SERVER ||
    process.env.VITE_WHATSAPP_BOT_URL ||
    ''
).replace(/\/$/, '');

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

const getPathSuffix = (path: string | undefined) => {
    if (!path) return '/';
    const prefix = '/.netlify/functions/whatsapp-proxy';
    const suffix = path.startsWith(prefix) ? path.slice(prefix.length) : path;
    return suffix.startsWith('/') ? suffix : `/${suffix}`;
};

interface NetlifyEvent {
    httpMethod: string;
    headers: Record<string, string | undefined>;
    body: string | null;
    path: string;
    rawQuery?: string;
    isBase64Encoded?: boolean;
    [key: string]: unknown;
}

export const handler = async (event: NetlifyEvent) => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ''
        };
    }

    if (!BOT_BASE_URL) {
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing WHATSAPP_BOT_URL environment variable' })
        };
    }

    const targetPath = getPathSuffix(event.path);
    const query = event.rawQuery ? `?${event.rawQuery}` : '';
    const targetUrl = `${BOT_BASE_URL}${targetPath}${query}`;

    try {
        const headers: Record<string, string> = {};
        const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'];
        if (contentType) {
            headers['Content-Type'] = contentType;
        }

        const authorization = event.headers?.authorization || event.headers?.Authorization;
        if (authorization) {
            headers['Authorization'] = authorization;
        }

        const init: RequestInit = {
            method: event.httpMethod,
            headers
        };

        if (event.body && event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
            init.body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
        }

        const response = await fetch(targetUrl, init);
        const text = await response.text();
        const responseContentType = response.headers.get('content-type') || 'application/json';

        return {
            statusCode: response.status,
            headers: {
                ...corsHeaders,
                'Content-Type': responseContentType
            },
            body: text
        };
    } catch (error: unknown) {
        console.error('WhatsApp proxy error', error);
        return {
            statusCode: 502,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Failed to reach WhatsApp bot server',
                details: error instanceof Error ? error.message : String(error)
            })
        };
    }
};
