"use strict";
const { dialog } = require("electron");

// Explicit command registry; only this module maps protocol UI actions to RPCs.
function protocolCommands({ window, backend, sendState }) {
  return {
    interfaces: () => backend().call("Interfaces"),
    "setting-banks": () => backend().call("Settings"),
    "change-setting": (arg) => backend().call("ChangeSetting", arg),
    "choose-certificate": async () => {
      const result = await dialog.showOpenDialog(window(), {
        title: "选择 PEM 证书 / 私钥 / CA / CRL",
        properties: ["openFile"],
        filters: [
          { name: "PEM 文件", extensions: ["pem", "crt", "cer", "key", "crl"] },
          { name: "所有文件", extensions: ["*"] },
        ],
      });
      return result.canceled ? null : result.filePaths[0];
    },
    start: async () => {
      await backend().call("Start");
      await sendState();
    },
    stop: async () => {
      await backend().call("Stop");
      await sendState();
    },
    update: (arg) => backend().call("Update", arg),
  };
}
module.exports = { protocolCommands };
