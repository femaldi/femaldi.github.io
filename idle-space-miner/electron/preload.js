const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("oreLegacy", {
    platform: process.platform,
    isElectron: true,
    quit: () => ipcRenderer.invoke("app:quit"),
    openExternal: (url) => ipcRenderer.invoke("app:openExternal", url)
});