# IEC61850 Service Studio

独立的 Windows 桌面 IED 服务端工程工具，配套 `Iec61850ClientStudio` 使用。采用相同的 **Electron 39 + C++17 + gRPC/Protobuf + libiec61850 1.6.1** 架构；MMS 服务来自真实协议栈。

![桌面工作区](docs/screenshots/workspace.png)

## 启动

直接运行 `release/win-unpacked/IEC61850 Service Studio.exe`，或使用 `release` 下的 Portable / 安装包（生成后可用）。源码启动：

```powershell
cd D:\WORKSPACE\Electron\Iec61850ServiceStudio
npm install
npm run build:backend
npm start
```

构建需要 Node.js、Visual Studio 2022 C++ 工具链、CMake / Ninja，以及包含 `grpc`、`protobuf` 的 vcpkg。默认复用同级 `tools/vcpkg` 工具链，可通过 `VCPKG_ROOT` 和 `VSDEVCMD` 指定其他位置。项目包含独立 libiec61850 源码副本，不依赖客户端项目的代码或运行进程。

## 加载 ICD / CID / CFG

使用 **文件 → 导入模型**，或 `Ctrl+I`：

| 格式 | 加载方式 |
|---|---|
| `.icd` / `.cid` | 官方 `genconfig.jar` 转换，再交由原生 CFG 解析器加载 |
| `.scd` / `.iid` | 同一 SCL 路径；多 IED / AccessPoint 时弹出选择器 |
| `.cfg` | 直接解析 libiec61850 的 `MODEL(...)` / `MODEL{` 文本格式，不需要 Java |
| `.i61850` | 工程文件：监听配置、编辑模型或内嵌 CFG、源文件信息 |

**SCL 转换需要 Java 17+**，从 `JAVA_HOME` 或 `PATH` 查找。转换器随应用打包，不需要另行查找 JAR。输入文件上限 8 MB；外部 XML 实体被拒绝。CFG 会在独立原生进程中预检查，具体错误显示在界面。

导入保留原始 LD/LN/DO/DA、数组、数据集及报告/控制结构。工程保存时内嵌转换后的 CFG，重新打开工程不依赖原始文件路径，也不再需要 Java。导入模型结构只读；通过数据对象右键菜单“查看数据属性”弹窗查看完整属性树、类型、FC 与当前值，通过“数据模型”修改已识别的标准点位运行值与品质。厂商私有扩展及不同 SCL 版本的兼容性取决于协议库转换器，不宣称任意模型均可转换。

## 已实现

- Windows 原生菜单栏、快捷键、工具栏与右键菜单；模型导航树、表格标签页、属性面板、事件区；可拖动面板及布局恢复。
- 新建、打开、最近工程、保存/另存为、未保存更改提示、原子写入、异常恢复文件。
- 真实 MMS 监听、启停、端口冲突反馈、最大连接数配置、客户端连接记录。
- 可编辑工程的 MV / SPS / INS / SPC / DPC 点位，初值、品质和在线改值。
- 预定义与客户端动态数据集；FCD 成员包含值、品质、时间。
- URCB / BRCB、配置 TrgOps / IntgPd / BufTm / ConfRev，实时报告状态及事件计数；报告由客户端保留并启用。
- 四种控制模型：直接普通 / SBO 普通 / 直接增强 / SBO 增强；SPC / DPC 布尔控制、全局拒绝策略、点位闭锁、选择与执行审计。测试控制被拒绝。
- 恒定 / 正弦 / 斜坡 / 方波数值仿真，100 ms 更新周期及小型趋势图。控制输出不自动仿真。
- 可选 MMS 文件服务，专用目录配置、目录预览。默认关闭。
- 本地审计日志、筛选与 CSV 导出；每个日志文件 5 MB，保留一份轮转历史。
- 隔离渲染进程、受限 IPC、本机随机端口 gRPC + 随机令牌；桌面进程退出时自动停止后端。

## GOOSE / SV、TLS 与定值组

使用“工程”菜单或工具栏的“发布 / TLS / 定值组”。GOOSE/SV 发布需要选择以太网网卡并安装 Npcap；可新建发布流，也可从导入模型控制块读取配置模板。配置默认禁用，选中启用后随 MMS 服务启停。GOOSE 使用 MinTime/MaxTime 重传；SV 采样率为每秒 1–4800 次，Windows 高精度定时器负责调度，漏期统计真实反映本机负载。

SV 按数据集叶属性顺序编码：BOOLEAN 为 1 字节；普通整数、枚举、FLOAT32、QUALITY 为 4 字节；INT64、FLOAT64、TIMESTAMP 为 8 字节。接收端需使用相同布局，修改布局后递增 ConfRev。此通用格式没有自动把工程单位换算成 9-2LE 的固定电流/电压比例。导入按周期采样的 SV 模板默认按 50 Hz 换算，启用前需核对。

TLS 配置包含服务证书、匹配私钥、可信客户端 CA、可选 CRL 与限定客户端证书；最低 TLS 1.2，也可仅允许 1.3。凭据加载或匹配失败会拒绝应用配置，不降级到明文。私钥内容不存入工程文件。监听端口在服务配置中设置，TLS 常用 3782。

导入 `examples/setting-groups.cid` 可体验 5 组定值。定值管理支持查看、编辑、激活；MMS 客户端使用 EditSG、SE 写入、CnfEdit 和 ActSG。已确认的完整类型值与激活组号保存在应用数据目录 `settings/<工程标识>.banks`。工程 JSON 保存稳定存储标识；迁移到另一台机器时需同时迁移对应 banks 文件。写盘失败会拒绝确认且保留原值与预约。已被客户端预约的设备不允许桌面改写。

架构拆分与线程约束见 [架构审查](docs/ARCHITECTURE.md)。

## 与客户端联调

1. 在 Service Studio 保留默认工程，按 `F5` 启动，默认监听 `127.0.0.1:102`。
2. 在 Client Studio 选择**真实 IED 连接**，连接上述地址；不要选择 Mock IED。
3. 浏览 `STUDIOLD0/GGIO1`，读取 `AnIn1.mag.f [MX]` 或 `Ind1.stVal [ST]`。
4. 读取 `STUDIOLD0/LLN0.Measurements` 数据集。
5. 配置/启用 `STUDIOLD0/LLN0.RP.Measurements01` 或 `STUDIOLD0/LLN0.BR.Events01`，发起 GI；在服务端 `F6` 开启仿真观察后续报告。
6. 控制 `STUDIOLD0/GGIO1.SPCSO1`（直接普通）、`SPCSO2`（SBO 增强）或 `STUDIOLD0/XCBR1.Pos`（SBO 增强）。DPC 状态 1 = 分位，2 = 合位。

结构编辑必须先停止服务。在线改值只更新运行缓存，不修改工程初值。导入后对象引用由文件决定，不沿用默认工程引用。

## 验证

```powershell
npm run check
npm test
npm run test:integration
npm run test:security
npm run test:publishers
npm run test:ui
```

集成测试启动独立 C++ 后端和原生 MMS 客户端，覆盖数据读取、数据集、URCB/BRCB、控制/拒绝、在线更新、仿真、端口冲突、导入模型和管理令牌校验。测试使用端口 `18102`。

桌面回归脚本为 `tests/electron-smoke.js`，必须通过 Electron 运行。它使用 `.tmp/ui-profile`，验证原生菜单、配置保存、真实服务启停、标签页与 ICD 导入，并输出 `docs/screenshots`。结果写入 `ui-result.log`，不依赖 GUI 控制台管道。用 `npm run test:ui` 启动。

```powershell
npm run dist
```

生成 NSIS 安装包与 ZIP 便携版。ZIP 只需完整解压一次，然后运行其中的 `IEC61850 Service Studio.exe`；后续不再重复解压。请保留同目录的 DLL、resources 等文件，不要直接在压缩软件内运行，也不要仅复制 EXE。未配置代码签名证书。

## 当前边界

这是具有真实通信链路的桌面工程实现，**尚未经过 IEC 一致性认证、长期稳定性或现场投运验收**。以下能力没有伪装为可用：

- SV 使用通用数据集布局，每帧一个 ASDU，未提供 PTP/硬件同步或实时操作系统保证；smpSynch=0，界面统计漏过的采样期限。
- TLS 提供双向证书验证，不等同于完整 IEC 62351 系列一致性认证或角色权限实现。
- MMS 日志存储、角色权限与外部数据库映射尚未实现。
- 导入任意 CDC 的结构均保留，但在线改值限具有标准 value/q/t 的 MV、SPS、INS、SPC、DPC；控制执行限 SPC / DPC。
- 没有实现 SCL 图形化结构编辑与 SCL 导出。已导入 CFG 可以原样导出。

需求来源、支持范围和后续工作见 [需求调研](docs/RESEARCH.md)，验证结果见 [验证记录](docs/VALIDATION.md)。

## 许可与第三方组件

项目按 GPL-3.0-or-later 提供，见 [LICENSE](LICENSE)。libiec61850 和转换器保留原许可。其官方仓库提供 GPLv3 与商业许可说明；专有分发需自行落实适用授权。Windows 文件系统适配层增加了 UTF-8 路径支持，修改记录见 [THIRD_PARTY.md](docs/THIRD_PARTY.md)。



## 独立报文抓取与分析

工具菜单“报文抓取与分析”（Ctrl+Shift+P）打开独立桌面窗口。支持 PCAP/PCAPNG/CAP 导入、选择接口实时捕获、BPF 捕获过滤和 Wireshark 显示过滤、非标准 MMS 端口、请求/响应关联、协议树和字节查看，以及 Read/Report 观测值的离线播放、步进与累计快照。向本机仿真 IED 注入测量值需要另行建立并确认映射。

分析后端为独立 `iec61850-capture.dll`，由 `capture-helper.exe` 隔离加载；可选资源位于 `resources/capture`。缺失整个组件或解码器时主应用仍可编辑工程和运行 MMS。完整安装包附带精简的官方 Wireshark 命令行运行时；实时抓取还需系统安装 Npcap，未再分发其安装器。

运行 `npm run build:capture` 构建 DLL/辅助进程，`npm run test:capture` 验证原生解析，`npm run test:capture-ui` 验证独立窗口。构建依赖及解码运行时来源见捕获模块文档。TLS 密文不自动解密；不重发原始 TCP、控制或 RCB 操作。不完整报告和未知引用保留诊断，不能伪造完整值用于注入。

详细依据见 [抓包与回放研究](docs/CAPTURE-RESEARCH.md)、[需求与验收矩阵](docs/CAPTURE-REQUIREMENTS.md) 和 [窗口操作与接口](docs/capture-window.md)。


## 便携版启动性能

发行目标已从每次自解压的单文件 EXE 改为 ZIP 目录便携版。旧 Portable.exe 包装器启动前解压整个 Electron/后端/解码器，退出后删除临时目录，因此重复启动仍产生大量磁盘操作。目录便携版免安装，保留相同功能，解压后直接运行。

本机对同一 0.2.1 应用测量，从启动进程到主窗口页面及后端工程就绪：旧自解压版 32.369 秒，目录运行 1.434 秒。结果包含 CDP 检测开销，是本机一次对照，不是所有磁盘/杀毒环境的时间保证。详见 `docs/STARTUP-PERFORMANCE.md`。
