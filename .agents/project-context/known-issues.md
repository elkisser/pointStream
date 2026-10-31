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
**Estado:** ✅ RESUELTO en Fase 5

### Root Cause
- `build/generate-installer-art.js` original generaba BMPs programáticos con círculos y patrones geométricos genéricos sin usar el imagotipo oficial de PointStream.
- `package.json` script `art` llamaba a `node` en vez de `electron`, impidiendo utilizar `nativeImage` de Electron para manipulación y escalado de imágenes de alta fidelidad sin dependencias nativas complejas.
- El nombre del artefacto era genérico (`pointStream-Setup-${version}.${ext}`) en vez de la convención formal de Windows (`PointStream-${version}-Setup.exe`).

### Fix aplicado (Fase 5)
1. **Rediseño integral de `generate-installer-art.js`:**
   - Consume directamente el logo oficial de alta definición `assets/icon_hd.png` (860 KB).
   - Utiliza `nativeImage` de Electron para escalado bicúbico (`quality: 'best'`) y composición de pixeles BGRA.
   - Aplica la paleta oficial de PointStream: fondo oscuro espacial `#0b0e0f` (`rgb(11, 14, 15)`), gradiente radial de brillo esmeralda/verde `#53FC18`, y acentos en verde neón.
   - Genera mapas de bits de 24 bits uncompressed `BI_RGB` perfectamente legibles y renderizables por el motor NSIS:
     - `installerSidebar.bmp` (164×314 px): Logo de PointStream centrado con halo de luz y texto de marca con acento `#53FC18`.
     - `installerHeader.bmp` (150×57 px): Logotipo con brillo en el encabezado superior derecho del asistente de instalación.
2. **Hardening de Empaquetado y Distribución (`package.json`):**
   - Script `art`: `electron build/generate-installer-art.js`.
   - `executableName`: `"PointStream"`.
   - `artifactName`: `"PointStream-${version}-Setup.${ext}"`.
   - `asar`: `true` activado de forma explícita.
   - Optimización de ASAR: Exclusión de `assets/icon_hd.png` y `assets/screenshots/**/*` del empaquetado final, reduciendo el tamaño del bundle sin perder fidelidad visual.
   - Protección de datos del usuario: `deleteAppDataOnUninstall: false` para evitar borrar credenciales, configuraciones o sesiones de usuario tras desinstalar.
   - Output final verificado: `dist/PointStream-1.2.0-Setup.exe` (76.6 MB), 0 alertas en Defender, 0 vulnerabilidades en dependencias de producción.

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
**Estado:** ✅ RESUELTO en Fase 4

### Estado Actual y Solución Implementada
- Se implementó un sistema jerárquico de proveedores de estadísticas CS2:
  `HLTV (Primary) → BO3.gg (Fallback) → UNAVAILABLE`.
- HLTV continúa siendo la fuente primaria sin alteraciones.
- Si HLTV falla (bloqueo Cloudflare, timeout o error de red) o entrega datos insuficientes (`isStatsSufficient` retorna falso), el sistema recurre inmediatamente a BO3.gg.
- BO3.gg se integra a través de su API REST pública oficial (`https://api.bo3.gg/api/v1`) con solicitudes HTTPS nativas sin necesidad de instancias de Chromium adicionales ni sobrecarga de memoria.
- Se implementó una capa de abstracción con contrato común normalizado (`NormalizedCS2Stats`) y función pura de scoring (`calculateMatchupScoring`), desacoplando la lógica matemática del scraping.
- Se preserva el 100% de la matemática predictiva existente (ranking diff, recent winrates, tournament form, H2H, blend 78%/22%).
- Trazabilidad completa (`source: 'hltv' | 'bo3gg'`) reflejada en UI y Telegram.
- Política estricta ZERO FAKE DATA aplicada (valores faltantes representados como `null`, nunca números inventados o defaults engañosos).


---

## ISSUE-005: Sin persistencia de configuración del renderer

**Severidad:** MEDIA
**Estado:** ✅ RESUELTO en Fase 7

### Root Cause (confirmado)
- La lista de streamers (`state.streamers = ['baldu', 'forg1']`) y las preferencias del monitor (`platform`, `interval`, `autoOpen`, `notifications`, `minimize`) residían exclusivamente en la memoria volátil del renderer en `ui/app.js`.
- No existía un canal IPC ni módulo de almacenamiento seguro que leyera o escribiera estas preferencias hacia el disco del usuario.
- Al cerrar y reabrir PointStream, cualquier cambio se descartaba forzando a reingresar los streamers manualmente.

### Solución Implementada (Fase 7)
1. **Módulo de Almacenamiento Atómico (`electron/config-store.js`):**
   - Persiste en `app.getPath('userData')/config.json`.
   - Esquema versionado (`CONFIG_SCHEMA_VERSION = 1`).
   - Validación estricta y sanitización de tipos (Zero Prototype Pollution, nombres de streamers filtrados por regex `^[a-z0-9_\-.]{1,50}$`, max 100 streamers).
   - Escritura atómica (archivo temporal `.tmp` + rename / replace seguro).
   - Resistencia a fallos: ante JSON corrupto, crea automáticamente copia de seguridad `.bak`, loggea advertencia diagnóstica y retorna defaults seguros sin crashear.
2. **Frontera de Seguridad e IPC (`electron/main.js` y `electron/preload.js`):**
   - El proceso principal es el único propietario del acceso al filesystem.
   - Canales expuestos: `config-get`, `config-save`, `config-reset` expuestos en `window.configAPI`.
   - Cero persistencia de secretos: nunca almacena tokens, cookies de sesión de Kick/Forg1/HLTV, passwords ni runtime states volátiles (`isMonitoring` permanece `false` al arrancar para evitar acciones sorpresa de fondo).
3. **Restauración en UI (`ui/app.js`):**
   - `init()` asíncrono carga la configuración persistida antes de renderizar.
   - Sincroniza `state.streamers` y `state.config` y refleja los valores en sliders, checkboxes y temas.
   - Auto-guarda en disco al agregar/remover streamers, cambiar plataforma o modificar intervalos y opciones.
4. **Test Suite:** 17 tests unitarios en `test/config-persistence.test.js` (total del proyecto: 60 tests PASS, 0 FAIL).

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

## ISSUE-008: getH2H usa innerText (frágil) / Contaminación por partidos de terceros

**Severidad:** MEDIA-ALTA
**Estado:** ✅ RESUELTO en Fase 6

### Root Cause (confirmado)
1. **Contaminación de resultados:** La URL `https://www.hltv.org/results?team=${team1Id}&team=${team2Id}` retorna una lista combinada (*OR*) de todos los partidos recientes del Equipo 1 **O** del Equipo 2, no únicamente enfrentamientos directos. Por ejemplo, en una consulta entre Vitality y G2, HLTV entrega 100 partidos donde 98 son contra otros rivales (Vitality vs magic, Legacy vs G2, etc.).
2. **Parsing ingenuo por regex:** El parser anterior tomaba el `innerText` completo de la página sin `extractorBody` y aplicaba `text.match(/\b(\d{1,2})\s*[-:]\s*(\d{1,2})\b/g)` sobre los primeros 10 números, asumiendo erróneamente que cualquier par de dígitos en la página correspondía a un partido directo entre los dos equipos solicitados.
3. **Inversión de local/visitante:** Asumía que el primer score correspondía siempre al Equipo 1, invirtiendo victorias cuando el equipo figuraba como visitante.
4. **Sin deduplicación:** El DOM de HLTV contiene nodos repetidos para vistas responsive.

### Solución Implementada (Fase 6)
1. **Extracción Estructurada del DOM (`extractorBody`):**
   `getH2H()` ahora inyecta una función en el contexto de Chromium que recorre selectores específicos (`.result-con`, `a[href*="/matches/"]`, `.team`, `.result-score`, `.event-name`).
2. **Validación Estricta de Identidad (`parseH2HMatches`):**
   Se normalizan los nombres con `normKey(normalizeTeamName(...))` y se descartan al 100% partidos donde participe un tercer equipo o variantes no equivalentes (evitando falsos positivos por substrings como `Team Liquid` vs `Liquid Academy`).
3. **Manejo de Inversión y Formatos de Serie:**
   Detecta la posición relativa de `team1` y `team2` asignando el puntaje al contendiente correspondiente. En series BO3/BO5 cuenta la serie como 1 victoria de partido directo (no mapas individuales). Empates o scores 0-0 no otorgan victoria espuria.
4. **Deduplicación Canónica:**
   Deduplica por `matchId` obtenido del `href` canónico de HLTV.
5. **Diferenciación de Estados:**
   Distingue explícitamente entre `EMPTY` (`total: 0`, cero enfrentamientos directos) y `FAILED` (fallo de red / Cloudflare).
6. **Preservación Matemática:**
   El contrato `{ total, team1Wins, team2Wins }` y el scoring (+4 pts por victoria) en `cs2-stats-service.js` permanecen 100% idénticos y compatibles.
7. **Test Suite:** 15 pruebas unitarias completas en `test/hltv-h2h.test.js` (total del proyecto: 43 tests PASS, 0 FAIL).

---

## ISSUE-009: Colisión de Cooldown entre Mapas y Pérdida de Contexto de Serie

**Severidad:** ALTA
**Estado:** ✅ RESUELTO en Fase 9.1

### Root Cause (confirmado)
1. **Confusión de Identidades:** Se utilizaba `predictionSignature` de forma intercambiable para la predicción individual y para el match/serie. Cuando Forg1 no emitía UUID explícito, la firma se reducía a `team1::team2` (`vitality::mouz`).
2. **Falso Positivo de Cooldown:** Al cerrarse la predicción del Mapa 1, la firma ingresaba a `recentlyClosed` con un cooldown de 5 minutos. Al comenzar el Mapa 2 entre los mismos equipos (~2-4 min después), PointStream descartaba la nueva predicción considerándola un re-aviso en cooldown.
3. **Ausencia de Entidad Serie:** No existía el concepto de serie en memoria. Cada predicción se evaluaba como un evento aislado sin historial de mapas jugados, formato (BO1/BO3/BO5) ni marcador acumulado (`seriesScore`).

### Solución Implementada (Fase 9.1)
1. **Módulo de Dominio `electron/series-tracker.js`:**
   - Modela la jerarquía `SERIES -> MAPS -> PREDICTIONS`.
   - Estados canónicos de serie: `UNKNOWN`, `UPCOMING`, `LIVE`, `WAITING_NEXT_MAP`, `FINISHED`.
   - Estados canónicos de mapa: `UNKNOWN`, `UPCOMING`, `LIVE`, `PLAYED`.
   - Desacoplamiento de identidades: `predictionSignature` (`forg1::<id>`), `mapSignature` (`${seriesId}_map_${mapNumber}`), `seriesId` (`${teamA}_vs_${teamB}_${date}`).
2. **Corrección de Cooldown en `electron/main.js`:**
   - `recentlyClosed` opera únicamente sobre la identidad única de la predicción, impidiendo que el cierre del Mapa 1 bloquee el Mapa 2 de la misma serie.
   - Cerrar una predicción actualiza la serie a `WAITING_NEXT_MAP`, NUNCA a `FINISHED`.
3. **Persistencia en Runtime y Purga:**
   - La serie conserva el `seriesScore` a través de los mapas.
   - Las series finalizadas se retienen 30 minutos antes de ser purgadas de la memoria.
4. **Zero Fake Data:**
   - Sin 2 equipos válidos, `seriesId = null`. Formato y número de mapa no deducibles permanecen `UNKNOWN` o `null`.
5. **Test Suite:** 20 pruebas unitarias completas en `test/series-tracker.test.js` (total del proyecto: 80 tests PASS, 0 FAIL).
