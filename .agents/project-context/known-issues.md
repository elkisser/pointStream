# PointStream — Problemas Conocidos

> Creado: Fase 0 (2026-09-17) | Actualizado: Fase 1 (2026-09-17)

---

## ISSUE-001: Launcher start_electron.bat

**Severidad:** MEDIA
**Estado:** ✅ RESUELTO en Fase 1

### Root Cause (confirmado)
1. Sin `cd /d "%~dp0"` → CWD arbitrario al hacer doble click
2. `npm` bloqueado desde PowerShell (Execution Policy) → usar `cmd /c npm` o bat en cmd.exe
3. Sin verificación explícita de Node/npm antes de operar
4. Sin verificación de que Electron esté instalado en node_modules

### Fix aplicado (Fase 1)
- `start_electron.bat` reescrito: ahora tiene 121 líneas vs 40 originales
- `cd /d "%~dp0"` como primer paso (línea 11)
- `where node` verifica Node en PATH → error claro con URL de descarga
- `where npm` verifica npm en PATH → error claro
- `if not exist node_modules` → `call npm install` con mensajes de error accionables
- Verificación adicional de `node_modules\.bin\electron.cmd` y `node_modules\electron`
- `call npm start` (en lugar de `npm start`) para capturar errorlevel correctamente
- `exit /b 1` vs `exit /b` en todos los paths de error (códigos explícitos)
- Mensajes de diagnóstico con instrucciones de recuperación manual

---

## ISSUE-002: Instalador sin identidad visual completa

**Severidad:** BAJA-MEDIA
**Estado:** DOCUMENTADO, pendiente

### Análisis
- `installerHeader.bmp`: 25KB (164×314 px típico de NSIS)
- `installerSidebar.bmp`: 154KB (164×314 o 55×55 + sidebar)
- `icon.ico`: 35KB (256×256 PNG embebido en ICO)
- Los BMP se generan con `build/generate-installer-art.js`
- El script genera imágenes programáticas (como generate-icon.js)

**Problema:** Los BMPs generados por código pueden verse genéricos/básicos.
La configuración NSIS en package.json es correcta y referencia estos assets.
El problema está en el contenido visual de los BMPs, no en la configuración.

### Solución Recomendada (NO implementar aún)
Rediseñar `generate-installer-art.js` para usar la paleta visual real de PointStream
(verde #53FC18, fondo #0b0e0f, tipografía Inter) en los BMPs.

---

## ISSUE-003: Kick / Forg1 Login — Pantalla en blanco

**Severidad:** ALTA
**Estado:** ✅ RESUELTO en Fase 2

### Diagnóstico Técnico y Root Cause Confirmado
1. **Cloudflare Turnstile + Detección de Electron en Partition:**
   - La página de login de Forg1 (`https://www.forg1.com/login`) está protegida con Cloudflare Turnstile (`challenges.cloudflare.com/turnstile/v0/api.js`, sitekey `0x4AAAAAADiU0dgg2r5IL2VG`).
   - El formulario POSTea a `/api/auth/kick-start` y el botón "Conectar con Kick" está inhabilitado (`disabled={!turnstileDone}`) hasta que Turnstile emite un token válido.
   - En Electron, las sesiones creadas mediante `partition: 'persist:forg1'` **NO heredan automáticamente** `app.userAgentFallback`. Conservan el User-Agent por defecto que contiene el token `Electron/28.0.0` y `pointStream/1.2.0`.
   - Cloudflare Turnstile detecta la firma de Electron y rechaza resolver el challenge, impidiendo habilitar el botón o provocando errores de script silenciosos que dejan la ventana inoperable/en blanco.
2. **Popups y Aislamiento de Redirecciones OAuth:**
   - Kick OAuth y redirecciones de terceros frecuentemente emiten `window.open` o enlaces con `target="_blank"`.
   - Sin `setWindowOpenHandler`, Electron 28 bloquea la apertura o crea ventanas secundarias no vinculadas a la partición `persist:forg1`, provocando pérdida de la cookie de estado `forg1_oauth` y finalización en `about:blank`.
3. **URL Inicial y Redirección Innecesaria:**
   - El código abría `https://forg1.com`, que produce un HTTP 307 Redirect a `https://www.forg1.com/` (home genérica), forzando al usuario a buscar el botón en lugar de acceder directamente a la vista de login (`https://www.forg1.com/login`).

### Flujo Real Verificado
```
PointStream (ipcRenderer.invoke('forg1-login'))
   ↓
Electron (openForg1Login con partition: 'persist:forg1' y Chrome UA limpio)
   ↓
https://www.forg1.com/login (Direct URL, form POST a /api/auth/kick-start)
   ↓
Cloudflare Turnstile Challenge (pasa limpio con Chrome UA)
   ↓
POST /api/auth/kick-start (Set-Cookie: forg1_oauth, 303 Redirect)
   ↓
https://id.kick.com/oauth/authorize?... (OAuth de Kick)
   ↓
Usuario inicia sesión en Kick
   ↓
Redirect: https://www.forg1.com/api/auth/kick-callback?code=...&state=...
   ↓
Forg1 valida code contra forg1_oauth y emite cookie de sesión
   ↓
Redirect: https://www.forg1.com/me o /predicciones
   ↓
Detección automática en did-navigate (isLoggedIn() === true)
   ↓
Sesión persistida en persist:forg1 para el scraper
```

### Solución Implementada (Fase 2)
1. **Configuración de User-Agent en Partición:**
   Se aplica el User-Agent limpio de Chrome (sin tokens `Electron` ni `pointStream`) directamente a `session.fromPartition('persist:forg1')` tanto en `openForg1Login()` como en `getForg1Window()`.
2. **Manejo de Ventanas y Popups:**
   Se implementó `win.webContents.setWindowOpenHandler` para interceptar cualquier intento de popup hacia `forg1.com` o `kick.com` y redirigirlo inmediatamente a la misma ventana manteniendo la partición `persist:forg1`.
3. **Carga Directa y Detección de Sesión:**
   Se carga directamente `https://www.forg1.com/login`. Se agregó listener en `did-navigate` que evalúa `isLoggedIn()` al retornar a Forg1 y emite un log de confirmación.
4. **Instrumentación y DevTools:**
   Instrumentación completa no invasiva con sanitización de tokens/codes sensibles (`sanitizeUrl`) en `will-navigate`, `will-redirect`, `did-navigate`, `did-finish-load`, `did-fail-load`, `console-message` y `render-process-gone`. DevTools habilitado automáticamente en modo desarrollo (`--dev`).

---

## ISSUE-004: Estadísticas CS2 — Sin fallback de HLTV

**Severidad:** MEDIA
**Estado:** DOCUMENTADO, pendiente implementación

### Estado Actual
- Fuente única: HLTV (scraping con BrowserWindow + Cloudflare bypass)
- Si HLTV no responde (timeout 40s) → `analyzeMatchup` retorna `dataQuality: 'none'`
- La UI muestra "Sin estadísticas de HLTV" y pide conectar HLTV
- NO hay fallback automático a otra fuente

### Estrategia Deseada
```
HLTV
  ↓ (si falla o timeout)
BO3.gg (fuente alternativa a investigar)
  ↓
estadísticas normalizadas al mismo formato
  ↓
prediction engine (sin modificar)
```

### Investigación Pendiente (Fase siguiente)
- Analizar estructura de BO3.gg: ¿tiene ranking, resultados, H2H?
- ¿Es scrappeable con BrowserWindow? ¿Tiene Cloudflare?
- ¿Los datos son suficientemente equivalentes para el prediction engine?
- Definir el contrato de datos normalizados entre HLTV y BO3.gg

### Regla ZERO FAKE DATA
Si ninguna fuente tiene datos → retornar `dataQuality: 'none'` + `INSUFFICIENT_DATA`
NUNCA completar valores faltantes con estimaciones o defaults.

---

## ISSUE-005: Sin persistencia de configuración del renderer

**Severidad:** BAJA
**Estado:** DOCUMENTADO

- La lista de streamers en `ui/app.js` `state.streamers` se pierde al cerrar la app
- Los streamers por defecto `['baldu', 'forg1']` están hardcodeados (línea 3 de app.js)
- No hay localStorage ni archivo de config para el renderer

---

## ISSUE-006: Bug en telegram.unlink()

**Severidad:** BAJA
**Estado:** ✅ RESUELTO en Fase 1

### Root Cause (confirmado)
`pendingCode = null` en línea 157 (versión original) referenciaba una variable que no existe.
El flujo fue refactorizado en algún momento de "código de vinculación" a "polling de /start",
pero esta línea quedó como dead code. En Node.js sin 'use strict' esto crea una variable
global implícita sin error ni warning.

### Fix aplicado (Fase 1)
Eliminado `pendingCode = null` de `unlink()`. La función ahora es:
```js
function unlink() {
  saveConfig({ chatId: '', enabled: false });
  return { ok: true };
}
```
La variable `pendingChatId` (declarada en línea 68) sigue existiendo pero no necesita
limpiarse en unlink — es temporal y se usa solo durante el flujo de vinculación.

---

## ISSUE-007: scrapeForg1 detecta solo 1 predicción / Modelo plano de predicciones

**Severidad:** MEDIA-ALTA
**Estado:** ✅ RESUELTO en Fase 3

### Root Cause (confirmado)
1. **Problema Conceptual de Dominio:** Se asumía incorrectamente que múltiples preguntas u opciones eran predicciones independientes aplanadas en un único array o que solo existía 1 predicción con 2 opciones de ganador.
2. **Estructura Real de Forg1 descubierta:** La SPA de Forg1 (Next.js) consulta el endpoint interno `/api/predictions/state` que expone la estructura real:
   ```text
   Prediction (id, title, status, locks_at, created_at, min_bet, max_bet)
   └── Outcomes / Markets (id, label, position, color, total_points, total_bettors)
   ```
   donde las elecciones pertenecen al mercado y los porcentajes se calculan dinámicamente: `Math.round((total_points / totalPool) * 100) + '%'`.
3. **Parser de Texto Plano de Fallback:** El extractor textual aplanaba todo el texto en un único set de opciones sin agrupar por pregunta/mercado ni soportar múltiples selecciones dinámicas.

### Solución Implementada (Fase 3)
1. **Integración Directa con `/api/predictions/state`:** En la sesión autenticada `persist:forg1`, `scrapeForg1Predictions()` evalúa `fetch('/api/predictions/state', { cache: 'no-store' })` obteniendo el modelo de datos exacto de Forg1.
2. **Modelo Jerárquico Dinámico:**
   `Prediction -> Markets[] -> Selections[]`
   - `Prediction`: `id`, `title`, `question`, `status`, `closesAt`, `locksAt`, `pool`, `players`, `myBet`, `myWin`, `predType`, `teams`, `options`, `markets`
   - `Market`: `id`, `question`, `type`, `status`, `totalPool`, `totalBettors`, `selections`
   - `Selection`: `id`, `name`, `label`, `percentage`, `points`, `bettors`, `color`, `position`
3. **Parser de Texto Plano Renovado:** Capaz de detectar múltiples preguntas como encabezados y agrupar sus opciones respectivas en mercados dinámicos dentro de la misma predicción.
4. **Clasificación Dinámica y Flexible (`classifyPrediction`):** Soporta matchups (ganador de mapa/partido), Overtime (3 opciones), rangos de kills (`1 - 5`, `10-14`), Sí/No y tipos dinámicos.
5. **Identidad Estable (`predictionSignature`):** Prioriza `forg1::${pred.id}` para deduplicación y tracking en `electron/main.js`, sin romperse cuando cambian odds o textos secundarios.
6. **Soporte en Notificaciones y UI:** Telegram (`buildPredictionMessage`) y UI (`renderOneCard`) renderizan múltiples mercados dinámicamente si `markets.length > 1`, preservando 100% la compatibilidad hacia atrás con el layout de 2 equipos cuando corresponde.
7. **Test Suite:** 12 casos (Casos A a L) probados y validados con `pnpm test` (`node --test`). Zero Fake Data garantizado.

---

## ISSUE-008: getH2H usa innerText (frágil)

**Severidad:** BAJA
**Estado:** DOCUMENTADO

En `hltv.js`, `getH2H()` usa `fetchHLTV()` sin extractorBody, obtiene `.text` y aplica regex:
```js
const scores = text.match(/\b(\d{1,2})\s*[-:]\s*(\d{1,2})\b/g) || [];
```
Este regex puede capturar números que no son scores (fechas, IDs, etc.).
