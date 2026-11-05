const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.whenReady().then(async () => {
  try {
    const temp = path.join(root, ".tmp/blog-tools/render.html");
    await fs.writeFile(
      temp,
      `<!doctype html><html><body><script type="module">import mermaid from './node_modules/mermaid/dist/mermaid.esm.min.mjs';mermaid.initialize({startOnLoad:false,htmlLabels:false,securityLevel:'strict',theme:'base',themeVariables:{fontFamily:'Microsoft YaHei,Arial',fontSize:'16px',primaryColor:'#edf3f8',primaryTextColor:'#17222c',primaryBorderColor:'#57748b',lineColor:'#586b7c',secondaryColor:'#f5f5f5',tertiaryColor:'#ffffff',background:'#ffffff'},flowchart:{htmlLabels:false,curve:'linear',nodeSpacing:25,rankSpacing:42},sequence:{useMaxWidth:false,actorMargin:35,messageMargin:24}});window.renderGraph=async(code,id)=>(await mermaid.render(id,code)).svg;</script></body></html>`,
    );
    const win = new BrowserWindow({
      show: false,
      width: 1800,
      height: 1200,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await win.loadFile(temp);
    for (let i = 0; i < 100; i++) {
      if (
        await win.webContents.executeJavaScript(
          'typeof window.renderGraph === "function"',
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const dir = path.join(root, "docs/blog/diagrams");
    for (const file of (await fs.readdir(dir)).filter((f) =>
      f.endsWith(".mmd"),
    )) {
      const code = await fs.readFile(path.join(dir, file), "utf8");
      const svg = await win.webContents.executeJavaScript(
        `window.renderGraph(${JSON.stringify(code)},${JSON.stringify("graph" + file.slice(0, 2))})`,
      );
      await fs.writeFile(path.join(dir, file.replace(".mmd", ".svg")), svg);
      console.log(file);
    }
    win.destroy();
    app.quit();
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
