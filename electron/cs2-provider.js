// electron/cs2-provider.js
// Interfaces y contratos para proveedores de estadísticas de CS2 (HLTV y BO3.gg)

/**
 * Estados de suficiencia para las fuentes de datos.
 */
const StatsStatus = {
  COMPLETE: 'COMPLETE',         // Ambos equipos encontrados con ranking o historial de partidos
  PARTIAL: 'PARTIAL',           // Al menos un equipo con datos relevantes
  INSUFFICIENT: 'INSUFFICIENT', // Datos insuficientes para el análisis
  FAILED: 'FAILED',             // Error de red, timeout o bloqueo
  UNAVAILABLE: 'UNAVAILABLE'    // Sin datos en ninguna fuente
};

/**
 * Validador del contrato normalizado.
 * Garantiza la política estricta ZERO FAKE DATA.
 */
function createEmptyTeamStats(teamName) {
  return {
    name: teamName,
    found: false,
    ranking: null,
    winrate: null,
    wins: 0,
    losses: 0,
    event: '',
    eventWins: 0,
    eventLosses: 0,
    eventTotal: 0,
    eventFallback: false,
    roster: null
  };
}

function createNormalizedStats({
  source = 'none',
  status = StatsStatus.UNAVAILABLE,
  team1Name = '',
  team2Name = '',
  team1 = null,
  team2 = null,
  h2h = null,
  sharedEvent = null,
  // Partidos recientes individuales (para la card y el modelo enriquecido).
  // Cada objeto: { won, event, opponent, opponentKey, score, dateUnix, format }.
  recentMatches1 = null,
  recentMatches2 = null
}) {
  return {
    source,
    status,
    team1: team1 || createEmptyTeamStats(team1Name),
    team2: team2 || createEmptyTeamStats(team2Name),
    h2h: h2h || { total: 0, team1Wins: 0, team2Wins: 0 },
    sharedEvent: sharedEvent || null,
    recentMatches1: recentMatches1 || null,
    recentMatches2: recentMatches2 || null
  };
}

module.exports = {
  StatsStatus,
  createEmptyTeamStats,
  createNormalizedStats
};
