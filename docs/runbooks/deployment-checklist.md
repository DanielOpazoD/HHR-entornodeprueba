# Runbook: Deployment Checklist

## Pre-deploy

### 1. Verificar tests

```bash
npm run test:ci:unit          # Tests unitarios
npm run test:rules:ci         # Firestore rules
npm run test:release-confidence  # Pack de confianza
```

### 2. Verificar typecheck

```bash
npm run typecheck   # tsc --noEmit para ambos tsconfig
```

### 3. Verificar secrets

```bash
npm run check:secret-leaks    # Escanea por credenciales hardcodeadas
```

### 4. Build

```bash
npm run build       # Vite build
```

## Deploy a Netlify

### Variables de entorno requeridas

- `VITE_FIREBASE_API_KEY` — Firebase API key
- `VITE_FIREBASE_AUTH_DOMAIN` — Firebase auth domain
- `VITE_FIREBASE_PROJECT_ID` — Firebase project ID
- `VITE_FIREBASE_STORAGE_BUCKET` — Firebase storage bucket
- `VITE_FIREBASE_MESSAGING_SENDER_ID` — Firebase messaging sender ID
- `VITE_FIREBASE_APP_ID` — Firebase app ID
- `MMRAD_USERNAME` / `MMRAD_PASSWORD` — Credenciales MMRAD (Netlify Functions)

### Netlify Functions

- Se despliegan automáticamente desde `/netlify/functions/`
- Cada función es un archivo `.ts` que exporta `handler`
- Runtime: Node.js (esbuild bundler)

## Post-deploy

### 1. Verificar funcionalidad crítica

- [ ] Login con Google funciona
- [ ] Censo diario carga correctamente
- [ ] Datos se sincronizan entre dispositivos
- [ ] Botón MMRAD (radiología) conecta
- [ ] Botón Lab (laboratorio) conecta (requiere red hospital + Express server)

### 2. Validación clínica manual mínima

Antes de marcar un release como listo, comprobar en un entorno desplegado los flujos críticos afectados (recarga de censo, movimientos con parches pendientes, documentos clínicos/impresión, entrega de turno, dependencias externas y respaldos/exportaciones).

### 3. Verificar Firestore

- Consola Firebase → Firestore → verificar que documentos se escriben
- Verificar reglas de seguridad aplicadas

## Rollback

1. Netlify dashboard → Deploys → seleccionar deploy anterior → "Publish deploy"
2. Los datos en Firestore NO se rollbackean (son independientes del deploy)
