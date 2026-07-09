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

El archivo `constants/firebaseEnvironments.ts` contiene:

- Constantes de configuración para cada entorno
- Funciones de validación (`canWriteTo`, `canReadFrom`)
- Función de protección (`validateWriteOperation`)

### Uso:

```typescript
import { validateWriteOperation, BETA_ENVIRONMENT } from './constants/firebaseEnvironments';

// Antes de cualquier operación de escritura:
validateWriteOperation(currentProjectId);
// Lanza error si se intenta escribir en producción
```

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
