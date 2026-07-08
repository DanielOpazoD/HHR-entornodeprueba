# Runbook AI Provider Operations

## Objetivo

Operar y diagnosticar los providers AI usados por búsqueda CIE-10, importación de documentos y resumen clínico.

## Endpoints sensibles

- `netlify/functions/cie10-ai-search.ts`
- `netlify/functions/clinical-ai-summary.ts`
- `netlify/functions/clinical-document-ai-import.ts`
- `netlify/functions/admin-ai-provider-status.ts`
- `netlify/functions/admin-ai-provider-test.ts`

## Variables soportadas

- `AI_PROVIDER=gemini|openai|anthropic|deepseek`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `DEEPSEEK_API_KEY`
- `GEMINI_MODEL`
- `OPENAI_MODEL`
- `ANTHROPIC_MODEL`
- `DEEPSEEK_MODEL`
- `DEEPSEEK_BASE_URL` opcional; default `https://api.deepseek.com`

## Política de resolución

1. Si ADMIN definió routing en `hospitals/{hospitalId}/settings/aiProviderRouting`, usar ese provider para la acción solicitada.
2. Si no hay routing para la acción, usar `AI_PROVIDER`.
3. Si `AI_PROVIDER` no está definido, usar el primer provider configurado.
4. Si la acción selecciona un provider sin llave Netlify, responder como `AI not configured` sin caer silenciosamente a otro provider.

## Checklist operativo

1. Confirmar provider activo, clave presente y routing ADMIN para la acción.
2. Verificar que el usuario tenga rol permitido para el endpoint.
3. Desde ADMIN, usar `Probar` en la acción/proveedor afectado para validar la llave sin exponer secretos.
4. Revisar si el fallo proviene de auth, contexto clínico o provider externo.
5. Si falla DeepSeek, confirmar `DEEPSEEK_API_KEY`, modelo y base URL.
6. Si falla solo Netlify, correr `npm run check:netlify-functions-bundle`.

## Fallos típicos

- `401`: falta `Authorization: Bearer`.
- `403`: rol sin acceso.
- `404`: contexto clínico/paciente no encontrado.
- `502`: prueba de provider fallida o servicio externo no disponible.
- `500`: provider AI o configuración inválida.

## Comandos

```bash
npm run test:risk:platform
npm run report:serverless-runtime-governance
npm run check:serverless-runtime-governance
```
