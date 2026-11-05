const theme = require("./theme");
("use strict");
const { Menu } = require("electron");
function buildMenu({ project, recent, emitAction, run, openProject }) {
  const item = (label, action, accelerator, enabled = true) => ({
    label,
    accelerator,
    enabled,
    click: () => emitAction(action),
  });
  theme.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "文件(&F)",
        submenu: [
          item("新建工程", "new", "CmdOrCtrl+N"),
          item("打开工程…", "open", "CmdOrCtrl+O"),
          {
            label: "最近工程",
            submenu: recent.length
              ? recent.map((file) => ({
                  label: file,
                  click: () => run(() => openProject(file)),
                }))
              : [{ label: "无最近工程", enabled: false }],
          },
          { type: "separator" },
          item(
            "导入模型 ICD / CID / SCD / IID / CFG…",
            "import",
            "CmdOrCtrl+I",
          ),
          item("导出当前 CFG…", "export-cfg", undefined, !!project.source),
          { type: "separator" },
          item("保存工程", "save", "CmdOrCtrl+S"),
          item("工程另存为…", "save-as", "CmdOrCtrl+Shift+S"),
          { type: "separator" },
          item("退出", "quit", "Alt+F4"),
        ],
      },
      {
        label: "编辑(&E)",
        submenu: [
          { role: "undo", label: "撤销文本编辑" },
          { role: "redo", label: "重做文本编辑" },
          { type: "separator" },
          { role: "cut", label: "剪切" },
          { role: "copy", label: "复制" },
          { role: "paste", label: "粘贴" },
          { role: "selectAll", label: "全选" },
          { type: "separator" },
          item("查找点位", "find", "CmdOrCtrl+F"),
          item("新增点位…", "add-point", "Insert"),
          item("编辑所选…", "edit", "F2"),
          item("删除所选…", "delete", "Delete"),
        ],
      },
      {
        label: "工程(&P)",
        submenu: [
          item("服务配置…", "settings", "Alt+Enter"),
          item("TLS 安全通信…", "tls-settings"),
          item("GOOSE / SV 发布…", "publishers"),
          item("定值组管理…", "setting-groups"),
          { type: "separator" },
          item("校验工程", "validate", "CmdOrCtrl+Shift+V"),
          item("新建数据集…", "add-dataset"),
          item("新建报告控制块…", "add-report"),
        ],
      },
      {
        label: "服务(&S)",
        submenu: [
          item("启动 MMS 服务", "start", "F5"),
          item("停止 MMS 服务", "stop", "Shift+F5"),
          { type: "separator" },
          item("运行波形仿真", "simulation", "F6"),
          item("刷新模型与运行状态", "refresh", "CmdOrCtrl+R"),
        ],
      },
      {
        label: "视图(&V)",
        submenu: [
          theme.menu(),
          ...[
            "model",
            "datasets",
            "reports",
            "controls",
            "simulation",
            "sessions",
            "files",
          ].map((tab, i) =>
            item(
              [
                "数据模型",
                "数据集",
                "报告控制块",
                "遥控监视",
                "数值仿真",
                "客户端连接",
                "文件服务",
              ][i],
              `tab:${tab}`,
            ),
          ),
          { type: "separator" },
          item("显示 / 隐藏属性面板", "toggle-properties"),
          item("显示 / 隐藏事件日志", "toggle-log"),
          item("重置工作区布局", "reset-layout"),
          { role: "togglefullscreen", label: "全屏" },
        ],
      },
      {
        label: "工具(&T)",
        submenu: [
          item("报文抓取与分析…", "capture", "CmdOrCtrl+Shift+P"),
          { type: "separator" },
          item("导出事件日志…", "export-log"),
          item("打开审计日志目录", "audit-folder"),
          item("重启通信后端", "restart-backend"),
          ...(process.argv.includes("--dev")
            ? [{ role: "toggleDevTools", label: "开发者工具" }]
            : []),
        ],
      },
      {
        label: "帮助(&H)",
        submenu: [
          item("使用说明与支持范围", "help", "F1"),
          item("关于 IEC61850 Service Studio", "about"),
        ],
      },
    ]),
  );
}

module.exports = { buildMenu };
