<p align="center"><img src="assets/icon.png" alt="Boofer" width="160" /></p>

# Boofer 👻

A little ghost that lives on your screen while your AI agents code. It shows you live where **Antigravity** (Gemini 3.1 Pro, Gemini 4 Argon, Flash…), **Claude Code** and **Codex** are at, lets you approve requests without switching windows, and goes *ding* when it's done.

> Independent project, not affiliated with Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.

## Download (Windows 10 / 11)

👉 **[Latest version](https://github.com/ItzSized/Boofer/releases/latest)**, nothing to compile, pick one:

- **`Boofer_…_x64-setup.exe`**: installer (recommended), no admin rights needed
- **`Boofer_…_x64_en-US.msi`**: MSI installer, for the whole PC
- **`Boofer.exe`**: portable version, double-click and go

Nothing else to install: the installers add WebView2 if it's missing (already there on Windows 10/11), and you need neither Node nor Rust. For Claude Code: **Settings → Claude Code → Connect**. Antigravity and Codex are detected automatically.

What changed in each version: [CHANGELOG.md](CHANGELOG.md), the notes of each [release](https://github.com/ItzSized/Boofer/releases), or **Settings → What's new** in the app.

## What it does

- **Live status**: the project, your request, the current action ("Editing pet.js", "Running: npm run build"), elapsed time, time left (estimated from tasks already done, smoothed so it doesn't jump around), number of actions, changed files, failures and active subagents.
- **Overall and per-step progress**: when Claude keeps a task list, Boofer shows "Step 2/5 · Writing the tests — 70%" and a total ("Total 42%"). Without a list, an estimate of the total. The total never goes back and only reaches 100% at the end.
- **Done ping**: the ghost jumps and the bubble says "Claudio is done! · Done in 45 s", with what the task cost in tokens.
- **Approvals**: when Claude Code asks for a permission, a card shows the command or file with **Allow / Always / Deny**. Without an answer within 55 s, or if you click "Answer in Claude Code", Claude Code asks you as usual.
- **Several sessions**: each session has its color and tab. Boofer automatically shows the session of the project open in the window in front, and keeps its spot in each window.
- **A real companion**: its eyes follow the mouse, it waves on hover, loves being petted (click), falls asleep when you stop moving and does little spins.
- **Skins and accessories**: 8 skins (Classic, Strawberry, Mint, Sky, Pumpkin, Jelly, Gold, Night) and 6 accessories (bow, hat, crown, headphones, sprout, glasses), plus seasonal outfits.
- **Settings** (click the tray icon, double-click Boofer, or right-click → Settings): light / dark / auto theme, on your editor only or everywhere on the desktop, followed editors, start with Windows, follow the mouse, delay before sleeping, sounds and volume, size, approvals, and a button to connect Claude Code. Maximize the window for a two-column layout.
- **Do not disturb**: no more sounds or permission cards, for 30 min, 1 h, until tomorrow morning or with no end, from the tray or the right-click menu. It turns itself back on at the set time.
- **Bring the ghost back** (tray): lost off screen or under the taskbar, it comes back to its corner.
- **Status on hover of the tray icon**: "Boofer · my-project: Editing pet.js · 42% · ≈ 3 min left", even when the ghost is hidden.
- **Little phrases**: "Hi there!", "Ta-da! ✨", "Psst… it needs you", and reactions when you pet it or wake it up.
- **Model usage** (tray → "Model usage…", or click the little card under the ghost): which AIs you really use (Claude Opus 5.5, Gemini 3.1 Pro, Gemini 4 Argon, GPT-6…), their share, their activity over 14 days, what it would cost at API prices, and your Codex plan limits. Only models found on your PC show up, and everything is read locally.
- **Compaction and context**: a "🧠 Context 64%" gauge warns you before Claude Code compacts, and during a compaction the ghost squeezes like an accordion with a % and the time left (based on how long your previous compactions took).
- **Follow me** (right-click, tray or settings): it jumps onto the window you're in, whatever the app. Off, it stays on your editor or where you put it on the desktop.
- **Save tokens** (Settings → ✂️ Tokens): make Claude Code compact earlier (smaller context, every message costs less), short answers, and a prompt compressor into "AI language" (local and free, or rewritten by Claude Haiku). Shortcut: copy a prompt, then Ctrl+Alt+P.
- **Stop dangerous commands**: before an `rm -rf`, a `git push --force`, a `git reset --hard` or a disk format, the ghost crosses its arms and asks "Are you sure?". Without an answer within 55 s, it's blocked (Claude Code, even in auto mode).
- **Limit per AI** (Settings → 📊 Models): a daily token cap for Claude, Gemini and GPT, an alert at 80% and 100%, and "⚡ ahead / 🐢 behind" your pace.
- **Stuck agent alert**: when an agent hasn't moved for 8 minutes or failed 3 actions in a row.
- **Live** (Settings → 🟢 Live): the open AI apps and every running agent, with its model, its context in tokens, what fills it, and the time left.
- **Reprompt** (right-click or Ctrl+Alt+P): the copied prompt is rewritten just for the AI, shorter, locally or with Claude Haiku.
- **Browser AIs**, with nothing to install: in Chrome, Edge or Brave, Boofer also follows ChatGPT, Gemini, AI Studio, Claude, Grok, Perplexity, DeepSeek, Le Chat and Copilot (the visible tab of each window): live status, a beep and a notification when the answer is ready, and the history.
- **Click on the bubble or a tab**: brings the window of that session to the front, browser included.
- **Windows notifications** when a task finishes and you're not on your editor, and an alert when a plan limit goes over 80%.
- **Sound off?** If Boofer's sounds are off or your PC is muted, a notification tells you when a task finishes, even when you're on your editor (Settings → 🔕).
- **Animations to taste** (Settings → Animations): turn everything off at once for a still ghost, or just what bothers you (floating, arms, victory jump, spins, blinks, Zzz…).
- **🧪 Try it** (Settings): simulate a task, two sessions, a compaction, a request or a stop to see the ghost in action.
- **Stream mode**: always shown on a green background, ready for OBS's chroma key.
- **Shortcuts**: Ctrl+Alt+B to show or hide it, Ctrl+Alt+M for model usage.
- **It grows with you**: every finished task gives XP. Level 3 a glow, level 5 a golden halo, level 8 a golden aura. It looks tired when the context is almost full, and relieved after a compaction.
- **One session = one mini-ghost** in its color, which bounces while it works.
- **Automatic updates**: Boofer downloads the new version and installs it over the old one, nothing to uninstall, then restarts on the "What's new" list (at startup and every 6 h, never while an agent is working). A "Check for updates" button at the bottom of the settings, and a switch to do it by hand.
- **Day summary** around 6 pm (or right-click → My day).
- **History**: today's finished tasks, the agents' working time and the changed files, plus the week as a chart, in the settings.
- **Unobtrusive**: clicks go through the empty areas, and it closes with the × button, the right-click menu or the tray icon.

## Build it yourself (developers)

Not needed to use Boofer: every push to `main` rebuilds the installers and updates the GitHub release (`.github/workflows/release.yml`), with release notes written from the commits.

### Requirements

- Node.js 20+
- [Rust](https://rustup.rs) and the Visual Studio "Desktop development with C++" Build Tools
- WebView2 (already on Windows 10/11)

### Build

```bash
npm install
npm run release                 # exe only, in ~1 min: copied to the project root and restarted
npm run release -- --installer  # + .msi and .exe installers
npm run changelog               # rewrites CHANGELOG.md from the git history (also run by every build)
```

To develop without recompiling: `npm run tauri dev` (the interface reloads on every change). To work on the interface in a browser, without Rust: `npm run dev`, then right-click the ghost to run the demos.

### Commits and the changelog

Each commit subject becomes one line of the release notes and of [CHANGELOG.md](CHANGELOG.md), so write it in English, for the people using Boofer ("Double-click opens Boofer"), with details as `- ` lines in the body. Subjects starting with `Version x.y.z` are left out. A version gathers the commits since the previous `vX.Y.Z` tag.

## Connect Claude Code

The easiest way: **Settings → Claude Code → Connect**. Boofer adds its hooks to `~/.claude/settings.json` while keeping your settings (a `settings.json.booffer-backup` copy is made). Then restart Claude Code. If you had connected an older version, Boofer adds the new hooks (compaction) by itself at startup.

By hand: copy the `hooks` block from [hooks/claude-code-settings.example.json](hooks/claude-code-settings.example.json) into `~/.claude/settings.json` (merge it with your existing settings). Then open `/hooks` in Claude Code, or restart it.

The hooks send their events to Boofer at `http://127.0.0.1:47823`. If Boofer isn't running, `curl` gives up silently and Claude Code isn't bothered.

## Follow your own Claude API scripts

```js
import { trackStream } from "./reporters/anthropic.js";

const stream = client.messages.stream({ /* ... */ });
trackStream(stream, { label: "PDF summary" });
const message = await stream.finalMessage();
```

Full example: `npm run demo:api`.

## Add an agent

Everything goes through `POST http://127.0.0.1:47823/event/<source>` with a JSON body.

1. Create `src/agents/my-agent.js`, which extends `AgentAdapter` and implements `normalize(payload)` → `{ id, state, label?, progress?, project?, details? }`.
2. Add it to [src/agents/index.js](src/agents/index.js).

The possible states are in [src/core/states.js](src/core/states.js). A tool that already sends this format can use the `generic` source with no code.

## Architecture

```
src-tauri/src/
  lib.rs          local server (events + permissions), tray icon, single instance
  pet.rs          window: editor in front detection, spot per window, mouse following
  permission.rs   permission requests kept open until you answer
  guard.rs        dangerous commands that wait for "Stop!"
  settings.rs     settings (JSON), Claude Code hooks installation
  migrate.rs      clean-up after the Booffer → Boofer rename, shortcuts repair
src/
  agents/         one adapter per agent (Claude Code, Antigravity, Codex, browser, generic)
  core/           session tracker, states, event bus, usage and costs
  ui/             ghost (SVG, skins, accessories), bubble, tabs, cards, menu, settings pages
  settings.js     settings window
  audio/          sounds generated with Web Audio
scripts/
  release.mjs     local build
  changelog.mjs   CHANGELOG.md and the release notes, from the commits
```

Stack: [Tauri 2](https://tauri.app), vanilla JavaScript, Tailwind CSS 4, Vite.
