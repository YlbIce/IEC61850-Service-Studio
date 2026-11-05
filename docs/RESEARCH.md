# 功能调研与范围

调研日期：2026-09-10。产品定位：IEC61850 Service Studio，与已有 Client Studio 对接的桌面 IED 工程、服务运行和联调工具。

## 一手资料

1. [IEC 61850-7-2 标准页面](https://webstore.iec.ch/en/publication/6015)：抽象通信服务的标准背景；本项目不声称拥有完整标准文本或通过一致性认证。
2. [libiec61850 Server Tutorial](https://libiec61850.com/documentation/iec-61850-server-tutorial/)：服务实例与数据模型生命周期、模型更新及控制处理入口。
3. [libiec61850 Control Tutorial](https://libiec61850.com/documentation/control-tutorial/)：Select、SelectWithValue、Operate、Cancel 与服务端检查/执行回调。
4. [libiec61850 API overview](https://libiec61850.com/documentation/)：MMS、数据集、报告、日志、定值与 GOOSE/SV 相关 API 范围。
5. [libiec61850 Configuration File Format](https://libiec61850.com/configuration-file-format/)：CFG 层次与 SCL 转换工具。
6. [OMICRON IEDScout 4.10 更新说明](https://www.omicronenergy.com/download/document/B7835D19-CE42-4433-B0F6-09AE4ED01581/)：行业 IED 仿真工具包含 SCL 驱动模型、缓冲/非缓冲报告、控制操作与活动监视。
7. [MZ Automation 官方仓库](https://github.com/mz-automation/libiec61850)：协议栈源码、功能及 GPLv3 / 商业许可信息。

## 产品需求映射

| 需求 | 本次实现 | 验证方式 |
|---|---|---|
| 工程桌面工作流 | 原生菜单、工具栏、右键、树/表格/属性/日志、保存与恢复 | Electron 实际窗口回归 |
| SCL / CFG 模型加载 | ICD/CID/SCD/IID 经官方转换，CFG 原生解析，多实例选择 | 样例导入 + MMS 读取 |
| MMS 模型服务 | libiec61850 真实监听、模型浏览与读取 | 原生客户端及配套客户端接口 |
| 值与品质变化 | 类型校验、品质位、时间戳、波形更新 | gRPC 状态 + MMS 报告 |
| 数据集 | 预定义、工程编辑、客户端动态创建/删除 | MMS 集成测试 |
| 报告 | URCB/BRCB、GI、TrgOps、IntgPd、BufTm、状态监视 | MMS 实际接收报告 |
| 控制 | 四种模型、SPC/DPC、静态检查、执行回调、闭锁、审计 | 正向和拒绝路径测试 |
| 文件服务 | 明确配置根目录，默认关闭 | 启用路径与目录预览；现场文件策略需验收 |
| GOOSE / SV | 保留导入模型结构，发布未启用 | 界面明确提示 |
| 定值与 MMS 日志 | 保留结构，不提供未实现的数据银行/日志存储 | 文档与界面明确提示 |
| 安全与运维 | 本机管理令牌、退出清理、审计轮转、参数验证 | 拒绝无令牌请求、后端生命周期测试 |

## 实现决策

SCL 导入使用与协议库配套的官方转换器，不另写一个只识别少量 XML 标签的模拟解析器。原始模型结构完整保留，UI 提供完整属性浏览；常用标准 CDC 另提供运行值操作。

工程模式通过动态模型 API 创建点位、数据集和报告。数据集采用 FCD 成员，使值、品质和时间一并进入报告。客户端决定报告保留与启用，服务端显示实际事件。

将控制检查放在协议库的 PerformCheck 回调中，使拒绝在操作的早期返回客户端；执行回调再次检查策略，避免选中后状态改变仍被执行。

## 投运前的后续工作

完整 SCL 兼容矩阵、厂商样本、BRCB 断线续传/溢出压力验证、长时间高并发运行、IEC 62351/TLS 与授权、定值组持久化、日志存储、GOOSE/SV 发布与网卡管理、软件签名与升级策略，以及相应一致性测试。
