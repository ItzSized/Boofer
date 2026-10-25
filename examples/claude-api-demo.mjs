// npm run demo:api   (needs ANTHROPIC_API_KEY or an `ant auth login` profile, and Booffer running)
import Anthropic from "@anthropic-ai/sdk";
import { trackStream } from "../reporters/anthropic.js";

const client = new Anthropic();

const stream = client.beta.messages.stream({
  model: "claude-opus-5-5",
  max_tokens: 64000,
  // On a safety-classifier decline, the API retries on Anthropic's recommended fallback model.
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
  messages: [{ role: "user", content: "Écris un petit poème sur un fantôme qui aide les développeurs." }],
});

trackStream(stream, { label: "Poème", expectedTokens: 300 });
stream.on("text", (delta) => process.stdout.write(delta));

const message = await stream.finalMessage();
if (message.stop_reason === "refusal") console.error("\n[refusé]");
console.log(`\n\n${message.usage.output_tokens} tokens`);
