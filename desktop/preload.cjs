const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('onunDesktop', Object.freeze({
  chooseBackupDirectory: currentPath => ipcRenderer.invoke('onun:choose-backup-directory', currentPath),
}));
