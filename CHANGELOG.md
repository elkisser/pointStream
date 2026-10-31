# Changelog

Todos los cambios notables de PointStream se documentan en este archivo.
El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y se adhiere a [Semantic Versioning](https://semver.org/lang/es/).

## [1.4.0] - 2026-10-31

### Añadido
- **Tercera fuente de estadísticas: ranking oficial de Valve (VRS)**. Se lee de los archivos públicos de Valve en GitHub (sin Cloudflare ni login): puesto mundial, últimos 10 partidos y head to head. Queda guardado en disco para funcionar sin conexión.
- **Card de "a quién apostar" rediseñada**: pick, probabilidad según stats y cálculo del pago estimado (100 / % de la comunidad) contra el mínimo que conviene. Comparación Stats vs Comunidad en barras.
- **Instalador con la identidad de la app**: arte generado con los colores, tipografía e icono de PointStream; páginas de bienvenida y fin en español con fondo oscuro; licencia MIT visible.
- **`SHA256SUMS.txt`** junto a cada release para verificar que el instalador no fue modificado.

### Corregido
- **Telegram no vinculaba**: el `/start` se perdía si otra persona le escribía al bot justo después (se usaba `offset: -1`). Ahora se lee toda la cola, se acepta el código pegado a mano y la espera dura 3 minutos.
- **Avisos de predicciones ya cerradas**: con la API de Forg1 vacía se leía la sección "ÚLTIMOS RESULTADOS" como si fueran abiertas. Ahora solo se avisan predicciones `OPEN`.
- Cada fuente de stats tiene su propio timeout: un HLTV colgado ya no deja sin datos.
- El monitor no arranca una pasada nueva si la anterior sigue en curso (evita avisos duplicados).
- Errores de Telegram legibles (bot bloqueado, chat no encontrado, sin conexión).

---

## [1.3.0] - 2026-09-18

### Añadido
- **Configuración Persistente**: Almacenamiento atómico de configuración de usuario y lista de streamers en `%APPDATA%\PointStream\config.json`, con recuperación automática ante corrupción.
- **Parser Jerárquico Multi-Market**: Modelo de predicciones estructurado (Predicción -> Mercado/Pregunta -> Elecciones/Opciones) para Forg1.
- **Ciclo de Vida de Predicciones**: Distinción de estados (`OPEN`, `WAITING_RESULT`, `RESOLVED`, `UNKNOWN`) previniendo avisos duplicados o apuestas extemporáneas.
- **Proveedor Estadístico BO3.gg Fallback**: Fallback automático y transparente para estadísticas de CS2 cuando HLTV no está disponible o tiene datos insuficientes.
- **Extracción H2H Estructurada en HLTV**: Parsing robusto de enfrentamientos directos Head-to-Head con filtrado por enfrentamiento directo real.

### Mejorado
- **Instalador NSIS Hardened**: Generación de instalador x64 con preservación de configuración en desinstalación (`deleteAppDataOnUninstall: false`), shortcuts validados y banners visuales personalizados.
- **Resiliencia de Red y Login**: Manejo de reconexiones y sesiones persistentes en partición aislada (`persist:forg1`).

### Seguridad
- **Validación Estricta de IPC**: Canales IPC securizados (`config-get`, `config-save`, `config-reset`), validación de esquemas y sanitización de entrada.
- **Aislamiento de Contexto**: `contextIsolation: true`, `nodeIntegration: false`, sin APIs peligrosas en el renderer.
- **Cero Secretos**: Bundle ASAR verificado sin tokens, credenciales ni variables de entorno.

---

## [1.2.0] - 2026-09-17

### Añadido
- Integración de login con Forg1 vía Kick OAuth.
- Parser inicial de predicciones de Forg1.
- Conector básico para HLTV.

---

## [1.1.0] - 2026-09-15

### Añadido
- Monitoreo concurrente de streams para Kick y Twitch.
- Soporte para notificaciones de escritorio.
- Integración opcional de bot de Telegram para alertas remotas.

---

## [1.0.0] - 2026-09-10

### Añadido
- Versión inicial de la aplicación de escritorio PointStream en Electron.