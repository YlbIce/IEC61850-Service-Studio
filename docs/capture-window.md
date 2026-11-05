# 独立报文分析窗口

`src/capture/window.js` 导出 `createCaptureWindow({parent,root,resourcesPath,isPackaged,replay})`，异步返回已加载的独立 `BrowserWindow`，调用方需 `await`；加载期间关闭返回 `null`。模块代码、preload 与渲染界面自包含于 `src/capture`。主应用菜单按需调用，缺可选模块不会阻断工程、MMS 服务或其他功能。

开发辅助程序为 `backend/capture/bin/capture-helper.exe`；发布时为 `resources/capture/capture-helper.exe`。Electron 不直接加载分析 DLL，通过隔离辅助进程 JSONL 请求/响应通信。窗口关闭会结束自身辅助进程及它的捕获，不结束主应用服务或系统 Wireshark。

窗口提供原生菜单/工具栏/右键菜单、PCAP/PCAPNG 文件对话框、网络接口与 BPF 捕获过滤器、独立 Wireshark 显示过滤器、非标准 MMS 端口解码、按需分页虚拟报文列表、TCP 会话、MMS 请求/响应跳转、协议树、十六进制字节，以及离线播放/暂停/步进/倍率/定位。拖动时间轴会重建截止选中帧的已观察值，也可手动获取“累计值快照”。显示值包含捕获时间、IED 时间、质量和来源；缺少数据明确显示未知，不补零。大文件分析支持取消。

回放默认为纯离线，不重发原始 TCP 或遥控报文。可选 `replay` 由主应用提供：

- `catalog(): Promise<{running,simulation,points:[{reference,value,quality,blocked}]}>`，仅返回允许的测量点。
- `apply({reference,value,quality}): Promise<unknown>`，主应用再次验证运行状态、目标及仿真冲突。

用户通过回放菜单手工建立捕获引用到测量点的一对一映射，原生确认对话框确认后才允许播放/步进写值。主进程根据帧号重新获取解码数据，拒绝渲染器提供的值或任意目标；仅接受完整、引用已解析、可回放、FC 为 ST/MX 的安全数值或布尔标量。Write 意图、结构、未知引用和不完整值不注入，64 位整数超出 JS 安全范围不转换。重新导入文件、关闭窗口或手工停用会清除授权映射。拖动时间轴只定位查看，不自动写入设备值。

可选依赖状态分别显示 DLL、分析工具、实时捕获能力；实时捕获需要 TShark/dumpcap 与 Npcap。TLS 加密报文在未解密时不能展示 MMS 数据。桌面离线播放受文件解析耗时影响，为尽可能保留每个值，不跳帧伪装实时精度。

播放通过磁盘索引的已观察 MMS 数据事件驱动，跳过不包含可回放值的 TCP/其他帧，不逐帧启动 TShark。报文列表的显示过滤器限定播放范围。累计快照按整个捕获文件的截止帧重建，不受显示过滤器影响；界面按钮提示明确区分两种范围。手动步进仍可逐报文查看协议详情。

验证：`node tests/capture-ui-run.js`。测试使用真实 Electron，检查缺模块窗口隔离、安全 preload、实际 PCAP 导入/协议树/字节区、虚拟列表、原生右键与离线步进。`CAPTURE_UI_FILE` 可指定 MMS 抓包样本，`CAPTURE_UI_PORT=18122` 启用非标准端口、MMS 值解析、累计快照、显式映射授权及撤销验证；TShark 缺失时真实解析项记录跳过，不能视为通过。

`packet-repository.mjs` 独立负责有界缓存、分页去重、异步过期结果防护和可视范围计算。生产模块性能测试见 `backend/capture/tests/frontend-performance.js`：10 万逻辑帧 500 页、最多 20 页 / 4000 行缓存、50 个重复请求合并一次，10 万次可视范围计算约 8.7 ms，测试视口最多 48 行。协议树与字节文本渲染单独位于 `protocol-view.js`。
