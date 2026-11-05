# 第三方组件

- `third_party/libiec61850`：从配套客户端现有源码副本复制，当前运行版本 1.6.1，GPL-3.0-or-later。保留 COPYING、源码头部和原始工具。
- `tools/genconfig.jar`：上述官方源码分发中自带的 SCL → CFG 转换器。
- Electron、gRPC、Protobuf、fast-xml-parser、electron-builder 及其依赖：具体许可见安装依赖中的 LICENSE 和发行包 Electron 许可证集合。

本项目的协议库局部修改：`hal/filesystem/win32/file_provider_win32.c` 的打开、文件属性、删除、重命名改用 UTF-8 → UTF-16 和 Windows / CRT 宽字符函数，支持中文模型与文件路径。目录枚举原实现已经使用宽字符 API。

模型导入不加载 XML 外部实体。官方 CFG 解析器在独立进程中先行验证，再应用于管理后端。

## 0.2.0 新增依赖与局部补丁

- mbedTLS 3.6.7：`third_party/mbedtls-mbedtls-3.6.7`，来自官方 [mbedtls-3.6.7 标签](https://github.com/Mbed-TLS/mbedtls/releases/tag/mbedtls-3.6.7) 的源码快照。保留其 LICENSE、源码头部和许可证集合。源码分发含 Apache-2.0 / GPL-2.0-or-later 等许可，具体按上游文件声明。
- libiec61850 的 CMake 改为引用上述维护中的 mbedTLS 3.6 分支目录。
- 新增 `TransactionalSettingGroupConfirmationHandler`，保留原 void 回调 API；新回调失败时返回 MMS hardware-fault 且不释放编辑预约。
- TLS HAL 新增预期对端名称（适配 mbedTLS 3.6.7 客户端主机名验证）和证书/私钥匹配检查。未禁用证书链或有效期校验。
- Windows Ethernet HAL 增加线程本地发送结果访问器，将驱动拒绝发送反馈给发布流状态。
- Npcap/WinPcap 为本机驱动依赖，不随主项目安装驱动或修改网络配置。

可选报文分析模块的 Wireshark/TShark 依赖、许可证与隔离契约见该模块说明及 `CAPTURE-RESEARCH.md`。对外分发时仍须满足所有第三方二进制与对应源码提供义务。
