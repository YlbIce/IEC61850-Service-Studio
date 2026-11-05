# 验证记录

验证环境：Windows x64，2026-09-10；Node.js 24.15.0，Electron 39.8.10，MSVC 19.44，libiec61850 1.6.1。

## 自动化结果

| 检查 | 结果 |
|---|---|
| CMake / MSVC 原生后端与 MMS 测试客户端构建 | 通过 |
| JavaScript 语法检查 | 通过 |
| 工程验证与导入预检查单元测试 | 9 / 9 通过 |
| 真实 MMS 连接、LD 发现、FLOAT32 读取 | 通过 |
| 预定义数据集读取、动态数据集创建与删除 | 通过 |
| URCB 与 BRCB 配置/启用/GI 报告接收 | 通过 |
| 直接普通、SBO 普通、直接增强、SBO 增强控制 | 通过 |
| 全局策略拒绝远方控制 | 通过 |
| 在线值、品质位、波形更新 | 通过 |
| 运行中拒绝替换工程、端口冲突反馈 | 通过 |
| 无管理令牌的 gRPC 请求拒绝 | 通过 |
| ICD、CID、CFG 导入后真实 MMS 读取 | 通过 |
| 中文 CFG 文件路径读取 | 通过 |
| SCD 多 IED / 访问点选择、IID 导入、无名称 MODEL{ CFG | 通过 |
| 配套 Client Studio 后端真实连接、模型浏览、遥测和数据集读取 | 通过 |
| Electron 原生菜单、配置保存、启停、仿真、标签页、属性选择、改值窗口、ICD 导入与工程内嵌 CFG | 通过 |

## 模型样例

- `examples/genericIO.icd`：100 个模型节点。
- `examples/model.cfg`：140 个模型节点。
- `examples/simpleIO_direct_control.cid`：146 个模型节点。

以上样本来自随附的 libiec61850 分发，代表可重复的开发验证，不代表任意厂商模型均已验证。

## 运行方式与证据

`npm test`、`npm run test:integration`、`npm run test:ui`。额外格式回归：`node scripts/test-import-formats.js`。配套项目测试单独运行 `node scripts/test-companion.js`；它要求客户端的 48650 管理端口空闲，避免影响正在使用的客户端。

截图：`docs/screenshots/workspace.png`、`reports.png`、`imported-model.png`，均由实际 Electron 窗口生成；截图只包含内容区，Windows 原生标题栏/菜单栏不在 `capturePage` 范围内。菜单另由 Electron Menu API 验证。

测试日志：`integration.log` 与 `ui-result.log`。GUI 测试直接写日志文件，修复了测试父进程输出管道关闭时的 EPIPE 弹窗。

## 尚未验证 / 未提供

IEC 一致性认证、厂商大型 SCL 兼容矩阵、BRCB 断线续传与缓冲区压力、长时间连续运行、最大并发负载、MMS 日志数据存储和软件代码签名。文件服务尚需针对目标现场的文件路径/权限策略验收。

因此不能将本记录视为现场投运或标准符合性的认证。

## 属性弹窗与 UI 性能优化（2026-09-10）

移除独立的“模型属性”页，数据对象右键菜单新增“查看数据属性”。验证完整嵌套属性树、展开/折叠、刷新后读取到新值 231.25，以及 ICD 导入对象的属性显示。

实时刷新改为可见单元格和属性值的增量更新；点击选择保留原有行节点；表格使用可视窗口渲染，过滤输入防抖。1 万点合成 UI 基准：包含 1 万数据对象的导航树与点表：首屏约 74 ms，100 次选择约 15 ms，实际渲染 34 个表格行、28 个树行。测试验证滚动能够到达第 9000 项以后；轮询不重建表格。以上为当前机器的合成列表测量，不代表大型 IED 的全部协议性能。


## 0.2.0 原生架构和协议扩展验证

后端从单文件拆成传输、应用引擎、模型、控制、TLS、定值存储与发布器模块；前端拆出编辑器、属性弹窗、虚拟导航树/表格及协议配置模块。全量 MSVC 重建后再次通过 `npm test`（9 项）、`npm run check`、真实 MMS 集成和安全回归。

- `node scripts/test-security.js`：双向 TLS 真实 MMS 读取；未受信客户端与明文拒绝；缺失凭据和证书/私钥不匹配拒绝；TLS 1.3-only 连接通过。
- 同一脚本验证 SG/SE 预约互斥、确认与激活、完整后端进程重启后银行和激活组恢复。写盘目标不可写时确认返回失败，原银行值及编辑预约保留。
- `node scripts/test-publishers.js`：只在隔离 VMnet1 上抓取真实 GOOSE/SV 帧，验证 stNum/sqNum、数据集值、svID/smpCnt、更新值 233.5 与 smpSynch=0。发送统计为驱动接受数，不代表接收端成功；Windows 软件定时不能替代硬实时/硬件同步验收。
- `node scripts/test-ui.js`：原生菜单、模型对象完整属性树、属性值刷新、TLS/发布器/定值配置对话框、1 万对象可视化列表与导航树。
- `node scripts/test-packet-store.js`：100000 条索引记录写入 107688890 字节临时文件，进程私有内存增加 3395584 字节；1000 次随机读取约 24 ms，总约 2150 ms。另验单记录/总量上限、越界不破坏原数据及清空复用。这是存储层测试，不能当作 MMS 解码吞吐或 UI 帧率。

报文抓取与分析的研究目标见 `CAPTURE-REQUIREMENTS.md`；实际实现边界与独立验证见 `capture-window.md` 及 `CAPTURE-VALIDATION.md`。研究目标不等同于已通过的验收项。


最终发行目录回归已通过：实际 ASAR UI、IPC、MMS 启停、Java 转换；移走可选抓包 helper 后主服务仍可运行，恢复后独立窗口的 DLL/TShark 检测通过。见 `final-packaged-test.log`。报文值回放到真实原生引擎的独立集成通过，见 `replay-integration.log`。


## 0.2.1 空定值组修复

定值组数量为 0 的 SGCB 占位配置按无定值组处理，跳过持久化及编辑回调注册。`node scripts/test-no-setting-groups.js` 验证无 SGCB、SG(0 0)、SG(1 0) 均可应用和启动且不创建银行目录；SG(0 2)、SG(3 2) 仍拒绝。修复前已用 SG(0 0) 复现同一 Apply 错误。现有 TLS、定值组确认/激活、跨进程恢复和写盘失败回归通过。


## 0.2.2 启动与抓包窗口修复

- 便携发行改为 ZIP，完整解压一次后直接启动，避免旧 NSIS 单文件包装器每次解压/删除目录。旧模板同一构建使用共享临时目录，因此不再对正在使用的旧版进行并发启动测试。
- 抓包窗口异步等待 loadFile，加载失败清理窗口/helper并向调用方报错；加载中关闭不作为未处理异常。主窗口关闭处理提前注册，初始化发现正在退出时不再显示“启动失败”。
- 空 PCAPNG 与显示过滤结果为空有不同提示；捕获接口默认留空要求明确选择，说明本机 Loopback 与外部接口区别；停止捕获后清除上一个文件的显示过滤器。
- `CAPTURE_UI_LIVE=1 node tests/capture-ui-run.js` 实际 Electron 回归通过：页面加载失败、加载中关闭、空 PCAPNG 提示、显式选择 Loopback → 开始捕获 → 18126 端口真实 MMS → 停止/分析，共 8 条 MMS 帧。测试输出位于 `.tmp/ui-live-*.pcapng`，未抓取生产网络接口。
- 用户提供的 capture.pcapng 经 Capinfos 和 TShark 只读核查：528 字节，0 条报文，接口“本地连接* 12”；文件合法，没有可供解析的数据。无法单凭页面错误截图认定实际捕获失败原因，空文件和页面加载错误分别处理。


最终 0.2.2 ZIP 完整解压到独立测试目录后，实际 ASAR/IPC/后端/Java 转换、MMS 启停、可选组件缺失隔离及 DLL/TShark 检测通过。目录版启动到界面与后端配置就绪本次实测 1518 ms，见 `startup-latest.json`。发行文件校验和见 `release/0.2.2-checksums.json`。
