const { contextBridge, ipcRenderer } = require('electron');

// Exponer API segura al renderer
contextBridge.exposeInMainWorld('kickAPI', {
  // Verificar estado de un stream
  checkStream: (streamerName) => ipcRenderer.invoke('check-stream', streamerName),
  
  // Abrir stream en Brave
  openStream: (streamerName) => ipcRenderer.invoke('open-stream', streamerName),
  
  // Iniciar monitoreo
  startMonitoring: (config) => ipcRenderer.invoke('start-monitoring', config),
  
  // Detener monitoreo
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  
  // Obtener estado del monitoreo
  getMonitoringStatus: () => ipcRenderer.invoke('get-monitoring-status'),
  
  // Escuchar actualizaciones de streams
  onStreamUpdate: (callback) => {
    ipcRenderer.on('stream-update', (event, data) => callback(data));
  }
});

// API de Predicciones CS2
contextBridge.exposeInMainWorld('predictionsAPI', {
  analyzeMatch: (team1, team2) => ipcRenderer.invoke('analyze-match', team1, team2),
  scrapeForg1: () => ipcRenderer.invoke('scrape-forg1-predictions'),
  autoAnalyze: () => ipcRenderer.invoke('auto-analyze-predictions'),
  openForg1Login: () => ipcRenderer.invoke('forg1-login')
});
