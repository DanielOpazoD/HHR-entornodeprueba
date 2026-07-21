# Runbook: Laboratorio / Syslab Issues

## Arquitectura

Flujo principal en HHR:

```text
HHR → content-hhr-syslab → extensión Eloísa → sesión Syslab de la LAN (10.4.69.90)
```

La extensión conserva la sesión institucional, valida el RUN devuelto por Syslab y entrega a HHR
solo localizadores de lote opacos con caducidad. Las rutas internas de informes no se exponen a la
aplicación.

El proxy Express/Netlify anterior queda como compatibilidad opcional y solo se usa cuando
`VITE_SYSLAB_API_URL` o `SYSLAB_PROXY_URL` está configurado explícitamente. La aplicación HHR en
`localhost:3000` no es un proxy Syslab.

La búsqueda por RUT externo no incluye un episodio Eloísa que la extensión pueda autorizar. En
Netlify conserva el fallback web; en Vite local requiere `VITE_SYSLAB_API_URL` explícita. Sin esa
configuración, HHR informa cómo habilitar el acceso y no realiza una consulta ambigua.

### Límite de confianza de localhost

La extensión ya habilita su puente clínico de desarrollo para HHR local. El relay Syslab restringe
ese caso al origen exacto `http://localhost:3000`; el runtime vuelve a validar episodio activo, RUN,
lote, pertenencia de cada informe y caducidad. Esto permite probar el flujo real sin exponer rutas o
credenciales Syslab a HHR.

Un proceso local ajeno que controle ese mismo puerto comparte el límite de confianza histórico del
puente HHR. Endurecer de forma común todos los bridges locales requiere una autorización verificable
por la extensión y debe abordarse como PR de seguridad independiente; un nonce visible para la misma
página no resolvería el riesgo. En producción sólo se acepta `https://testinghhr.netlify.app`.

## Síntomas comunes

### "Failed to fetch" al buscar exámenes

**Flujo principal**: confirma que la extensión esté activa, recarga HHR y conecta Syslab desde el
módulo Laboratorio de la extensión en Eloísa.

**Fallback heredado**: si se configuró deliberadamente un proxy Express, confirma que esté activo:

```bash
cd /path/to/API-laboratorioHHR
node server.js
```

Verificar: `curl "${VITE_SYSLAB_API_URL}/api/exams?rut=12345678"`

### "Error interno al procesar el scraping"

**Causa**: Playwright no puede conectar a Syslab (10.4.69.90).

1. Verificar que estás en la red del hospital
2. Probar: `ping 10.4.69.90`
3. Si el portal cambió de URL, actualizar `config/env.js`

### `Unexpected token '<'` o `<!DOCTYPE ... is not valid JSON`

Una página HTML fue interpretada como respuesta del API. Antes ocurría cuando HHR usaba por defecto
`http://localhost:3000`, es decir, consultaba al propio Vite y recibía `index.html`.

El cliente actual ya no asume ese proxy: prioriza la extensión y clasifica HTML, redirecciones de
login, sesión ausente y red no disponible con mensajes accionables. No restaures el fallback
implícito a `localhost:3000`.

### Exámenes vacíos (0 resultados)

**Causa**: El RUT no tiene exámenes o el formato es incorrecto.

- Syslab requiere RUT sin puntos, sin guión, sin dígito verificador
- El sistema limpia automáticamente: "12.345.678-9" → "12345678"
- Verificar directamente en http://10.4.69.90/syslab/

### Parser no reconoce variables

**Causa**: El formato del PDF cambió.

1. Revisar logs: `/path/to/API-laboratorioHHR/logs/raw_extract_*.txt`
2. Comparar texto crudo con regex en `utils/reportParser.js`
3. El parser tiene 4 regex: con pipes, sin pipes, notación científica, cualitativo

### PDF no se ve en el visor

**Causa**: El link del examen está malformado o la sesión expiró.

1. En el flujo principal, comprueba que la sesión Syslab de la extensión siga activa.
2. Actualiza la búsqueda: los lotes de la extensión caducan para proteger al paciente.
3. En el fallback heredado, comprueba que el proxy siga configurado y disponible.

## Variables de entorno

- `VITE_SYSLAB_API_URL` — URL explícita del proxy Express heredado (sin valor por defecto)
- `SYSLAB_BASE_URL` — URL de Syslab en el Express server (default: `http://10.4.69.90/syslab/`)
- `SYSLAB_USER` / `SYSLAB_PASS` — Credenciales de Syslab
