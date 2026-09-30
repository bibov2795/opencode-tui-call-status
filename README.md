# opencode-tui-call-status

Live model-call status line for the **OpenCode V2 TUI** — pinned under the prompt box.

```
… Thinking   1.8s  ↑8.1k
▶ Read src/main.ts   3.2s  ↑12.4k  1.2M/1.0M·115%  $0.014
✎ Writing   4.2s  ↑12.4k  $0.014
✓ Done   6.8s  ↑12.4k  $0.014
```

Shows what the model is doing right now, plus elapsed time, token counts, context-window usage and cost. Ticks at 250 ms while the session is running.

## Requirements

- **OpenCode 2.x** (V2). The V1 plugin API is different and this package will not load there.
- Node.js ≥ 20

## Install

```bash
npm install opencode-tui-call-status
```

Then register it in **`cli.json`** (not `opencode.json`):

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-tui-call-status"]
}
```

Config file locations:

| Platform | Path |
|---|---|
| Windows | `%USERPROFILE%\.config\opencode\cli.json` |
| macOS / Linux | `~/.config/opencode/cli.json` |

**Restart the TUI after editing.** Plugin modules are resolved at startup; a config reload is not enough to pick up a newly registered plugin.

### Installing from source

```bash
git clone https://github.com/bibov2795/opencode-tui-call-status.git
cd opencode-tui-call-status
npm install
```

Then point the config at the absolute path:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-tui-call-status"]
}
```

Relative paths resolve against the process working directory and are silently dropped — always use an absolute path.

## Verify it loaded

```bash
opencode api get /api/skill > /dev/null   # forces a config load
```

If nothing shows up under the prompt box, enable the debug probe and read its log:

```bash
# PowerShell
$env:OPENCODE_CALL_STATUS_DEBUG = "1"
# then start the TUI and read:
cat "$TEMP/opencode/call-status-probe.log"    # macOS/Linux
type "$env:TEMP\opencode\call-status-probe.log"  # Windows
```

The log has one line per lifecycle stage, which tells you exactly where loading stopped:

| Last line | Meaning |
|---|---|
| *(no file)* | module never loaded — check the `plugins` path in `cli.json` |
| `module-loaded` | module parsed, but `setup()` never ran |
| `setup-invoked` | `setup()` ran, but slot registration threw |
| `slot-registered` | slot claimed, but the host never rendered it |
| `slot-rendered` | fully working |

On Windows the probe path is `%TEMP%\opencode\call-status-probe.log`.

## Configuration

### Language

Status labels follow your system locale. Override with:

```bash
OPENCODE_CALL_STATUS_LANG=zh   # 中文
OPENCODE_CALL_STATUS_LANG=en   # English
```

### Where the line appears

Edit `tui.js`, find the `context.ui.slot({...})` call and change the `append` key to any valid slot path:

```js
const off = context.ui.slot({
  append: "prompt.footer.status",   // ← change this
  render(input) { /* ... */ },
})
```

Valid slot paths in OpenCode V2:

```
app
home.footer              home.footer.status
prompt.footer            prompt.footer.status        prompt.footer.file
session.composer.top     session.panel
sidebar.content          sidebar.footer
```

Placement keys — use **exactly one** of `prepend` / `append` / `before` / `after` / `replace`.

### Which metrics to show

The `metrics()` memo in `tui.js` builds the right-hand segment. Remove the corresponding `seg.push(...)` calls to drop a metric. Colour thresholds for context usage (≥70 % warning, ≥90 % error) live in `labelColor()`.

## Development

```bash
npm install
npm test
```

The test suite runs headless — it exercises the plugin contract, slot claim shape, activity derivation, metric formatting and language detection. It does **not** cover real element rendering, because `@opentui/solid`'s `createElement` needs a live `CliRenderer` and throws `No renderer found` without one. That path is only verifiable by starting the TUI.

## Notes for plugin authors

The three V2 requirements, all of which fail *silently* or misleadingly if you get them wrong:

1. **The entry point is `setup(context)`, not `tui()`.** The host validator requires `id` to be a non-empty string and `setup` to be a function. A module exporting `{ id, tui }` throws `Invalid V2 TUI plugin module`. Beware: the type definitions shipped in `@opencode-ai/plugin@1.18.33` still document `tui` — they are stale. Use `@opencode/plugin@2.x`.

2. **Do not use JSX syntax.** Build elements with an explicit `jsx()` call. If an external plugin contains JSX, the host may not run it through the Solid transform, and `setup` then fails silently with no error.

3. **`package.json` must export the `./tui` subpath.** Without it the host's resolver marks the package `unsupported` — again with no error message.

Also: `context.ui.slot()` lives on **`ui`**, not on `context` itself. `context.slot()` throws `context.slot is not a function`, and the type definitions make this easy to misread because the `slot` member sits immediately above `export interface Context`.

## License

MIT
