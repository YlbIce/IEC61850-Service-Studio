# IEC 61850 报文抓取、分析与数据回放工程研究

## 1. 产品定位与工程结论

报文工具应作为 IEC61850 Service Studio 的可选桌面工作区，以独立窗口提供实时抓取、PCAP/PCAPNG 导入、MMS 事务分析、报告数据还原与离线数据回放。它应能在没有运行 IED 服务、没有打开工程时独立分析文件；其 DLL、驱动、解码器缺失或分析进程崩溃，不能阻断工程编辑、模型加载、MMS 服务以及其他主应用功能。

建议以自有 C ABI 动态库封装会话、索引、协议语义、回放和错误处理，由单独的辅助进程加载。实时抓取使用 dumpcap/Npcap，MMS 解码优先采用单独启动的 TShark；Electron 主进程负责窗口与受控 IPC，渲染进程只消费分页后的展示模型。此处“动态库封装”指稳定的业务接口与可替换的实现，并不意味着把 Wireshark 的整个解析器嵌入主应用进程。

本报告采用两个边界明确的回放概念：**离线数据回放**在分析窗口中重建历史属性状态；**向仿真 IED 注入值**是另一个明确启动、逐项映射的操作。前者是默认路径，没有网络写操作。报文级 TCP 重发、遥控重演、RCB 写操作重发均不属于默认数据回放。

以下协议事实来自公开官方资料与开源实现；性能预算、接口、交互、默认策略和验收目标属于本项目的工程设计。本文不是已完成实现清单，任何“应”“必须”都需要由对应测试证明。IEC 61850 完整标准文本没有作为公开全文核查，不能据此宣称标准一致性认证。来源核查日期为 2026-09-10；在线文档中 `latest`、`master` 和滚动版本页的内容会变化，发布时应记录实际 TShark、Npcap、模块版本及其测试组合。

## 2. 业务场景与可交付结果

| 场景 | 输入 | 分析行为 | 结果 |
|---|---|---|---|
| 联调时读取失败 | 本机选定接口上的 MMS 流量 | 关联请求、响应和访问错误 | 对象、FC、错误类别、请求到响应时间、原始帧定位 |
| 遥信不刷新 | 报告流量、可选 ICD/CID | 区分 RCB 配置、报告内容、质量变化与数据集成员 | 报告序列、包含原因、值和时间线；缺失上下文明确列出 |
| 文件离线复盘 | Wireshark 保存的 PCAP/PCAPNG | 保留接口和时间信息，完成重组与事务关联 | 可搜索帧表、协议树、字节视图、事务表和事件导出 |
| 对比工程模型 | 报文和选定 IED/AP 的 SCL 模型 | 比较引用、类型、数据集顺序及配置版本 | 已映射、未映射、冲突清单，保留映射依据 |
| 重现测量过程 | 可还原的 Read/Report 值事件 | 按采集时间顺序播放、暂停、步进和定位 | 历史属性树、值变化和来源帧，不更改运行 IED |
| 驱动客户端仿真 | 经确认的属性映射及值事件 | 通过受限的本地仿真接口更新监视值 | 注入审计、跳过原因和可停止的回放会话 |
| 模块缺失环境 | 主程序，无抓包附加组件 | 正常启动主程序，按能力解释附加功能不可用原因 | 工程与服务仍可完整使用 |

“没有看到报文”不等于设备没有发送。接口选择、交换网络可见范围、过滤器、抓取开始时间、截断、驱动丢包和 TLS 都可能影响证据。工具应呈现观测范围，不把链路可见性不足自动归因于 IED 故障。

## 3. 文件格式、接口与时间语义

### 3.1 PCAP 与 PCAPNG

传统 PCAP 有文件级链路类型、字节序及时间精度；每包包含采集时间、捕获长度和原始长度。微秒与纳秒精度通过不同 magic 区分，不能只用扩展名判断格式。读取时应保留两种长度，捕获长度小于原始长度表示截断。[libpcap 文件格式说明](https://raw.githubusercontent.com/the-tcpdump-group/libpcap/master/pcap-savefile.manfile.in)

PCAPNG 的接口编号属于所在 Section；Enhanced Packet Block 引用该 Section 的接口描述。时间戳单位由接口的 `if_tsresol` 决定，并可能包含 `if_tsoffset`；Simple Packet Block 没有时间戳。接口可以具有不同链路类型，不能统一假定以太网。当前引用的格式文档是 Internet-Draft，而不是已发布 RFC。[IETF PCAPNG 格式草案](https://datatracker.ietf.org/doc/draft-ietf-opsawg-pcapng/)

建议原始帧主键采用 `captureId + sectionId + frameOrdinal`，接口主键采用 `captureId + sectionId + interfaceId`。不跨 Section 合并同号接口；不把缺失时间填成零；未知的块或链路类型保留可定位的记录，并报告其未解码原因。导入应依据文件签名探测，扩展名作为文件选择便利条件。

内部时间采用整数与单位明确的字段，例如 `captureTimeNs` 使用十进制字符串跨 JSON 传输，同时记录原始 ticks、分辨率及转换舍入信息。JavaScript Number 无法精确表示现代 epoch 的纳秒整数，因此不能把 `1700000000123456789` 直接作为 Number。界面可按用户选择显示本地时间或 UTC，但排序与回放不依赖格式化字符串。

### 3.2 抓包时间、报告时间和属性时间必须分开

一条值事件可以有三个不同时间：采集设备看到帧的时间、报告的 TimeOfEntry、属性 `t` 中 IED 给出的 UTC 时间。MMS 报告时间与成员属性时间不是同一个字段；报告 API 也把报告 timestamp 和报告数据值分别暴露。[libiec61850 报告接口](https://support.mz-automation.de/doc/libiec61850/c/latest/group__IEC61850__CLIENT__REPORTS.html)

建议默认播放时间轴采用采集顺序和采集时间。IED 时间单独显示原始值、转换值以及同步质量；跨设备时间不可靠时不据此计算绝对先后。没有采集时间的帧仍可查看和手动步进，但不参与自动定时播放，或由用户选择明确标注的固定间隔模式。

同一时间戳事件按文件帧序和帧内 PDU 序稳定排序。出现时间倒退时保留倒退标志，调度等待时间夹到零，不静默重排报文。多个接口对同一业务报文的重复观测不能仅以“值相同”去重；重复帧证据和业务事件去重需要分别处理。

### 3.3 截断、丢包与异常

建议完整性等级为 `complete / truncated / reassembly-incomplete / malformed / encrypted / unsupported`，并允许多项诊断并存。一个 TCP 序列缺口只能说明捕获内容不连续；如果没有驱动统计，不能准确给出驱动丢包数。报告 `BufOvfl` 指示报告缓冲相关情况，和本机抓包丢包不是同一指标。

不完整 PDU 不应产生完整数据事件。已验证的其他 PDU 可继续分析；错误必须绑定原始帧号和关联流，避免单个损坏文件触发主程序退出。原始文件只读，修复、过滤导出及解密后的输出都生成新文件。

## 4. 实时抓取与可选组件架构

### 4.1 dumpcap/Npcap 的职责

Wireshark 将抓取放在 dumpcap，以便解析器和 UI 在普通用户权限下运行；该架构把需要网络权限的部分缩小。dumpcap 提供接口枚举、捕获过滤、快照长度、缓冲区、停止条件和环形文件选项。[Wireshark 抓取架构](https://www.wireshark.org/docs/wsdg_html_chunked/ChWorksCapturePackets.html)；[dumpcap 手册](https://www.wireshark.org/docs/man-pages/dumpcap.html)

Npcap 安装时可启用管理员专用访问，此时设备访问受 ACL 限制，并通过其辅助程序请求提升。接口枚举成功并不证明具备捕获权限，实际打开失败需要独立诊断。Npcap 普通版的再分发和安装数量受其许可约束，因此本项目默认检测已有安装，不未经许可把其安装器直接捆绑进发布包。[Npcap 用户指南](https://npcap.com/guide/npcap-users-guide.html)；[Npcap 官方许可说明](https://npcap.com/)

抓取会话建议包含：用户明确选择的本机接口、BPF 捕获过滤器、输出目录、单文件上限、总空间上限、持续时间、快照长度、是否混杂模式。默认不启用远程 rpcap 接口，不自动抓取全部网卡。普通 MMS 联调可提供端口过滤模板，但实际服务端口可以是配置值；非标准端口必须允许显式 Decode As。

捕获过滤器与显示过滤器使用不同语义。捕获过滤器决定哪些数据根本没有写入文件；显示过滤器仅决定已经抓到的哪些帧显示。不能把 `mms` 这样的 Wireshark 显示表达式直接放入 BPF，也不能在首次解析前只保留“看起来包含 MMS”的 TCP 段而丢掉重组依赖。

实时流程采用“落盘抓取”和“解析展示”分离。高负载时降低界面刷新频率或暂停实时解析，优先保证捕获文件可保存；磁盘配额达到上限按用户的停止/环形策略执行。环形覆盖即将发生时有明确状态，不声称历史仍然完整。关闭窗口必须停止自己创建的抓取会话、等待文件收尾，再结束辅助进程。

### 4.2 进程与动态库边界

建议依赖方向为：

```text
Service Studio 主窗口 ── 受控命令 ── 报文独立窗口
                           │
                    capture-controller
                           │ 本机私有 IPC
                      capture-host.exe
                           │ 运行时加载
                    iec61850-capture.dll
                      ├─ 抓取管理 → dumpcap → Npcap
                      ├─ 解码适配 → tshark
                      ├─ 磁盘索引 / MMS 语义模型
                      └─ 离线回放状态机

主 MMS 服务后端：不链接 capture DLL，不等待其初始化。
```

“DLL 可选”必须体现在链接边界，而不只是 `try/catch`。如果主服务 EXE 的导入表直接依赖 DLL，缺失时操作系统加载器可能在业务代码运行之前就拒绝启动。建议只由独立 host 使用绝对路径动态加载，并校验 ABI 版本与必要导出；主应用把加载失败转换为附加功能能力状态。

Windows DLL 搜索应限定到受控模块目录和系统目录，避免把用户打开的报文目录当作依赖搜索路径。Microsoft 文档提供 `SetDefaultDllDirectories` 和 `LoadLibraryEx` 的搜索控制机制。[Microsoft DLL 搜索 API](https://learn.microsoft.com/en-us/windows/win32/api/libloaderapi/nf-libloaderapi-setdefaultdlldirectories)

建议 C ABI 的公开边界使用不透明句柄、固定宽度整数、UTF-8 字节串、显式长度、调用方缓冲区或专门释放函数。所有导出捕获异常并返回错误码；禁止跨 DLL 传 STL 容器、C++ 异常及不明确的分配器所有权。结构体包含 `struct_size` 和 `abi_version`，异步任务使用 jobId、取消标志及受限大小的轮询结果。

| 能力状态 | 主应用 | 文件分析 | 实时抓取 | 回放 |
|---|---|---|---|---|
| 捕获模块不存在 | 完整可用 | 明确提示未安装 | 不可用 | 不可用 |
| DLL/ABI 不兼容 | 完整可用 | 仅附加模块报错 | 不可用 | 不可用 |
| TShark 不存在 | 完整可用 | 依实际能力显示“不可解码” | 可按实现仅保存原始文件 | 不虚构 MMS 值 |
| Npcap 不存在 | 完整可用 | 可用 | 不可用 | 离线可用 |
| 捕获权限不足 | 完整可用 | 可用 | 显示接口打开错误 | 离线可用 |
| 辅助进程异常退出 | 完整可用 | 当前任务失败，可重新打开 | 收尾并提示文件状态 | 停止，不继续推送 |

### 4.3 TShark 外部解码与 SDK 嵌入比较

| 方案 | 优点 | 成本与边界 | 结论 |
|---|---|---|---|
| 自有 DLL 调用外部 TShark | 复用成熟协议重组；崩溃隔离；版本容易诊断 | 需管理外部程序、输出格式、临时文件和取消 | 推荐默认实现 |
| 直接链接 libwireshark/wiretap | 可直接访问协议树和文件层 | 构建依赖多，初始化和版本兼容成本高，故障进入宿主 | 仅在专门维护兼容矩阵时考虑 |
| 自写 PCAP+TCP+COTP+MMS 解码 | 可完全控制接口与体积 | 重组、ASN.1、变体、错误恢复和长期测试负担很重 | 不作为短期生产替代 |

Wireshark FAQ 本身建议与其他产品通过管道或 socket 保持分离。其代码采用 GPL，直接使用源码或链接库须处理相应许可义务；采用进程隔离也不能取消重新分发二进制时本身的许可要求。[Wireshark FAQ](https://www.wireshark.org/faq)

TShark `-2` 的双遍分析可补充依赖后续帧的信息，但要求输入能够回 seek，不能用于实时捕获或管道输入。`fields` 适合帧摘要，PDML 或保留层级的 JSON 适合协议详情；`jsonraw` 的原始字节输出不等同于已解析的数据对象。[TShark 手册](https://www.wireshark.org/docs/man-pages/tshark.html)

因此采用“第一遍建立摘要和协议事件索引，完整文件完成后可做关联补全；详情按需从缓存取回”的业务模型。不能对每次选中帧都重新扫描整个大文件，也不能把整份 JSON 一次载入 Electron。解码器版本和可用字段用 `--version`、`-G fields` 探测，适配器显式声明兼容字段；不通过正则解析本地化的人类摘要当作唯一业务依据。

## 5. MMS 协议解析与事务模型

### 5.1 分层边界与重组

RFC 1006 定义在 TCP 上承载 ISO 传输服务的 TPKT 格式；TCP 是字节流，并不保留应用消息边界。一个 TCP 段可能只有半个 TPKT，也可能包含多个 TPKT。上层还需要 COTP 及会话、表示、ACSE 和 MMS 的语义上下文。[RFC 1006](https://www.rfc-editor.org/info/rfc1006/)

Wireshark 重组依赖完整的相关数据及相应协议首选项；丢失段会影响上层 PDU 的还原。不能将“TCP 包负载以某 ASN.1 标签开始”当作完整 MMS 检测，也不能把每个 TCP 帧计作一次 MMS 请求。[Wireshark Packet Reassembly](https://www.wireshark.org/docs/wsug_html_chunked/ChAdvReassemblySection.html)

建议同时保存原始帧、重组 PDU 和业务事件三个层次。PDU 含首帧、完成帧、所有依赖帧及帧内序号；业务事件回链 PDU。统计中分开显示帧数、MMS PDU 数和事务数，避免 TCP 重传被误计为第二次读写操作。

### 5.2 association 与 invokeID

MMS ASN.1 区分 Confirmed Request、Confirmed Response、Confirmed Error、Reject 和 Unconfirmed PDU；InformationReport 位于未确认服务，不能按普通读响应强行匹配。请求/响应中的 invokeID 提供关联信息，但其意义建立在对应通信会话内。[Wireshark MMS ASN.1 定义](https://raw.githubusercontent.com/wireshark/wireshark/master/epan/dissectors/asn1/mms/mms.asn)

事务索引建议使用 `(captureId, associationId, initiatorDirection, invokeId, generation)`。associationId 至少隔离不同 TCP 连接实例，不能仅靠 IP 和端口四元组永久标识，因为重连可以复用端口。invokeID 完成后可以复用，generation 防止跨时间错误配对。抓取中途开始时标为 `midstream`，不伪造不存在的握手。

事务状态建议为 `pending / success / service-error / access-error / rejected / orphan-response / incomplete`。超时是分析器依据已配置阈值作出的判断，显示阈值；文件结束而没有响应不自动等价于服务端超时。耗时采用请求 PDU 完成到响应 PDU 完成的捕获间隔，并明确是该观测点的往返间隔，不声称是服务器执行时间。

### 5.3 Read、Write、数据集与访问结果

Read 响应中的值可能没有重复请求的完整变量引用，分析器要关联原请求中的 VariableAccessSpecification。一个请求可能读取多个变量，每个 AccessResult 的成功或错误独立；数组与 structure 也必须保持层级。MMS 数据类型含布尔、整数、无符号数、浮点、bit string、octet string、可见字符串、时间和复合类型。[Wireshark MMS ASN.1 定义](https://raw.githubusercontent.com/wireshark/wireshark/master/epan/dissectors/asn1/mms/mms.asn)

建议使用带类型的值树，不以一个浮点数覆盖所有 MMS 类型。大整数以十进制字符串保存，位串带有效位长度，字节串带 hex/base64，浮点保留精度和特殊值分类，时间保留原始编码。错误项没有“值=0”；结构成员未知时保留索引，不猜属性名称。

Write 请求描述写入意图。即使 Write 响应成功，也只能据此记录“服务器接受写操作”，不能推断设备物理状态已经变化。因此默认历史状态仅消费可验证的 Read 成功结果和 Report 值；成功写意图可在单独轨道展示。如果允许将成功写入作为推断状态，必须明确标记 `inferred-from-write`，且不自动用于 IED 注入。

数据集建立按来源分层：报文中的 DefineNamedVariableList 与 GetNamedVariableListAttributes 成功事务优先；其次是对应模型中的 FCDA 顺序；再次是用户显式配置映射。动态数据集随 association 或定义/删除操作生效，不能用最后看到的定义覆盖整段历史。索引项保存有效起止帧与来源，seek 时恢复对应时间的定义。

## 6. Reports、RCB 和 IEC 61850 属性关联

### 6.1 报告解析规则

libiec61850 的报告实现按 OptFlds 决定可选头部，再解释 inclusion bitstring；存在 DataRef 时先读取所包含成员的引用，再读取这些成员的值，最后处理包含原因。报告还有序号、EntryID、ConfRev、缓冲溢出和分段等状态。实现不能把 API 的 `RPT_OPT_*` 数值直接当作线上 MMS bit string 的位位置。[libiec61850 报告处理源码](https://raw.githubusercontent.com/mz-automation/libiec61850/v1.6/src/iec61850/client/client_report.c)

建议把“报文结构是否有效”“成员引用是否确定”“报告是否完整”作为三个独立判定。存在可选字段，不表示每个报告都必然携带它。缺少 DataRef 时按数据集成员顺序与 inclusion 对应；不知道数据集定义时显示 `member[7]` 这样的未解析成员，禁止给它绑定当前工程中碰巧同位置的对象。

报告匹配不能只用 RptID 全局做键。至少加入 association 和发布端，结合 RCB 的 RptID/DatSet/ConfRev 及有效时间确定上下文。ConfRev 变化时使旧成员映射失效或重新验证。分段报告先按序号和分段信息组装，缺片保留部分分析但不发布“完整报告”；回放可只接受已完成的组装结果。

报告值只更新 inclusion 指示的成员；没有包含的成员维持既有值并保留其上次来源时间。如果之前没有观察值，其状态为 unknown。BufOvfl 和序号跳变显示为完整性诊断，避免直接将其全部解释为网络丢包。EntryID 用于来源识别和缓冲报告诊断，不能当作真实时间顺序的替代物。

### 6.2 引用、FC、质量和时间

MMS 引用应保留原始 domainId/itemId，同时派生 IEC 61850 展示引用和 FC。建议映射结果结构包括 `originalReference`、`objectReference`、`fc`、`memberPath`、`mappingSource`、`mappingStatus`。不能简单把所有 `$` 替换成 `.` 后就丢弃 FC，尤其是 SG/SE、ST/CO 等名称相关但语义不同的属性。

质量和 UTC 时间有独立的 IEC 61850 字段。Wireshark 新旧版本提供的 IEC61850 专用字段不同，官方字段表给出了各字段的可用版本范围，因此适配器不能假设所有部署版本都有相同的 `mms.iec61850.*` 字段。[Wireshark MMS 字段参考](https://www.wireshark.org/docs/dfref/m/mms.html)

建议保留 q 原始位串，再显示 validity、detailQuality、source、test、operatorBlocked 等已知位；t 保留原始 UTC 字节、时钟状态与精度信息。缺少 q/t 显示“未观测”，不自动填写 good 和当前时间。Value、q、t 来源于同一结构时可以形成同一原子观测；独立读取时保留不同来源帧，不能捏造一个同步快照。

SCL 映射选择具体 IED 与 AccessPoint，沿 LDevice/LN、DataTypeTemplates、DOType/DAType、数组及 FCDA 展开。模型用于给结构元素命名和校验类型，不作为捕获事实替代物。描述不一致、成员数量不同、ConfRev 冲突均进入显式映射冲突页。导入模型不能隐式替换正在运行的主工程。

## 7. TLS 与解密边界

Wireshark 只有获得适用秘密材料才能解密 TLS。会话密钥日志适用于包括使用 DH 密钥交换的连接；仅提供服务器 RSA 私钥的方式有严格限制，不能解 TLS 1.3，也不适用于使用 (EC)DHE 的会话。PCAPNG 还可以携带解密秘密块。[Wireshark TLS 文档](https://wiki.wireshark.org/TLS)

因此应区分 `tls-encrypted`、`tls-decryption-failed`、`tls-decrypted`。没有解密材料时仍可显示端点、时序、握手信息与 TLS 错误，但不宣称已分析 MMS 数据。导入密钥日志仅作用于当前分析任务或显式保存的本地配置，不修改系统全局环境变量，不把秘密写入普通审计或工程 JSON。

解密后的缓存同样包含敏感明文，应跟随分析会话的临时目录清理策略。默认导出原始报文不自动附带密钥；包含秘密或明文的导出项需要可辨识名称与选项。这里的产品决策是让数据性质可见，并不是额外阻断普通文件导入。

## 8. 回放业务状态机

### 8.1 离线历史状态

建议流水线为 `原始帧 → 重组PDU → MMS事务/报告 → 经校验值事件 → 回放快照`。每条事件保留 association、引用、FC、类型化值、q/t、捕获时间、帧号、推断/观测类别、完整性和映射依据。回放只依赖已生成事件，不在每个播放 tick 中重新解码原文件。

状态包括 `empty / indexing / ready / playing / paused / seeking / ended / failed / cancelled`。开始播放需要存在可回放的已映射事件；没有事件时显示原因计数，如仅含握手、密文、读请求无响应、引用未解析。播放、暂停、停止、上一步、下一步、速度、当前位置和总时长是独立窗口的常驻控制。

调度采用单调时钟。速度变化重新建立当前原始时间与本机单调时间的映射，避免过去累计定时误差。高倍速可按一个 UI 刷新周期批量应用多个事件，但仍保留事件顺序；界面可合并显示更新，语义状态不能跳过中间必要的定义和质量变化。暂停时没有新事件应用，恢复不会重新应用已确认的事件。

### 8.2 seek 与状态恢复

向后拖动不能只回移游标。要恢复目标时刻之前的数据集定义、最新值、质量、时间和未知状态，再继续前进。建议每若干事件或时间段保存稀疏检查点，seek 从最近检查点重放至目标；检查点由实际事件构建，不从当前运行 IED 读值填补历史空白。

进度条以原始时间为主，另有帧/事件序号定位。目标事件采用明确的包含规则，例如“应用所有序号 ≤ 目标序号的事件”。如果 seek 在 UI 中连续触发，旧任务应可取消，只有最新 generation 的结果可以覆盖页面。到文件开头时所有未观测属性回到 unknown，而不是保留播放末尾的值。

离线回放不等价于数值插值。默认离散保持最后观测值；趋势图在缺口、无效质量和类型变化处断开或标注。若未来加入插值，仅用于可视化，并与实际观测值区别保存，不用于自动注入。

### 8.3 向仿真 IED 注入值

这是独立的可选动作，需要明确目标为本机 Service Studio 中的仿真模型，并展示来源属性到目标属性的逐项映射、类型检查、允许项及跳过项。建议只允许已经确认的 ST/MX 监视属性及其必要 q/t 更新；CO/Oper/SBO/SBOw/Cancel、RCB、SGCB、定值写入、文件服务和模型结构修改默认不在白名单。

不发送捕获中的原始以太帧或 TCP 数据，不建立对源设备的写入连接。原 TCP 序列、会话状态、选择操作及报告预订具有上下文，原始包重发无法构成可靠业务重现。对本地服务器更新值应使用明确的内部接口；服务器如何产生新的报告由其当前服务逻辑决定，而不是复制旧报告传输状态。

仿真值回放启动时应协调现有数值仿真，避免两个生产者同时改同一属性。注入批次带会话 token、映射版本和递增序号；停止后使 token 失效，拒绝迟到请求。写入失败暂停或停止并记录原因。默认停止只停止后续更新，不自动恢复之前的值；如果提供恢复，必须记录启动快照，并避免覆盖其他合法操作产生的新值。

不能把所有 MMS 值强转 double 后写入现有 Point 接口。目标接口若只支持有限 CDC 或数值类型，映射页应准确显示这个边界并拒绝其他类型。离线分析本身仍应保留完整类型，不因注入接口能力不足而丢失分析数据。

## 9. 桌面交互与性能设计

独立窗口采用原生菜单栏与工具栏、可调整的停靠分区和原生右键菜单。建议布局为顶部捕获/文件工具、左侧会话与协议导航、中部虚拟化帧表、下部协议树和字节区、底部回放与状态。协议树选中字段时定位对应字节；重组字段无法映射到单一原始帧时，显示“重组数据”及依赖帧入口，不伪造偏移。

菜单包括文件打开/关闭/导出、捕获开始/停止/接口设置、分析过滤/事务/报告、回放控制、窗口布局和帮助/依赖诊断。右键提供复制引用、复制字段值、显示过滤、跟踪会话、跳转请求/响应、加入离线回放和查看原始帧。依赖未满足的动作应禁用并给出具体原因，不让用户通过重复点击触发失败弹窗。

索引和语义解析始终离开 Electron UI 线程。建议摘要页每页 200～1000 行、列表 DOM 仅保留可见区、详情树按需展开、字节区限制单次渲染长度。实时更新批次 100～250 ms 合并，详情选择和过滤请求带 generation；过期结果丢弃。主窗口已有服务状态轮询不能承担抓包数据通道。

大文件使用磁盘索引，至少包含帧序、原文件位置或可定位标识、时间、端点、流标识、协议、摘要及语义事件位置。详情缓存采用 LRU；一个会话的已解码树不能永久累积在 JS Map。解码器自身的重组内存、索引磁盘、缓存、捕获环形文件分别设置限额，触限后明确失败/降级，不悄悄重置协议上下文。

建议建立以下可测量预算：普通窗口操作 p95 <100 ms；取消索引请求后 2 秒内停止继续发布结果；打开已完成索引首屏 <1 秒；10 万帧下滚动 DOM 保持 <300 行；长时间捕获主窗口仍可控制 MMS 服务。预算是待验证目标，必须记录机器配置、文件大小、帧数、MMS 比例、解码器版本及冷/热缓存状态，不直接作为已经达到的数字发布。

## 10. 建议数据契约

| 对象 | 最少字段 | 不变量 |
|---|---|---|
| Capability | moduleVersion、abiVersion、decoderVersion、liveCapture、offlineDecode、replay、reasons | 各能力独立，不只有一个总布尔值 |
| CaptureSession | id、sourceKind、state、interfaces、filter、filePath、limits、counts | 会话拥有自己的子进程与取消生命周期 |
| FrameSummary | id、ordinal、section/interface、time、capLen/origLen、endpoints、protocol、streamId、diagnostics | 保留原帧顺序，不把帧等同于 PDU |
| Pdu | id、type、frameIds、completeFrame、ordinalInFrame、associationId、integrity | 可以跨帧、同帧可多个 PDU |
| Transaction | id、associationId、direction、invokeId、generation、service、request/response、status、elapsed | 不跨关联匹配，不丢弃孤立响应 |
| TypedValue | type、scalar 或 children、rawEncoding、display、validity | 复合值保留结构，大整数不损失精度 |
| ValueEvent | eventId、captureTime、reference、fc、value、quality、iedTime、source、mapping、integrity | unknown 与 0/false 不相同 |
| ReplaySnapshot | cursor、virtualTime、values、unresolvedCount、gaps、generation | 向后 seek 恢复历史状态，不能泄露未来值 |

上述是领域契约而非强制的函数名称。C ABI 与 Electron IPC 可以用不同的传输封装，但不得在跨层过程中抹掉类型、关联范围、时间精度或错误状态。导出结果应带 schemaVersion、分析器版本、源文件 SHA-256、过滤器和映射版本，确保同一结果可追溯。

## 11. 验收策略与证据边界

验收必须有真实 MMS 客户端与本项目 IED 服务的抓包，至少覆盖读取结构值、部分访问错误、写入拒绝、动态数据集以及 BRCB/URCB 报告。仅手工构造字符串或对比界面截图不能证明协议正确；仅启动 TShark 成功也不能证明已完成业务值映射。自动构造 PCAP/PCAPNG 适合验证格式边界和恶意输入，应与真实链路样本同时使用。

黄金样本应包含已知模型、服务端值序列、客户端请求、捕获文件和预期值事件；同一原始文件同时通过 Wireshark/TShark 核查帧与协议结果，通过真实客户端核查读取/报告语义。所有黄金数据只使用测试环境，避免把真实站点敏感报文放进源码仓库。

需单独执行“物理移除附加组件后启动主应用”的回归，而不是仅设置一个 UI 禁用标志。辅助进程故障测试应确认主 MMS 服务继续运行、已有客户端不被断开、工程可保存。回放测试要检查没有外部网络写入，并检验 seek 后状态等同于从头重放到同一点。

完整验收矩阵见 [CAPTURE-REQUIREMENTS.md](CAPTURE-REQUIREMENTS.md)。发布说明要逐项区分已测试、未覆盖、依赖缺失与能力边界；不把“预留接口”写成已具备的数据回放、TLS 解密或大文件性能能力。

## 12. 来源

1. The Tcpdump Group，[*pcap-savefile* 源码手册](https://raw.githubusercontent.com/the-tcpdump-group/libpcap/master/pcap-savefile.manfile.in)，滚动维护；用于 PCAP 时间精度、长度与格式。
2. IETF OPSAWG，[*PCAP Now Generic (pcapng) Capture File Format*](https://datatracker.ietf.org/doc/draft-ietf-opsawg-pcapng/)，核查时为 draft-ietf-opsawg-pcapng-05，2026-03；用于 Section、接口、时间及块语义，草案状态不等同 RFC。
3. Wireshark Foundation，[*dumpcap(1)*](https://www.wireshark.org/docs/man-pages/dumpcap.html)，在线手册；用于捕获参数、文件和停止策略。
4. Wireshark Foundation，[*Capturing packets*](https://www.wireshark.org/docs/wsdg_html_chunked/ChWorksCapturePackets.html)，Developer's Guide 在线版；用于捕获与解析分离。
5. Nmap Project，[*Npcap Users' Guide*](https://npcap.com/guide/npcap-users-guide.html)，在线版；用于 Windows 权限与 Npcap 安装行为。
6. Nmap Project，[*Npcap: Windows Packet Capture Library & Driver*](https://npcap.com/)，核查于 2026-09-10；用于普通版与 OEM 部署/再分发区别。
7. Microsoft，[*SetDefaultDllDirectories function*](https://learn.microsoft.com/en-us/windows/win32/api/libloaderapi/nf-libloaderapi-setdefaultdlldirectories)，页面标注更新于 2021-10-12；用于受控 DLL 搜索。
8. Wireshark Foundation，[*Frequently Asked Questions*](https://www.wireshark.org/faq)，在线版；用于外部进程集成和许可说明。
9. Wireshark Foundation，[*tshark(1)*](https://www.wireshark.org/docs/man-pages/tshark.html)，在线手册；用于双遍分析、输出格式及运行能力。
10. M. T. Rose / D. E. Cass，[*RFC 1006: ISO Transport Service on top of the TCP, Version 3*](https://www.rfc-editor.org/info/rfc1006/)，1987-05；用于 ISO-on-TCP 与 TPKT。
11. Wireshark Foundation，[*Packet Reassembly*](https://www.wireshark.org/docs/wsug_html_chunked/ChAdvReassemblySection.html)，User's Guide 在线版；用于重组依赖和边界。
12. Wireshark Foundation，[*MMS ASN.1 definitions*](https://raw.githubusercontent.com/wireshark/wireshark/master/epan/dissectors/asn1/mms/mms.asn)，源码滚动版本；用于 PDU、服务、访问结果及数据类型结构。
13. MZ Automation，[*Client side report handling services*](https://support.mz-automation.de/doc/libiec61850/c/latest/group__IEC61850__CLIENT__REPORTS.html)，在线 `latest` 文档，页面生成时间为 2024-08-13；用于报告 API 与可选字段，不作为库最新发行版本证明。
14. MZ Automation，[*client_report.c*](https://raw.githubusercontent.com/mz-automation/libiec61850/v1.6/src/iec61850/client/client_report.c)，v1.6 分支源码；用于报告布局、包含位图和分段解析，并与项目 vendor 源码交叉核对。
15. Wireshark Foundation，[*Display Filter Reference: MMS*](https://www.wireshark.org/docs/dfref/m/mms.html)，核查时字段表覆盖到 4.6.8；用于字段存在性和版本范围，字段列表不构成服务完整性保证。
16. Wireshark Foundation，[*TLS*](https://wiki.wireshark.org/TLS)，Wiki 在线版；用于会话密钥日志、RSA 私钥限制及 PCAPNG 解密材料。
