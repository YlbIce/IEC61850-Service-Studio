"use strict";
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function assertTrustedSender(event, window, root) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !==
      pathToFileURL(path.join(root, "src/renderer/index.html")).href
  ) {
    throw new Error("未授权的窗口");
  }
}
module.exports = { assertTrustedSender };
