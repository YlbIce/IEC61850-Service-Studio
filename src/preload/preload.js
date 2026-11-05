const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("studio", {
  command: (name, value) => ipcRenderer.invoke("command", name, value),
  context: (target) => ipcRenderer.invoke("context", target),
  on: (name, callback) => {
    if (!["state", "project", "action", "backend-error"].includes(name)) return;
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(name, listener);
    return () => ipcRenderer.removeListener(name, listener);
  },
});

contextBridge.exposeInMainWorld("appearance", {
  initial: ipcRenderer.sendSync("appearance:read"),
  set: (value) => ipcRenderer.invoke("appearance:set", value),
  onChange: (callback) =>
    ipcRenderer.on("appearance:changed", (_event, value) => callback(value)),
});
