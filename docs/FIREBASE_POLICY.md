# 🔥 Política de Entornos Firebase

## ⚠️ DECLARACIÓN DE PRINCIPIOS

Este proyecto (**HHR-entornoprueba**) es un **entorno beta/staging** que opera bajo las siguientes reglas estrictas:

---

## 🧪 ENTORNO BETA: `hhr-pruebas`

| Atributo        | Valor         |
| --------------- | ------------- |
| **Project ID**  | `hhr-pruebas` |
| **Lectura**     | ✅ Permitido  |
| **Escritura**   | ✅ Permitido  |
| **Eliminación** | ✅ Permitido  |

Este es el entorno donde se guardan todos los cambios realizados desde este proyecto.
Es seguro experimentar, probar nuevas funcionalidades y modificar datos.

---

## 🏥 ENTORNO PRODUCCIÓN HISTÓRICO: `hospital-hanga-roa`

| Atributo        | Valor                |
| --------------- | -------------------- |
| **Project ID**  | `hospital-hanga-roa` |
| **Lectura**     | ⛔ **PROHIBIDO**     |
| **Escritura**   | ⛔ **PROHIBIDO**     |
| **Eliminación** | ⛔ **PROHIBIDO**     |

Este repo de entorno de prueba ya no debe conectarse a este proyecto Firebase.
No se debe leer, copiar, escribir ni eliminar información desde `hospital-hanga-roa`.

---

## 📊 Flujo de Datos

### Almacenamiento e índices

La política de [control de almacenamiento](FIRESTORE_STORAGE_COST_CONTROL.md)
conserva datos y auditoría, excluye de índices los contenidos que no se consultan
por campo y activa el TTL de las copias de conflicto que ya vencen a las 48 horas.
Los cambios del proyecto publicado se aplican como operación explícita de
metadatos; el despliegue beta no cambia su destino ni sus permisos.

```
┌─────────────────────────────────────┐
│      hhr-pruebas (BETA)             │
│   ─────────────────────────────     │
│   Entorno de desarrollo/pruebas     │
│   ✅ Lectura y escritura            │
└──────────────┬──────────────────────┘
               │
               │ SINCRONIZACIÓN
               ▼
┌─────────────────────────────────────┐
│   IndexedDB (Base de datos local)   │
│   ─────────────────────────────     │
│   Almacenamiento offline            │
└─────────────────────────────────────┘
```

---

## 🛡️ Validación en Código

El bloqueo activo vive en `src/services/storage/legacyfirebase/legacyFirebaseCore.ts`: si
`VITE_LEGACY_FIREBASE_PROJECT_ID` apunta a `hospital-hanga-roa`, `resolveLegacyFirebaseConfig`
devuelve `null` y la app no abre esa conexión. Lo cubre
`src/tests/services/storage/legacyFirebaseCore.test.ts`.

---

## 📁 Archivos de Configuración

| Archivo                  | Entorno              | Uso                                                                                   |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------- |
| `.env`                   | Beta (`hhr-pruebas`) | Desarrollo local                                                                      |
| `.env.staging`           | Beta (`hhr-pruebas`) | Referencia                                                                            |
| `.env.production`        | ⚠️ Producción        | **NO USAR en este proyecto**                                                          |
| `.env.local`             | Tu máquina           | Config local con secretos. Cargado por el dev server **y** por vitest. **gitignored** |
| `.env.development.local` | Solo dev local       | Overrides cargados por `vite` (modo `development`), **NO** por vitest. **gitignored** |

---

## 🖥️ Desarrollo local: auth (COOP)

Al correr `npm run dev` (localhost) hay dos diferencias con producción que conviene conocer:

**1. Auth de Google (COOP).** Producción fija `Cross-Origin-Opener-Policy: unsafe-none` en
`netlify.toml` para que funcione el popup de Firebase Auth. El dev server de Vite ahora emite
la misma cabecera (`vite.config.ts`). Si el inicio de sesión con Google no completa en localhost:

- Activa el flujo por redirect: `VITE_AUTH_PREFER_REDIRECT_ON_LOCALHOST=true`.
- Verifica que `localhost` esté en **Authentication → Settings → Authorized domains** del proyecto.

Síntoma típico: `Cross-Origin-Opener-Policy policy would block the window.close call` en consola,
y el **censo del día no sincroniza** (sin sesión, Firestore deniega la lectura y la app cae al
cache local vacío).

El bridge legacy queda desactivado por defecto con `VITE_LEGACY_COMPATIBILITY_MODE=disabled`.
No configurar `VITE_LEGACY_FIREBASE_*` para `hospital-hanga-roa` en este repositorio.

---

## ⚠️ Advertencias

1. **NUNCA** cambies el `.env` para apuntar a `hospital-hanga-roa`
2. **NUNCA** modifiques `.env.production` para usarlo en desarrollo
3. Si necesitas datos de producción, usa un proceso externo y auditado; este repo no debe leerlos
4. Cualquier lectura o escritura a producción desde este proyecto es un **BUG**

---

_Última actualización: Enero 2026_

### Revisión de permisos para preparar la transición

Los permisos de plantillas propias, indicaciones inmutables y correcciones de
metadatos de recetas se prueban en emulador antes de publicar reglas. Una
corrección de asignación o tipo de receta no autoriza sustituir su fuente de
carga ni atribuirla a otro funcionario. Los permisos existentes de eliminación
manual de recetas y finalización/corrección de traslados se conservan.

La revisión del candidato y el merge no acreditan despliegue ni autorizan por
sí solos una publicación manual; registrar por separado las reglas efectivamente
publicadas y su proyecto de destino.
