/**
 * opencode-tui-call-status  —  OpenCode V2 TUI 插件
 *
 * 在输入框下方的状态行显示实时的模型调用进展：
 *   ▶ 读文件 src/main.ts   3.2s  ↑12.4k  1.2M/1.0M·115%  $0.014
 *
 * ── V2 插件契约（三条硬性要求，勿删）────────────────────────
 *  1. 入口是 default export { id, setup(context) }，不是 { tui() }。
 *     宿主校验器要求 id 为非空字符串且 setup 为函数，否则抛
 *     `Invalid V2 TUI plugin module`。
 *
 *  2. 不要用 JSX 语法，用 jsx() 显式建元素。
 *     外部插件若含 JSX，宿主可能未对其做 Solid 编译，
 *     结果是 setup 静默失效且不报错。
 *
 *  3. package.json 必须导出 "./tui" 子路径。宿主解析不到
 *     该子路径会直接判定为 unsupported，同样不报错。
 *
 * ── V2 真实 slot 名 ────────────────────────────────────────
 *   app, home.footer, home.footer.status,
 *   prompt.footer, prompt.footer.status, prompt.footer.file,
 *   session.composer.top, session.panel,
 *   sidebar.content, sidebar.footer
 *
 * ── 注册方式 ────────────────────────────────────────────────
 *   context.ui.slot({ render, <placement>: "<slot 路径>" })
 *   placement 取 prepend/append/before/after/replace 之一，恰好一个。
 *   注意 slot 在 ui 上，不在 context 顶层。
 *   没有 order 字段，也没有 slots:{} 映射表。
 *
 * 排障：设 OPENCODE_CALL_STATUS_DEBUG=1 后看 %TEMP%\opencode\call-status-probe.log
 */

import { jsx } from "@opentui/solid/jsx-runtime"
import { createMemo, createSignal, createEffect, onCleanup } from "solid-js"
import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const h = jsx

// ── 状态文案 ────────────────────────────────────────────────
// 默认跟随系统语言；用 OPENCODE_CALL_STATUS_LANG=zh|en 可强制指定。
const LABELS = {
  en: {
    ready: "Ready",
    retry: "Retry",
    preparing: "◌ Preparing",
    thinking: "… Thinking",
    writing: "✎ Writing",
    generating: "◐ Generating",
    done: "✓ Done",
  },
  zh: {
    ready: "就绪",
    retry: "重试",
    preparing: "◌ 准备",
    thinking: "… 思考中",
    writing: "✎ 输出中",
    generating: "◐ 生成中",
    done: "✓ 完成",
  },
}

export function detectLang() {
  const forced = (process.env.OPENCODE_CALL_STATUS_LANG || "").toLowerCase()
  if (forced === "zh" || forced === "cn") return "zh"
  if (forced === "en") return "en"
  const loc = [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  return /(^|[_\-.])(zh|cn|chs|cht)([_\-.]|$)/.test(loc) ? "zh" : "en"
}

const L = LABELS[detectLang()]

// ── 装载探针（排障用）────────────────────────────────────────
// 设 OPENCODE_CALL_STATUS_DEBUG=1 启用，用来区分三种失败：
//   模块没加载 / setup 没跑 / slot 没渲染
// 产物写到 %TEMP%\opencode\call-status-probe.log
// 默认关闭 —— 关闭时 probe() 是空函数，零 I/O。
const DEBUG = !!process.env.OPENCODE_CALL_STATUS_DEBUG
const PROBE = join(tmpdir(), "opencode", "call-status-probe.log")
function probe(stage, extra) {
  if (!DEBUG) return
  try {
    appendFileSync(PROBE, `${new Date().toISOString()} ${stage}${extra ? " " + extra : ""}\n`)
  } catch {}
}
probe("module-loaded")

// ────────────────────────────────────────────────────────────
// 格式化
// ────────────────────────────────────────────────────────────
export function fmtTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return "0"
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M"
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k"
  return String(Math.round(n))
}

export function fmtDur(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s"
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s"
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m${String(s).padStart(2, "0")}s`
}

export function fmtCost(n) {
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 0.01) return "$" + n.toFixed(3)
  if (n >= 0.0001) return "$" + n.toFixed(5)
  return "$" + n.toExponential(1)
}

export function totalTokens(t) {
  if (!t) return 0
  return (
    (t.input || 0) +
    (t.output || 0) +
    (t.reasoning || 0) +
    ((t.cache && t.cache.read) || 0) +
    ((t.cache && t.cache.write) || 0)
  )
}

// ────────────────────────────────────────────────────────────
// 纯推导逻辑（可脱离渲染器单测）
// ────────────────────────────────────────────────────────────

/** 工具的展示名：V2 没有 state.title，优先从 metadata 取 */
export function toolTitle(c) {
  const md = c?.state?.metadata
  return (md && (md.title || md.name || md.summary)) || c?.name || "tool"
}

/**
 * 当前会话 id。
 * slot 输入里的 sessionID 是可选的（首页为 undefined），
 * 此时回退到路由 —— router.current() 在 Solid computation 里读是响应式的。
 */
export function activeSessionID(context, input) {
  if (input?.sessionID) return input.sessionID
  try {
    const r = context?.ui?.router?.current?.()
    if (r && r.type === "session" && r.sessionID) return r.sessionID
  } catch {}
  return undefined
}

/** 查模型上下文窗口；拿不到就返回 0（该段指标自动省略） */
export function modelLimit(ctx, model) {
  try {
    const list = ctx?.data?.location?.model?.list?.() || []
    const m = list.find(
      (x) =>
        (x?.providerID === model?.providerID && (x?.modelID === model?.modelID || x?.id === model?.modelID)) ||
        x?.id === model?.modelID,
    )
    const lim = m?.limit?.context ?? m?.context
    return typeof lim === "number" && lim > 0 ? lim : 0
  } catch {
    return 0
  }
}

/**
 * 当前生效的模型：优先用 prompt 选中的（响应式），
 * 没有就退回最后一条 assistant 消息自带的 model。
 */
export function currentModel(ctx, last) {
  try {
    const m = ctx?.ui?.model?.current?.()
    if (m?.modelID) return { providerID: m.providerID, modelID: m.modelID }
  } catch {}
  return { providerID: last?.model?.providerID, modelID: last?.model?.id }
}

/**
 * 从 context 推导当前活动与指标。
 * @param ctx      V2 Context
 * @param sessionID 会话 id，可为 undefined（首页）
 * @param now      毫秒时间戳，由外部 signal 注入，仅用于算耗时
 */
export function compute(ctx, sessionID, now) {
  const out = {
    busy: false,
    label: L.ready,
    tone: "muted",
    tokens: 0,
    cost: 0,
    sessionCost: 0,
    elapsed: 0,
    toolElapsed: 0,
    model: "",
    contextWindow: 0,
    contextPct: 0,
  }
  if (!sessionID) return out

  try {
    out.busy = ctx.data.session.status(sessionID) === "running"
  } catch {}
  try {
    out.sessionCost = ctx.data.session.cost(sessionID) || 0
  } catch {}

  const msgs = ctx.data.session.message.list(sessionID) || []
  let last = null
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.type === "assistant") {
      last = msgs[i]
      break
    }
  }
  if (!last) return out

  out.model = last.model?.id || ""
  out.cost = last.cost || 0
  out.tokens = totalTokens(last.tokens)
  out.contextWindow = modelLimit(ctx, currentModel(ctx, last))

  const created = last.time?.created || 0
  if (created) out.elapsed = ((last.time?.completed) || now) - created

  const content = last.content || []

  // 1) 重试
  if (last.retry) {
    out.label = `${L.retry} ${last.retry.attempt || 1}`
    out.tone = "warning"
    return out
  }

  // 2) 正在执行的工具
  for (const c of content) {
    if (c?.type !== "tool" || c.state?.status !== "running") continue
    out.label = "▶ " + toolTitle(c)
    out.tone = "info"
    const ran = c.time?.ran
    if (ran) out.toolElapsed = now - ran
    return out
  }

  // 3) 工具入参还在流式接收
  for (const c of content) {
    if (c?.type !== "tool" || c.state?.status !== "streaming") continue
    out.label = L.preparing + " " + toolTitle(c)
    out.tone = "muted"
    return out
  }

  // 4) 正在推理：最后一段 reasoning 尚未 completed
  for (let i = content.length - 1; i >= 0; i--) {
    const c = content[i]
    if (c?.type === "reasoning" && c.time && c.time.completed === undefined) {
      out.label = L.thinking
      out.tone = "info"
      return out
    }
  }

  // 5) 正在输出正文：running、未 finish，且确实已经吐出正文
  //    必须要求 hasText，否则「刚开工、还没出字」也会被误报成输出中，
  //    下面的「生成中」就成了永远走不到的死代码。
  const hasText = content.some((c) => c?.type === "text" && c.text)
  if (out.busy && !last.finish && hasText) {
    out.label = L.writing
    out.tone = "success"
    return out
  }

  // 6) 忙碌但还没有可判定的阶段
  if (out.busy) {
    out.label = L.generating
    out.tone = "info"
    return out
  }

  // 7) 空闲：回显上一条的用时
  if (out.elapsed > 0) {
    out.label = L.done
    out.tone = "success"
  }
  return out
}

// ────────────────────────────────────────────────────────────
// 组件
// ────────────────────────────────────────────────────────────

/** tone -> 主题色。ResolvedTheme 里 text.feedback 的四个 kind */
function toneColor(theme, tone) {
  const fb = theme?.text?.feedback
  switch (tone) {
    case "info":
      return fb?.info?.base || theme?.text?.base
    case "success":
      return fb?.success?.base || theme?.text?.base
    case "warning":
      return fb?.warning?.base || theme?.text?.base
    case "error":
      return fb?.error?.base || theme?.text?.base
    default:
      return theme?.text?.muted || theme?.text?.base
  }
}

function StatusLine(props) {
  const ctx = props.ctx
  const sid = () => activeSessionID(ctx, props.input)
  const tick = () => props.tick()

  // 只依赖 tick/sid，不依赖 now，避免 effect 自激
  const busy = createMemo(() => {
    tick()
    const s = sid()
    if (!s) return false
    try {
      return ctx.data.session.status(s) === "running"
    } catch {
      return false
    }
  })

  // 耗时计时：仅 running 时每 250ms 推进
  const [now, setNow] = createSignal(Date.now())
  let timer = null
  createEffect(() => {
    if (busy() && timer === null) {
      timer = setInterval(() => {
        setNow(Date.now())
        try {
          ctx.renderer?.requestRender?.()
        } catch {}
      }, 250)
    } else if (!busy() && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  })
  onCleanup(() => {
    if (timer) clearInterval(timer)
  })

  const view = createMemo(() => {
    tick()
    return compute(ctx, sid(), now())
  })

  const metrics = createMemo(() => {
    const v = view()
    const seg = []

    // 工具执行中优先显示工具自身耗时，否则显示整轮耗时
    const dur = v.busy && v.toolElapsed > 0 ? v.toolElapsed : v.elapsed
    if (dur > 0) seg.push(fmtDur(dur))

    if (v.tokens > 0) {
      seg.push("↑" + fmtTokens(v.tokens))
      if (v.contextWindow > 0) {
        const pct = Math.round((v.tokens / v.contextWindow) * 100)
        v.contextPct = pct
        seg.push(`${fmtTokens(v.tokens)}/${fmtTokens(v.contextWindow)}·${pct}%`)
      }
    }

    const cost = v.busy ? v.cost : v.sessionCost
    const c = fmtCost(cost)
    if (c) seg.push(c)

    if (!seg.length && v.model) seg.push(v.model)
    return seg.join("  ")
  })

  const labelColor = createMemo(() => {
    const v = view()
    const theme = ctx.theme
    // 上下文占用过高时覆盖活动色
    if (v.contextPct >= 90) return toneColor(theme, "error")
    if (v.contextPct >= 70) return toneColor(theme, "warning")
    return toneColor(theme, v.tone)
  })

  // 首页没有会话，不渲染
  const visible = createMemo(() => !!sid())

  return h("box", {
    flexDirection: "row",
    gap: 1,
    get children() {
      if (!visible()) return null
      return [
        h("text", { fg: labelColor(), get children() { return view().label } }),
        h("text", {
          fg: ctx.theme?.text?.muted,
          get children() {
            return metrics()
          },
        }),
      ]
    },
  })
}

// ────────────────────────────────────────────────────────────
// 插件入口
// ────────────────────────────────────────────────────────────
export default {
  id: "opencode-tui-call-status",

  setup(context) {
    probe("setup-invoked", `cwd=${context?.location?.directory ?? ctxdir(context)}`)

    // data 层本身是 Solid store（会自己 invalidate），这里再挂一个节流的
    // 心跳作为兜底，保证流式 delta 一定触发重绘。80ms 节流避免事件风暴。
    const [tick, setTick] = createSignal(0)
    let pending = false
    const stopListen = context.data.listen(() => {
      if (pending) return
      pending = true
      setTimeout(() => {
        pending = false
        setTick((n) => n + 1)
      }, 80)
    })

    // slot 注册在 ui 上，不在 context 上。
    // （踩过：写成 context.slot() 会报 "context.slot is not a function"）
    const off = context.ui.slot({
      append: "prompt.footer.status",
      render(input) {
        probe("slot-rendered", `session=${activeSessionID(context, input) ?? "(none)"}`)
        return h(StatusLine, { ctx: context, input, tick })
      },
    })

    probe("slot-registered")

    return () => {
      stopListen?.()
      off?.()
      probe("cleaned-up")
    }
  },
}

function ctxdir(context) {
  try {
    return context.client?.get?.() ? "?" : "?"
  } catch {
    return "?"
  }
}
