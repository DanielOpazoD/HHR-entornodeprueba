# Runbook: Deployment Checklist

## Pre-deploy

### 1. Verificar tests

```bash
npm run test:ci:unit          # Tests unitarios
npm run test:rules:ci         # Firestore rules
npm run test:release-confidence  # Pack de confianza
npm run check:clinical-release-validation # Contrato de validacion clinica manual minima
npm run check:clinical-release-signoff # Debe pasar antes de release productivo
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

Antes de marcar un release como listo, cada escenario crítico debe cerrar tres evidencias: código corregido, regresión automatizada y flujo clínico validado visualmente/manual. El contrato versionado vive en `scripts/config/clinical-release-validation.json` y se valida con:

```bash
npm run check:clinical-release-validation
npm run report:clinical-release-signoff
npm run check:clinical-release-signoff
```

No dupliques escenarios manualmente en este documento. Para agregar, cambiar o retirar un flujo clínico de release, actualiza `scripts/config/clinical-release-validation.json` y conserva los tres cierres obligatorios por escenario:

- `codigo_corregido`
- `regresion_automatizada`
- `flujo_clinico_validado`

El signoff real vive en `scripts/config/clinical-release-signoff.json`. Mientras algún escenario esté en `pending_human_review`, `failed` o `blocked`, `npm run check:clinical-release-signoff` debe fallar. Solo se marca `passed` cuando hay responsable, fecha y evidencia manual/visual revisable.

### 3. Verificar Firestore

- Consola Firebase → Firestore → verificar que documentos se escriben
- Verificar reglas de seguridad aplicadas

## Rollback

1. Netlify dashboard → Deploys → seleccionar deploy anterior → "Publish deploy"
2. Los datos en Firestore NO se rollbackean (son independientes del deploy)

### Aprobación clínica del candidato exacto

El informe histórico no autoriza la versión que se está preparando. Para cerrar
una release, la persona responsable debe completar los escenarios de
`scripts/config/clinical-release-validation.json` sobre el candidato verificado.
El registro usa el esquema de `scripts/config/clinical-release-signoff.json`, pero
`releaseCandidate` debe contener el SHA completo obtenido con `git rev-parse HEAD`.
Cada escenario debe estar `passed`, identificar al responsable real, incluir
`validatedAt` en UTC ISO (por ejemplo `2026-10-05T10:00:00Z`) y una referencia de
evidencia con `type: manual_signoff`. No copiar aprobaciones de versiones anteriores.

Guardar ese JSON **fuera del checkout** y proporcionar su ruta absoluta:

```sh
export CLINICAL_RELEASE_SIGNOFF_FILE=/ruta/externa/aprobacion-clinica.json
npm run check:clinical-release-signoff
npm run check:release-evidence
```

El control rechaza registros ausentes, históricos, de otro SHA, incompletos, con
fechas inválidas/futuras o un checkout modificado. Si el candidato cambia, se
necesita una nueva revisión del responsable; regenerar informes no la reemplaza.
La variable debe apuntar al mismo registro durante el gate de release. No incluir
datos de pacientes en este archivo ni inventar autores, fechas o aprobaciones.

La validación comprueba el contrato del registro y su vínculo al candidato; no es
una firma electrónica ni autentica por sí sola la identidad del revisor. Los PR
de tooling conservan sus controles automáticos normales: su merge no declara
completada una validación clínica ni autoriza una release. El registro histórico
y su generador se conservan sin reescribir los signoffs antiguos.
