/**
 * Report the progress of YOUR OWN Anthropic SDK streams to Booffer.
 * The API key stays in your script; Booffer never sees it.
 *
 *   const stream = client.messages.stream({ ... });
 *   trackStream(stream, { label: "Résumé du PDF" });
 *   const message = await stream.finalMessage();
 */
const BOOFFER_URL = process.env.BOOFFER_URL ?? "http://127.0.0.1:47823/event/claude-api";
const MIN_INTERVAL_MS = 150;

export function trackStream(stream, { label, expectedTokens = 800, url = BOOFFER_URL } = {}) {
  const id = crypto.randomUUID();
  const send = (body) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, label, ...body }),
    }).catch(() => {}); // Booffer not running: never break the caller

  let chars = 0;
  let lastSent = 0;
  send({ state: "thinking" });

  stream.on("text", (delta) => {
    chars += delta.length;
    const now = Date.now();
    if (now - lastSent < MIN_INTERVAL_MS) return;
    lastSent = now;
    // The API has no "percent done"; this is an estimate that eases toward 95%.
    const tokens = Math.round(chars / 4);
    send({ state: "streaming", tokens, progress: Math.min(0.95, 1 - Math.exp(-tokens / expectedTokens)) });
  });

  stream.finalMessage().then(
    (message) =>
      send(
        message.stop_reason === "refusal"
          ? { state: "error", label: "Requête refusée" }
          : { state: "done", tokens: message.usage.output_tokens },
      ),
    () => send({ state: "error" }),
  );

  return stream;
}
