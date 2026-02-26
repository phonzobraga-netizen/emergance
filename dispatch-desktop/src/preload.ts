import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("emerganceAPI", {
  getSnapshot: () => ipcRenderer.invoke("emergance:get-snapshot"),
  onState: (callback: (state: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on("emergance:state", handler);
    return () => ipcRenderer.off("emergance:state", handler);
  },
  action: (action: unknown) => ipcRenderer.invoke("emergance:action", action),
  missionFilePath: () => ipcRenderer.invoke("emergance:mission-file")
});