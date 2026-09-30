/**
 * 无头冒烟测试 —— 不启动 TUI。
 *
 * 能验证：
 *   A. 模块加载、default 导出形状（V2 契约：必须有 id + setup）
 *   B. setup() 真的被调用、context.ui.slot() 收到合法 claim
 *   C. compute() 的活动推导与指标推导
 *
 * 验证不了：
 *   真实元素渲染。@opentui/solid 的 createElement 需要活的 CliRenderer，
 *   无头环境会抛 "No renderer found"。那一段只能靠实际启动 TUI 确认。
 *
 * 注意：tui.js 在模块顶层就根据环境变量定下了文案语言，
 * 所以下面必须先设好 env 再用动态 import —— 静态 import 会被提升到前面。
 */
process.env.OPENCODE_CALL_STATUS_LANG = "zh"

const { compute, fmtTokens, fmtDur, fmtCost, totalTokens, toolTitle, modelLimit, currentModel, activeSessionID, detectLang } =
  await import("../tui.js")

let pass = 0
let fail = 0
function check(label, cond, extra = "") {
  if (cond) {
    pass++
    console.log(`  PASS  ${label}${extra ? "  " + extra : ""}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}${extra ? "  " + extra : ""}`)
  }
}

// ══════════════════════ A. V2 插件契约 ══════════════════════
console.log("\n=== A. V2 插件契约 ===")
const mod = await import("../tui.js")
check("default 导出存在", !!mod.default)
check("id 是非空字符串", typeof mod.default.id === "string" && mod.default.id.length > 0, mod.default.id)
check("setup 是函数（不是 tui）", typeof mod.default.setup === "function")
// 复刻二进制里的校验器字面量
function binaryValidator(m) {
  return typeof m === "object" && m !== null && "id" in m && typeof m.id === "string" && m.id.length > 0 && "setup" in m && typeof m.setup === "function"
}
check("通过二进制校验器 xCt", binaryValidator(mod.default), "否则会抛 Invalid V2 TUI plugin module")

// ══════════════════════ B. setup + slot 注册 ══════════════════════
console.log("\n=== B. setup 与 slot claim ===")

let claim = null
let stopListenCalled = false
const api = {
  location: { directory: "D:\\test" },
  renderer: { requestRender() {} },
  theme: {
    text: {
      base: "#fff",
      muted: "#888",
      feedback: {
        info: { base: "#0af" },
        success: { base: "#0d0" },
        warning: { base: "#fa0" },
        error: { base: "#f00" },
      },
    },
  },
  data: {
    listen(_cb) {
      return () => {
        stopListenCalled = true
      }
    },
    session: {
      status: () => st,
      cost: () => sessionCost,
      message: { list: () => msgs },
    },
    location: { model: { list: () => models } },
  },
  // 注意：slot 在 ui 上，不在 context 上。镜像真实 Context 形状。
  ui: {
    router: { current: () => route },
    model: { current: () => selectedModel },
    slot(c) {
      claim = c
      return () => {
        claim = null
      }
    },
  },
}
let st = "running"
let sessionCost = 0
let msgs = []
let route = { type: "session", sessionID: "ses_route" }
let selectedModel = undefined
let models = [{ id: "gemini-3.1-pro-preview", modelID: "gemini-3.1-pro-preview", providerID: "google", limit: { context: 1048576 } }]

// 契约守卫：防止 mock 与真实 Context 漂移（已经因此栽过两次）
check("slot 不在 context 顶层", typeof api.slot === "undefined")
check("slot 在 ui 上", typeof api.ui.slot === "function")

const cleanup = await mod.default.setup(api)
check("setup() 已执行", typeof cleanup === "function")
check("context.ui.slot() 被调用", !!claim)
check("claim 有 render", typeof claim?.render === "function")

// placement 恰好一个，且是 SlotMap 里的合法绝对路径
const placements = ["prepend", "append", "before", "after", "replace"].filter((k) => k in (claim || {}))
check("恰好一个 placement 键", placements.length === 1, placements.join(",") || "(无)")
const SLOTMAP = ["app", "home.footer", "home.footer.status", "prompt.footer", "prompt.footer.status", "prompt.footer.file", "session.composer.top", "session.panel", "sidebar.content", "sidebar.footer"]
check("placement 值是合法 slot 路径", SLOTMAP.includes(claim?.[placements[0]]), String(claim?.[placements[0]]))
check("未使用不存在的 order 字段", !("order" in (claim || {})))
check("未使用 V1 的 slots:{} 映射", !("slots" in (claim || {})))

cleanup?.()
check("cleanup 会注销 slot 与监听", claim === null && stopListenCalled)

// ══════════════════════ C. 格式化 ══════════════════════
console.log("\n=== C. 格式化 ===")
check("fmtTokens(1234)", fmtTokens(1234) === "1.2k", fmtTokens(1234))
check("fmtTokens(1234567)", fmtTokens(1234567) === "1.2M", fmtTokens(1234567))
check("fmtTokens(0)", fmtTokens(0) === "0")
check("fmtDur(3200)", fmtDur(3200) === "3.2s", fmtDur(3200))
check("fmtDur(65000)", fmtDur(65000) === "1m05s", fmtDur(65000))
check("fmtCost(0)", fmtCost(0) === null)
check("fmtCost(0.0142)", fmtCost(0.0142) === "$0.014", fmtCost(0.0142))
check("fmtCost(0.00042)", fmtCost(0.00042) === "$0.00042", fmtCost(0.00042))
check("totalTokens 求和", totalTokens({ input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 1 } }) === 21)
check("toolTitle 取 metadata.title", toolTitle({ name: "read", state: { metadata: { title: "读文件 a.ts" } } }) === "读文件 a.ts")
check("toolTitle 回退到 name", toolTitle({ name: "bash", state: { metadata: {} } }) === "bash")

const GEM = { providerID: "google", modelID: "gemini-3.1-pro-preview" }
check("modelLimit 读到 limit.context", modelLimit(api, GEM) === 1048576)
check("modelLimit 查不到返回 0", modelLimit(api, { providerID: "x", modelID: "y" }) === 0)
check("currentModel 回退到消息自带 model", currentModel(api, { model: { id: "claude-x", providerID: "anthropic" } }).modelID === "claude-x")
selectedModel = { providerID: "google", modelID: "gemini-3.1-pro-preview" }
check("currentModel 优先 prompt 选中", currentModel(api, { model: { id: "old" } }).modelID === "gemini-3.1-pro-preview")
selectedModel = undefined

check("activeSessionID 取 slot 输入", activeSessionID(api, { sessionID: "ses_input" }) === "ses_input")
check("activeSessionID 回退到路由", activeSessionID(api, {}) === "ses_route")
route = { type: "home" }
check("activeSessionID 首页无会话", activeSessionID(api, {}) === undefined)
route = { type: "session", sessionID: "ses_route" }

// ══════════════════════ D. 活动推导 ══════════════════════
console.log("\n=== D. 活动推导 ===")
const NOW = Date.now()
const baseMsg = (over = {}) => ({
  id: "msg_1",
  type: "assistant",
  agent: "build",
  model: { id: "gemini-3.1-pro-preview", providerID: "google" },
  time: { created: NOW - 3200 },
  cost: 0.0142,
  tokens: { input: 90_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } },
  content: [],
  ...over,
})

const cases = [
  // [名称, sessionStatus, content, 消息字段覆盖, 期望标签, 消息列表是否置空]
  ["会话无消息", "idle", [], {}, "就绪", true],
  ["工具运行中", "running",
    [{ type: "tool", name: "read", state: { status: "running", metadata: { title: "读文件 src/main.ts" } }, time: { created: NOW - 1500, ran: NOW - 1500 } }],
    {}, "▶ 读文件 src/main.ts", false],
  ["工具入参流式", "running",
    [{ type: "tool", name: "bash", state: { status: "streaming", input: "ls" } }],
    {}, "◌ 准备 bash", false],
  ["推理中", "running",
    [{ type: "reasoning", text: "…", time: { created: NOW - 800 } }],
    {}, "… 思考中", false],
  ["正文流式（已有内容）", "running", [{ type: "text", text: "hello" }], {}, "✎ 输出中", false],
  ["正文流式（刚出首字前）", "running", [{ type: "text", text: "" }], {}, "◐ 生成中", false],
  ["忙碌且无任何产出", "running", [], {}, "◐ 生成中", false],
  ["忙碌但已 finish", "running", [], { finish: "tool-calls" }, "◐ 生成中", false],
  ["重试", "running", [], { retry: { attempt: 2, at: NOW, error: {} } }, "重试 2", false],
  ["空闲", "idle", [], { finish: "stop" }, "✓ 完成", false],
]

for (const [name, status, content, over, expect, emptyMsgs] of cases) {
  st = status
  msgs = emptyMsgs ? [] : [baseMsg({ content, ...over })]
  const r = compute(api, "ses_x", NOW)
  check(name, r.label === expect, `-> "${r.label}"${r.label === expect ? "" : `  期望 "${expect}"`}`)
}

// 优先级：重试 > 工具运行 > 工具流式 > 推理 > 正文
st = "running"
msgs = [baseMsg({
  content: [
    { type: "tool", name: "read", state: { status: "completed", metadata: { title: "旧" } } },
    { type: "reasoning", text: "…", time: { created: NOW - 900 } },
    { type: "text", text: "done" },
    { type: "tool", name: "bash", state: { status: "running", metadata: { title: "跑测试" } }, time: { ran: NOW - 400 } },
  ],
})]
check("优先级：工具运行压过已完成的工具", compute(api, "ses_x", NOW).label === "▶ 跑测试")
check("工具耗时单独计算", Math.abs(compute(api, "ses_x", NOW).toolElapsed - 400) < 50, `${compute(api, "ses_x", NOW).toolElapsed}ms`)

// ══════════════════════ E. 指标推导 ══════════════════════
console.log("\n=== E. 指标推导 ===")
st = "running"
msgs = [baseMsg()]
sessionCost = 0
let r = compute(api, "ses_x", NOW)
check("整轮耗时", Math.abs(r.elapsed - 3200) < 50, `${r.elapsed}ms`)
check("token 合计", r.tokens === 100_000, String(r.tokens))
check("上下文 10%", r.contextPct === 0 && r.contextWindow === 1048576, `${r.contextWindow} 窗口`)
check("单次花费", Math.abs(r.cost - 0.0142) < 1e-9, String(r.cost))
check("busy 标志", r.busy === true)

msgs = [baseMsg({ tokens: { input: 800_000, output: 200_000, reasoning: 0, cache: { read: 0, write: 0 } } })]
r = compute(api, "ses_x", NOW)
check("超窗 token 也能算", r.tokens === 1_000_000, String(r.tokens))

sessionCost = 0.42
r = compute(api, "ses_x", NOW)
check("会话累计花费", Math.abs(r.sessionCost - 0.42) < 1e-9, String(r.sessionCost))

// sessionID 缺失 / 异常都不崩
check("sessionID 为空不崩", compute(api, undefined, NOW).label === "就绪")
const broken = { data: { session: { status() { throw new Error("x") }, cost: null, message: { list: () => null } } } }
check("数据层抛异常不崩", compute(broken, "s", NOW).label === "就绪")

// ══════════════════════ F. 语言检测 ══════════════════════
console.log("\n=== F. 语言检测 ===")
const savedLang = process.env.OPENCODE_CALL_STATUS_LANG
const savedLC = process.env.LC_ALL
const savedL = process.env.LANG
delete process.env.LC_ALL

process.env.OPENCODE_CALL_STATUS_LANG = "en"
check("强制 en", detectLang() === "en")
process.env.OPENCODE_CALL_STATUS_LANG = "zh"
check("强制 zh", detectLang() === "zh")
process.env.OPENCODE_CALL_STATUS_LANG = "cn"
check("强制 cn 归一到 zh", detectLang() === "zh")

delete process.env.OPENCODE_CALL_STATUS_LANG
process.env.LANG = "zh_CN.UTF-8"
check("系统语言 zh_CN → zh", detectLang() === "zh")
process.env.LANG = "zh_TW.UTF-8"
check("系统语言 zh_TW → zh", detectLang() === "zh")
process.env.LANG = "en_US.UTF-8"
check("系统语言 en_US → en", detectLang() === "en")
process.env.LANG = "de_DE.UTF-8"
check("系统语言 de_DE → en", detectLang() === "en")
delete process.env.LANG
check("无语言变量 → en", detectLang() === "en")

// 还原环境，避免影响后续断言
if (savedLang === undefined) delete process.env.OPENCODE_CALL_STATUS_LANG
else process.env.OPENCODE_CALL_STATUS_LANG = savedLang
if (savedLC === undefined) delete process.env.LC_ALL
else process.env.LC_ALL = savedLC
if (savedL === undefined) delete process.env.LANG
else process.env.LANG = savedL

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
