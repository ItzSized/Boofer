import { compressWithStats, estimateTokens } from "../core/compress.js";

/** autoCompactWindow choices: null = Claude Code's default (the whole window). */
const WINDOWS = [
  [null, "Normal"],
  [400_000, "400 k"],
  [200_000, "200 k"],
  [100_000, "100 k"],
];

/**
 * « ✂️ Tokens » page of the settings window: compact earlier, concise answers,
 * and a prompt compressor (local and free, or rewritten by Claude Haiku).
 */
export function createTokensView({ call, isTauri }) {
  const $ = (id) => document.getElementById(id);
  let savers = { compactWindow: null, concise: false, claudeCli: false };

  $("compact-windows").innerHTML = WINDOWS.map(
    ([value, label]) =>
      `<button data-window="${value ?? ""}" class="segment rounded-lg px-2.5 py-1 text-xs ring-1 ring-black/10 dark:ring-white/15">${label}</button>`,
  ).join("");
  document.querySelectorAll("[data-window]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const tokens = btn.dataset.window ? Number(btn.dataset.window) : null;
      try {
        await call("set_compact_window", { tokens });
        savers.compactWindow = tokens;
        $("compact-note").textContent = "✓ Enregistré. Pris en compte au prochain lancement de Claude Code.";
      } catch (error) {
        $("compact-note").textContent = `Impossible : ${error}`;
      }
      render();
    }),
  );

  $("concise").addEventListener("change", async (e) => {
    try {
      await call("set_concise", { enabled: e.target.checked });
      savers.concise = e.target.checked;
    } catch (error) {
      e.target.checked = savers.concise;
      $("concise-note").textContent = `Impossible : ${error}`;
    }
  });

  // ---------- Prompt compressor ----------
  const input = $("prompt-in");
  const output = $("prompt-out");
  const stats = $("prompt-stats");

  function showResult(text, before) {
    output.value = text;
    const after = estimateTokens(text);
    const saved = before ? Math.max(0, Math.round((1 - after / before) * 100)) : 0;
    stats.textContent = text ? `≈ ${before} → ${after} tokens (−${saved} %)` : "";
    $("prompt-copy").disabled = !text;
  }

  // Local compression follows the typing.
  input.addEventListener("input", () => {
    const r = compressWithStats(input.value);
    showResult(r.text, r.before);
  });

  $("prompt-ai").addEventListener("click", async () => {
    if (!input.value.trim()) return;
    const btn = $("prompt-ai");
    btn.disabled = true;
    btn.textContent = "Haiku réfléchit…";
    try {
      const text = isTauri ? await call("compress_with_claude", { text: input.value }) : `${input.value.slice(0, 40)}… (Haiku)`;
      showResult(text, estimateTokens(input.value));
    } catch (error) {
      stats.textContent = `Haiku indisponible : ${error}`;
    } finally {
      btn.disabled = false;
      btn.textContent = "✨ Reformuler avec Haiku";
    }
  });

  $("prompt-copy").addEventListener("click", async () => {
    if (isTauri) await call("write_clipboard", { text: output.value });
    else await navigator.clipboard?.writeText(output.value);
    $("prompt-copy").textContent = "✓ Copié";
    setTimeout(() => ($("prompt-copy").textContent = "📋 Copier"), 1500);
  });

  function render() {
    document
      .querySelectorAll("[data-window]")
      .forEach((btn) => btn.classList.toggle("selected", (btn.dataset.window || null) == (savers.compactWindow ?? null)));
    $("concise").checked = savers.concise;
    $("prompt-ai").classList.toggle("hidden", !savers.claudeCli);
  }

  return {
    async refresh() {
      try {
        savers = (await call("get_token_savers")) ?? savers;
      } catch {
        // keep defaults
      }
      render();
    },
  };
}
