# opencode-tui-call-status

在 **OpenCode V2 TUI** 的输入框下方显示实时的模型调用进展。

```
… Thinking   1.8s  ↑8.1k
▶ 读文件 src/main.ts   3.2s  ↑12.4k  1.2M/1.0M·115%  $0.014
✎ 输出中   4.2s  ↑12.4k  $0.014
✓ 完成   6.8s  ↑12.4k  $0.014
```

同时显示**当前在做什么**和**量化指标**（耗时 / token / 上下文占用 / 花费）。
会话运行时以 250ms 间隔刷新。

> 英文文档见 [README.md](./README.md)

## 环境要求

- **OpenCode 2.x（V2）**。V1 的插件 API 完全不同，本包在 V1 下不会加载。
- Node.js ≥ 20

## 安装

```bash
npm install opencode-tui-call-status
```

然后注册到 **`cli.json`**（注意：不是 `opencode.json`）：

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-tui-call-status"]
}
```

配置文件位置：

| 平台 | 路径 |
|---|---|
| Windows | `%USERPROFILE%\.config\opencode\cli.json` |
| macOS / Linux | `~/.config/opencode/cli.json` |

**改完配置必须重启 TUI。** 插件模块在启动时解析，单纯 reload 配置不会加载新注册的插件。

### 从源码安装

```bash
git clone https://github.com/bibov2795/opencode-tui-call-status.git
cd opencode-tui-call-status
npm install
```

然后在配置里指向**绝对路径**：

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-tui-call-status"]
}
```

> 相对路径按进程 cwd 解析，会被**静默丢弃**。务必用绝对路径。

## 验证是否加载成功

先设一个环境变量打开调试探针，再启动 TUI：

```powershell
# PowerShell —— 用户级永久生效
[Environment]::SetEnvironmentVariable('OPENCODE_CALL_STATUS_DEBUG','1','User')
```

然后读探针日志：

```powershell
Get-Content "$env:TEMP\opencode\call-status-probe.log"
```

日志每个生命周期阶段一行，能直接定位卡在哪一步：

| 最后一行 | 含义 |
|---|---|
| *（文件不存在）* | 模块压根没加载 —— 检查 `cli.json` 里的 `plugins` 路径 |
| `module-loaded` | 模块解析成功，但 `setup()` 没执行 |
| `setup-invoked` | `setup()` 执行了，但 slot 注册抛异常 |
| `slot-registered` | slot 抢到了，但宿主没渲染 |
| `slot-rendered` | 完全正常 |

## 配置

### 语言

状态文案默认跟随系统区域设置。显式覆盖：

```powershell
# 中文
[Environment]::SetEnvironmentVariable('OPENCODE_CALL_STATUS_LANG','zh','User')
# 英文
[Environment]::SetEnvironmentVariable('OPENCODE_CALL_STATUS_LANG','en','User')
```

判定优先级：`OPENCODE_CALL_STATUS_LANG` > `LC_ALL` / `LC_MESSAGES` / `LANG` > 系统区域 > `en`。

> Windows 上 PowerShell 默认不设 `LANG` / `LC_ALL`，所以走系统区域兜底。
> 注意 Node 的 `Intl` 反映的是**区域格式**而非 UI 语言 —— 如果你的系统区域是
> `en-US` 但界面是中文，那兜底会得到 `en`，此时需要显式设上面的环境变量。

### 状态行出现在哪

编辑 `tui.js`，找到 `context.ui.slot({...})`，改 `append` 的值：

```js
const off = context.ui.slot({
  append: "prompt.footer.status",   // ← 改这里
  render(input) { /* ... */ },
})
```

OpenCode V2 的全部合法 slot：

```
app
home.footer              home.footer.status
prompt.footer            prompt.footer.status        prompt.footer.file
session.composer.top     session.panel
sidebar.content          sidebar.footer
```

placement 键用 `prepend` / `append` / `before` / `after` / `replace` 中的**恰好一个**。

### 显示哪些指标

`tui.js` 里的 `metrics()` memo 负责拼右侧那一段。删掉对应的 `seg.push(...)` 即可去掉某个指标。
上下文占用的配色阈值（≥70% warning、≥90% error）在 `labelColor()` 里。

## 开发

```bash
npm install
npm test
```

测试是无头运行的，覆盖插件契约、slot claim 形状、活动状态推导、指标格式化、语言检测。

**不覆盖**真实元素渲染 —— `@opentui/solid` 的 `createElement` 需要一个活的
`CliRenderer`，无头环境下会抛 `No renderer found`。这段只能靠实际启动 TUI 确认。

## 给插件作者的踩坑笔记

V2 有三条硬性要求，**踩错了都是静默失败或错误误导**：

1. **入口是 `setup(context)`，不是 `tui()`。** 宿主校验器要求 `id` 为非空字符串且 `setup` 为函数。导出 `{ id, tui }` 会抛 `Invalid V2 TUI plugin module`。**注意**：`@opencode-ai/plugin@1.18.33` 的类型定义里仍然写着 `tui`，那是过时的，用 `@opencode/plugin@2.x`。

2. **不要用 JSX 语法**，用显式 `jsx()` 建元素。外部插件若含 JSX，宿主可能没对其做 Solid 编译，结果 `setup` 静默失效且不报错。

3. **`package.json` 必须导出 `./tui` 子路径。** 解析不到该子路径，宿主会直接判定包为 `unsupported` —— 同样不报错。

另外：`context.ui.slot()` 在 **`ui`** 上，不在 `context` 顶层。写 `context.slot()` 会报
`context.slot is not a function`。类型定义容易看错，因为 `slot` 成员的位置就紧挨在
`export interface Context` 之前，属于 `UI` 接口。

## License

MIT
