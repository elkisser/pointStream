const { contextBridge, ipcRenderer } = require('electron');

// Exponer API segura al renderer
contextBridge.exposeInMainWorld('kickAPI', {
  // Verificar estado de un stream
  checkStream: (streamerName, platform) => ipcRenderer.invoke('check-stream', streamerName, platform),
  
  // Abrir stream en Brave
  openStream: (streamerName, platform) => ipcRenderer.invoke('open-stream', streamerName, platform),
  
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

// API de controles de ventana (barra de título personalizada)
contextBridge.exposeInMainWorld('windowAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onStateChange: (callback) => {
    ipcRenderer.on('window-state', (event, data) => callback(data));
  }
});

// API de Predicciones CS2
contextBridge.exposeInMainWorld('predictionsAPI', {
  analyzeMatch: (team1, team2) => ipcRenderer.invoke('analyze-match', team1, team2),
  scrapeForg1: () => ipcRenderer.invoke('scrape-forg1-predictions'),
  autoAnalyze: () => ipcRenderer.invoke('auto-analyze-predictions'),
  openForg1Login: () => ipcRenderer.invoke('forg1-login'),
  connectHLTV: () => ipcRenderer.invoke('hltv-connect'),

  // Monitoreo de predicciones (avisos de predicción nueva)
  startMonitoring: (config) => ipcRenderer.invoke('start-predictions-monitoring', config),
  stopMonitoring: () => ipcRenderer.invoke('stop-predictions-monitoring'),
  getMonitoringStatus: () => ipcRenderer.invoke('get-predictions-monitoring-status'),
  onUpdate: (callback) => {
    ipcRenderer.on('predictions-update', (event, data) => callback(data));
  }
});
