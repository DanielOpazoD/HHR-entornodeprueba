# Despliegue del bot de WhatsApp con Netlify y Railway

Guía paso a paso para usar el botón **Enviar por WhatsApp** con el bot desplegado en Railway y el frontend en Netlify.

## 1) Preparar el bot en Railway
1. **Variables de entorno mínimas** (ejemplos):
   - `RAILWAY_TCP_PROXY_DOMAIN` o dominio público generado por Railway (se usa como base URL). 
   - Variables propias del bot (p. ej. `SESSION_SECRET`, `DATABASE_URL`, etc.).
2. **URL pública del bot**: una vez desplegado, copia la URL HTTPS del bot. Esa URL será `WHATSAPP_BOT_URL`.
3. **Prueba en Railway**: valida que los endpoints respondan:
   - `/health` debe devolver el estado del bot.
   - `/send-message` y `/groups` deben estar accesibles (usa `curl -X GET https://<railway-domain>/groups`).

> Si usas un subdominio propio, configura el DNS y habilita HTTPS en Railway antes de seguir.

## 2) Configurar Netlify (frontend)
1. En **Site settings → Build & deploy → Environment**, agrega:
   - `VITE_WHATSAPP_BOT_URL` = `https://<dominio-del-bot-en-railway>` (sin `/` final). 
   - Opcional: `WHATSAPP_BOT_URL` o `WHATSAPP_BOT_SERVER` (el proxy también los reconoce).
2. **Build**: Netlify ya usa `npm run build` y publica `dist` (ver `netlify.toml`).
3. **Functions**: la función `whatsapp-proxy` está en `netlify/functions/`. No requiere pasos extra; se publica junto al build.
4. **CORS**: el proxy incluye cabeceras CORS; no necesitas configurar orígenes adicionales.

## 3) Cómo funciona el enrutamiento
- El frontend toma `VITE_WHATSAPP_BOT_URL` cuando existe. 
- En producción (Netlify) si la variable falta, usa `/.netlify/functions/whatsapp-proxy` para redirigir al bot.
- En desarrollo local, el fallback es `http://localhost:3001` (puedes cambiarlo con `VITE_WHATSAPP_BOT_URL`).

## 4) Checks rápidos después de desplegar
1. Abre `https://<tu-sitio-netlify>/.netlify/functions/whatsapp-proxy/health` → debe reflejar el `health` del bot en Railway.
2. Desde la UI, usa el botón **Enviar WhatsApp**; si falla, revisa:
   - Que `VITE_WHATSAPP_BOT_URL` esté definida en Netlify.
   - Que el bot en Railway responda a `/send-message`.
   - Logs de Netlify Functions para ver errores del proxy.

## 5) Referencia de variables de entorno
- `VITE_WHATSAPP_BOT_URL`: URL HTTPS del bot (frontend + proxy).
- `WHATSAPP_BOT_URL` / `WHATSAPP_BOT_SERVER`: alias reconocidos por el proxy en Netlify.

## 6) Mantenimiento
- Cada vez que cambies la URL del bot en Railway, actualiza la variable en Netlify y vuelve a desplegar.
- Usa `/health` para monitorear disponibilidad antes de los envíos automáticos o manuales.
