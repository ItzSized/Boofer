const LINES = {
  hello: ["Coucou !", "Me revoilà 👻", "Prêt à coder ?", "Boo ! 👋"],
  done: ["Tadaa ! ✨", "Et voilà !", "Mission accomplie !", "C'est dans la boîte !", "Fini ! Bravo à vous deux"],
  attention: ["Psst… il a besoin de toi", "Hé ho ! Une question ?", "Ta validation, stp 🙏"],
  error: ["Oups…", "Aïe, ça a raté", "On réessaie ?"],
  pat: ["Hihi !", "Encore !", "♥", "Ça chatouille !", "Boo ♥"],
  sleep: ["Zzz…", "Petite sieste…", "*bâille*"],
  wake: ["Hein ? Je dormais pas !", "Mmh… déjà ?", "Ah, te revoilà !"],
  relieved: ["Ahh, ça va mieux 😮‍💨", "Tête toute légère !", "Plus de place !"],
  tired: ["J'ai la tête pleine…", "Ouf, beaucoup d'infos…"],
  follow: ["Je te suis ! 🐾", "On y va ?", "Attends-moi !"],
};
const SHOW_MS = 2600;
const MIN_GAP_MS = 1200;

/** Little speech bubble above the ghost's head. */
export function createSpeech(el, { enabled }) {
  el.className =
    "speech pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full " +
    "bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-md ring-1 ring-black/10 " +
    "dark:bg-zinc-900 dark:text-zinc-200 dark:ring-white/15";
  let hideTimer;
  let lastAt = 0;
  let lastLine = "";

  function show(text, ms, long = false) {
    el.classList.toggle("long", long);
    lastLine = text;
    lastAt = Date.now();
    el.textContent = text;
    el.classList.remove("show");
    void el.offsetWidth; // restart the pop animation
    el.classList.add("show");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => el.classList.remove("show"), ms);
  }

  return {
    say(kind) {
      const lines = LINES[kind];
      if (!lines || !enabled() || Date.now() - lastAt < MIN_GAP_MS) return;
      const choices = lines.length > 1 ? lines.filter((line) => line !== lastLine) : lines;
      show(choices[Math.floor(Math.random() * choices.length)], SHOW_MS);
    },
    /** Something specific to tell (limits, day summary, level up): stays longer. */
    tell(text, ms = 6000) {
      if (enabled()) show(text, ms, text.length > 26);
    },
  };
}
