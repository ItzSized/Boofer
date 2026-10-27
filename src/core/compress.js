/**
 * Local prompt compressor: rewrites a prompt in a terse "for the AI" style.
 * Free and instant, no model involved. Models read telegraphic text just fine:
 * politeness, filler words, articles and "can you…" wrappers cost tokens for nothing.
 * Code (between backticks), paths and numbers are left untouched.
 */

/** Removed wherever they appear (French and English). */
const FILLERS = [
  /\bs'il (?:te|vous) pla[iî]t\b/gi,
  /\b(?:stp|svp|please|pls|plz)\b/gi,
  /\bmerci(?: beaucoup| d'avance)?\b/gi,
  /\b(?:thanks|thank you)(?: in advance)?\b/gi,
  /\b(?:en gros|du coup|en fait|genre|bref|franchement|vraiment|tout simplement|simplement|voilà|voila|quoi)\b/gi,
  /\b(?:un peu|juste|assez|plutôt|carrément)\b/gi,
  /\b(?:basically|actually|really|just|kind of|sort of|simply)\b/gi,
  /\b(?:hello|hi|hey|salut|coucou|bonjour)\b[ ,!]*/gi,
];

/** "Can you…", "J'aimerais que tu…": the AI knows it is being asked. */
const WRAPPERS = [
  /\b(?:est-ce que |est ce que )?(?:tu |vous )?(?:peux|pourrais|pouvez|pourriez)(?:-tu|-vous| tu| vous)? /gi,
  /\b(?:j'aimerais|je voudrais|je veux|j'ai besoin)(?: bien)? (?:que (?:tu|vous) |qu'on |de )/gi,
  /\b(?:il faut que (?:tu|vous) |n'oublie pas de |essaie de |essaye de )/gi,
  /\b(?:fais|fait|faire|faites) en sorte (?:que |qu['’ ]\s?)/gi,
  /\b(?:can|could|would) you(?: please)? /gi,
  /\bI(?:'d| would) like you to /gi,
  /\bI want you to /gi,
  /\bmake sure (?:to |that )/gi,
];

// Articles depend on the language: in French "a" is a verb ("l'a", "il a").
const ARTICLES = {
  fr: /\b(?:le|la|les|un|une|des)\s+/gi,
  en: /\b(?:the|a|an)\s+/gi,
};
const FRENCH_HINTS = /\b(?:le|la|les|des|est|et|que|qui|pour|avec|dans|sur|une|je|tu|il|on|pas|fait|faire)\b/gi;
const ENGLISH_HINTS = /\b(?:the|and|is|are|to|of|for|with|in|on|you|it|that|this|make|please)\b/gi;
const ELIDED = /\bl['’](?=\p{L})/giu;
const CONNECTORS = [
  [/\s*\b(?:et ensuite|ensuite|et puis|puis|après ça|and then|then)\b\s*/gi, "; "],
  [/\s*\b(?:parce que|car|because)\b\s*/gi, ": "],
];
const EMOJI = /[\p{Extended_Pictographic}️‍]/gu;

/** Rough token count: ~4 characters per token (a bit less in French). */
export function estimateTokens(text) {
  const t = String(text ?? "").trim();
  return t ? Math.max(1, Math.round(t.length / 3.8)) : 0;
}

export function compressPrompt(text) {
  // Keep code spans and blocks exactly as they are.
  const kept = [];
  let s = String(text ?? "").replace(/```[\s\S]*?```|`[^`\n]+`/g, (code) => `\u0000${kept.push(code) - 1}\u0000`);

  s = s.replace(EMOJI, "");
  for (const re of [...WRAPPERS, ...FILLERS]) s = s.replace(re, "");
  for (const [re, by] of CONNECTORS) s = s.replace(re, by);
  const french = (s.match(FRENCH_HINTS)?.length ?? 0) >= (s.match(ENGLISH_HINTS)?.length ?? 0);
  s = s.replace(french ? ARTICLES.fr : ARTICLES.en, "");
  if (french) s = s.replace(ELIDED, "");
  // "tu lances" → "lances" at the start of a clause; "etc etc" → "etc".
  s = s.replace(/(^|[;:,.!?\n]\s*)(?:tu|vous|you) (?=\p{L})/gimu, "$1").replace(/\b(\p{L}+)(?: \1\b)+/giu, "$1");

  s = s
    .replace(/!+/g, "") // the AI doesn't need the enthusiasm
    .replace(/([?.])\1+/g, "$1")
    .replace(/[ \t]*([,;:.!?])[ \t]*(?=[,;:.!?])/g, "") // ", ;" → ";"
    .replace(/^[\s,;:.!?-]+/gm, "") // punctuation left at a line start…
    .replace(/[ \t]*[,;:]+[ \t]*$/gm, "") // …or dangling at its end
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,;:.!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
}

/** { text, before, after, saved (0–1) } */
export function compressWithStats(text) {
  const out = compressPrompt(text);
  const before = estimateTokens(text);
  const after = estimateTokens(out);
  return { text: out, before, after, saved: before ? Math.max(0, 1 - after / before) : 0 };
}
