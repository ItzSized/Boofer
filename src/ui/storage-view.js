import { fileSize } from "../core/format.js";

/** Chats listed under each project: the heaviest ones. */
const TOP_CHATS = 10;
const DAY_MS = 86_400_000;

const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** "today", "yesterday", "5 days ago", then the date. */
function ago(ms, now = Date.now()) {
  if (!ms) return "never";
  const days = Math.floor((now - ms) / DAY_MS);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/** The date of a chat, short: "Nov 3", with the year when it isn't this one. */
function shortDate(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "2-digit" });
}

/**
 * "Storage" page of the settings window: what Claude Code keeps on the disk in
 * ~/.claude/projects, project by project and chat by chat. It only shows: nothing is deleted.
 * The list is read when the page opens and on "Refresh", not in a loop (a walk of the folder
 * takes a fraction of a second, but it can be thousands of files).
 */
export function createStorageView({ call, isTauri, emit, listen }) {
  const $ = (id) => document.getElementById(id);
  let projects = null;
  let loading = false;
  let failed = "";
  // Projects with a session running now (lowercase names, as the ghost reports them).
  let live = new Set();
  // Projects whose chats are unfolded: kept across a refresh.
  const open = new Set();

  const setLive = (sessions) => {
    const next = new Set((sessions ?? []).map((s) => String(s.project ?? "").toLowerCase()).filter(Boolean));
    if ([...next].sort().join("|") === [...live].sort().join("|")) return;
    live = next;
    if (projects) render();
  };
  // The ghost window answers "live-request" with "live-sessions" (see live-view.js).
  if (isTauri) listen("live-sessions", ({ payload }) => setLive(payload));

  $("storage-projects").addEventListener("toggle", (event) => {
    const key = event.target.dataset?.key;
    if (!key) return;
    event.target.open ? open.add(key) : open.delete(key);
  }, true);
  $("storage-projects").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-open]");
    if (!button) return;
    try {
      await call("open_claude_folder", { path: button.dataset.open });
    } catch {
      button.textContent = "Couldn't open";
    }
  });
  $("storage-refresh").addEventListener("click", () => refresh());

  function chatRow(chat) {
    const title = chat.title
      ? `<span class="min-w-0 flex-1 truncate" title="${esc(chat.title)}">${esc(chat.title)}</span>`
      : `<span class="min-w-0 flex-1 truncate italic text-zinc-400">Untitled chat</span>`;
    return `<li class="flex items-baseline gap-2">
      <span class="w-14 shrink-0 text-right font-medium tabular-nums">${esc(fileSize(chat.bytes))}</span>
      <span class="w-14 shrink-0 tabular-nums text-zinc-400">${esc(shortDate(chat.modifiedMs))}</span>
      ${title}</li>`;
  }

  function projectRow(p, total) {
    const share = total ? (p.bytes / total) * 100 : 0;
    const isLive = live.has(String(p.name).toLowerCase());
    const top = p.chats.slice(0, TOP_CHATS);
    const more = p.chatCount - top.length;
    const chats = top.length
      ? `<details data-key="${esc(p.path)}" ${open.has(p.path) ? "open" : ""} class="mt-1.5 rounded-lg bg-zinc-50 px-2 py-1.5 dark:bg-zinc-800/60">
        <summary class="cursor-pointer select-none text-[11px] font-medium text-zinc-600 dark:text-zinc-300">Biggest chats</summary>
        <ul class="mt-1.5 space-y-1 text-[11px]">${top.map(chatRow).join("")}</ul>
        ${more > 0 ? `<p class="mt-1 text-[10px] text-zinc-400">and ${more} smaller chat${more > 1 ? "s" : ""}</p>` : ""}
      </details>`
      : "";
    return `<li class="py-3">
      <div class="flex items-center gap-2">
        <span class="truncate text-sm font-semibold" title="${esc(p.path)}">${esc(p.name)}</span>
        ${isLive ? `<span class="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300" title="A session is running in this project">open</span>` : ""}
        <span class="ml-auto shrink-0 text-sm font-semibold tabular-nums">${esc(fileSize(p.bytes))}</span>
      </div>
      <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" title="${Math.round(share)}% of the total">
        <div class="h-full rounded-full bg-violet-400" style="width:${Math.max(share, 1.5).toFixed(1)}%"></div>
      </div>
      <div class="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span class="tabular-nums">${p.chatCount} chat${p.chatCount === 1 ? "" : "s"} · last used ${esc(ago(p.lastUsedMs))}</span>
        <button data-open="${esc(p.path)}" class="chip ml-auto shrink-0 !px-2.5 !py-0.5 !text-[11px]">Open folder</button>
      </div>
      ${chats}
    </li>`;
  }

  function render() {
    // A folder with no chat left only holds a memory: a few KB and an unreadable name.
    const list = (projects ?? []).filter((p) => p.chatCount > 0);
    const total = list.reduce((sum, p) => sum + p.bytes, 0);
    $("storage-total").textContent = projects ? fileSize(total) : "";
    $("storage-summary").textContent = projects ? `in ${list.length} project${list.length === 1 ? "" : "s"}` : "";
    $("storage-refresh").disabled = loading;
    if (failed) {
      $("storage-projects").innerHTML = `<li class="py-5 text-center text-xs text-rose-500">Couldn't read ~/.claude/projects: ${esc(failed)}</li>`;
    } else if (projects === null) {
      $("storage-projects").innerHTML = `<li class="py-4 text-center text-xs text-zinc-400"><span class="spinner"></span></li>`;
    } else if (list.length === 0) {
      $("storage-projects").innerHTML = `<li class="py-5 text-center text-xs text-zinc-400">Nothing here yet: Claude Code keeps its chats in ~/.claude/projects.</li>`;
    } else {
      $("storage-projects").innerHTML = list.map((p) => projectRow(p, total)).join("");
    }
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    failed = "";
    render();
    try {
      projects = (await call("claude_storage")) ?? [];
    } catch (error) {
      failed = String(error);
    }
    loading = false;
    render();
  }

  return {
    /** The page was opened. */
    show() {
      refresh();
      if (isTauri) emit("live-request");
      else setLive([{ project: "Boofer" }]);
    },
  };
}
