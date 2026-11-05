<p align="center"><img src="assets/icon.png" alt="Boofer" width="160" /></p>

# Boofer 👻

A little ghost that lives on your screen while your AI agents code. It shows you live where **Antigravity** (Gemini 3.1 Pro, Gemini 4 Argon, Flash…), **Claude Code** and **Codex** are at, lets you approve requests without switching windows, and goes *ding* when it's done.

https://github.com/user-attachments/assets/de1bf793-b005-4a0e-8159-b138536c0c4c

> Independent project, not affiliated with Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.

## Download (Windows 10 / 11)

👉 **[Latest version](https://github.com/ItzSized/Boofer/releases/latest)**, nothing to compile, pick one:

- **`Boofer_…_x64-setup.exe`**: installer (recommended), no admin rights needed
- **`Boofer_…_x64_en-US.msi`**: MSI installer, for the whole PC
- **`Boofer.exe`**: portable version, double-click and go

Nothing else to install: the installers add WebView2 if it's missing (already there on Windows 10/11), and you need neither Node nor Rust. For Claude Code: **Settings → Claude Code → Connect**. Antigravity and Codex are detected automatically.

What changed in each version: [CHANGELOG.md](CHANGELOG.md), the notes of each [release](https://github.com/ItzSized/Boofer/releases), or **Settings → What's new** in the app.

## What it does

### 👀 Follow your agents live

- **Live status**: the project, your request, the current action ("Editing pet.js", "Running: npm run build"), elapsed time, time left (estimated from your past tasks), number of actions, changed files, failures and active subagents.
- **Overall and per-step progress**: with a Claude task list, "Step 2/5 · Writing the tests — 70%" and a total ("Total 42%") that never goes back.
- **Several sessions**: each one has its color, its tab and its mini-ghost. Boofer shows the session of the project in the window in front.
- **Context and compaction**: a "🧠 Context 64%" gauge before Claude Code compacts, and the ghost squeezes like an accordion while it does.
- **Browser AIs**, nothing to install: ChatGPT, Gemini, AI Studio, Claude, Grok, Perplexity, DeepSeek, Le Chat and Copilot in Chrome, Edge or Brave.
- **Stuck agent alert**: nothing new for 8 minutes, or 3 failed actions in a row.
- **Live page** (Settings → 🟢 Live): open AI apps and every running agent, with its model, its context and what fills it, and what its chat and project weigh on disk (Claude Code).
- **Storage page** (Settings → Storage): what Claude Code keeps in `~/.claude/projects`, project by project (size, chats, last use, biggest chats) and a button to open the folder. It shows disk space only and never deletes anything.
- **Click the bubble or a tab** to bring that session's window to the front, browser included.

### ✋ Stay in control

- **Approvals**: when Claude Code asks for a permission, a card shows the command or file with **Allow / Always / Deny**. No answer within 55 s? Claude Code asks you as usual.
- **Stop dangerous commands**: before an `rm -rf`, a `git push --force`, a `git reset --hard` or a disk format, the ghost crosses its arms and asks "Are you sure?". No answer within 55 s and it's blocked, even in auto mode.
- **Do not disturb**: no sounds or cards for 30 min, 1 h, until tomorrow morning or with no end. It turns itself back on.

### 🔔 Alerts

- **Done ping**: the ghost jumps, the bubble says "Claudio is done! · Done in 45 s" with what the task cost in tokens.
- **Windows notifications** when a task finishes and you're not on your editor, and when a plan limit goes over 80%.
- **Sound off?** If Boofer's sounds are off or the PC is muted, a notification tells you anyway.
- **Three sound themes**: chimes, soft or retro 8-bit.
- **Day summary** around 6 pm (or right-click → My day).

### 📊 Usage and tokens

- **Model usage** (Settings → 📊 Models): which AIs you really use, their share, 14 days of activity, what it would cost at API prices, and your Codex plan limits. Everything is read locally.
- **Daily limit per AI**: a token cap for Claude, Gemini and GPT, alerts at 80% and 100%, and "⚡ ahead / 🐢 behind" your pace.
- **Save tokens** (Settings → ✂️ Tokens): make Claude Code compact earlier, ask for short answers.
- **Reprompt** (right-click or Ctrl+Alt+P): the copied prompt rewritten just for the AI, shorter, locally or with Claude Haiku.

### 👻 The ghost

- **A real companion**: its eyes follow the mouse, it waves on hover, loves being petted (click), falls asleep when you stop moving and does little spins.
- **Where it lives**: on your editor only, or anywhere on the desktop. **Follow me** makes it jump onto the window you're in.
- **Little phrases**: "Hi there!", "Ta-da! ✨", "Psst… it needs you".
- **It grows with you**: every finished task gives XP. Level 3 a glow, level 5 a golden halo, level 8 a golden aura. Tired when the context is full, relieved after a compaction.
- **Unobtrusive**: clicks go through the empty areas. Lost off screen? Tray → Bring the ghost back.

### 🎨 Customization

- **8 skins**: Classic, Strawberry, Mint, Sky, Pumpkin, Jelly, Gold, Night.
- **6 accessories**: bow, hat, crown, headphones, sprout, glasses, plus seasonal outfits (a witch hat for Halloween, a Santa hat in December).
- **Theme and size**: light, dark or auto, from 70% to 140%.
- **Animations to taste**: turn everything off for a still ghost, or only what bothers you.
- **Stream mode**: always shown on a green background, ready for OBS's chroma key.

### ⚙️ The app

- **Settings by category**: 🎨 Look, 👻 Ghost, 🔔 Alerts, 🤖 Agents, 📅 Today, ⚙️ General, 📊 Models, 🟢 Live, ✂️ Tokens, Storage. Maximize the window for a sidebar and two columns.
- **Open it**: double-click Boofer, click the tray icon, or right-click the ghost → Settings.
- **Start with Windows**, quietly.
- **Shortcuts**: Ctrl+Alt+B show / hide, Ctrl+Alt+M model usage, Ctrl+Alt+P reprompt.
- **Automatic updates**: installed over the old version, never while an agent is working, then Boofer shows **What's new**.
- **Today**: finished tasks, the agents' working time, changed files and the week as a chart.
- **🧪 Try it**: simulate a task, two sessions, a compaction, a request or a stop.

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
