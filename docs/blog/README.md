# 阅读与复现说明

直接打开 `index.html` 阅读排版版文章，`iec61850-service-studio.md` 是可编辑原稿。所有图片和图表均保存在本目录，无 CDN 或在线字体依赖。点击图可打开原尺寸截图 / SVG。

- `assets/`：19 张实际 Electron 内容区截图。服务和客户端使用独立测试配置，真实 MMS 端口为 18140。发布流截图保持禁用，TLS 截图展示配置界面。
- `diagrams/`：系统架构、数据链路与三张时序图；包含 SVG 和 Mermaid 源文件。
- `examples/`：两个已验证的 Node.js 脚本及本机测试 PCAPNG；分析端口为 18122。
- `sources/`：文章直接引用的源码/文档快照，仅用于核查，不是完整可构建项目。其内部其他相对链接可能需要回到原项目阅读。
- `source-manifest.json`：源码快照的原项目相对路径和 SHA-256。
- `screenshot-manifest.json`：截图说明及采集时间。
- `verification.json`：本次文章附带示例和页面检查结果。

示例需要已构建的完整 Service Studio 工程。在独立资料包中执行前设置：

```powershell
$env:STUDIO_ROOT = 'D:\WORKSPACE\Electron\Iec61850ServiceStudio'
node examples/scenario.js
node examples/export-observations.js examples/sample-mms.pcapng observations.json 18122
```

`scenario.js` 使用自己的后端和 Loopback 18142 端口，结束后清理自己的进程；端口可通过 `STUDIO_MMS_PORT` 设置。导出脚本只离线分析，不向设备写值；已存在的输出文件不会覆盖。

截图由原项目 `scripts/blog-capture.js`、`scripts/blog-client-capture.js`、`scripts/blog-capture-window.js` 采集。主窗口脚本需要同级 Client Studio 和空闲的管理端口 48650。不要在用户工作进程占用该端口时运行它。

图表生成脚本为 `scripts/blog-diagrams.js`，HTML 构建脚本为 `scripts/blog-build.js`。工具依赖独立安装在 `.tmp/blog-tools`，不改产品 package.json：

```powershell
npm install --prefix .tmp/blog-tools mermaid@11.17.2 markdown-it@14 markdown-it-footnote@4
node scripts/blog-build.js
```

Mermaid SVG 已随资料提供，阅读时不需要安装上述依赖。文章没有打包现场用户捕获、证书、私钥或用户配置。源码快照沿用原项目及对应第三方许可证；此资料包不重新授权第三方代码。
