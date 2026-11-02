// The AI chats Booffer follows in the browser. Shared by background.js and content.js.
// `stop`: what appears only while the AI is answering (its « Stop » button), tried in order;
// `answer`: the AI's messages (the last one is the answer being written);
// `model`: where the page shows the chosen model, when it does.
// Sites change their pages often: when nothing here matches, content.js falls back to any
// visible button whose label says « Stop » / « Arrêter ».
var BOOFFER_SITES = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    hosts: ["chatgpt.com", "chat.openai.com"],
    stop: ['button[data-testid="stop-button"]'],
    answer: '[data-message-author-role="assistant"]',
    model: '[data-testid="model-switcher-dropdown-button"]',
  },
  {
    id: "gemini",
    name: "Gemini",
    hosts: ["gemini.google.com"],
    stop: ["button.send-button.stop", 'mat-icon[fonticon="stop"]'],
    answer: "message-content",
    model: '[data-test-id="bard-mode-menu-button"]',
  },
  {
    id: "aistudio",
    name: "AI Studio",
    hosts: ["aistudio.google.com"],
    stop: ["run-button button.stoppable"],
    answer: "ms-chat-turn .model-prompt-container",
    model: "ms-model-selector .title",
  },
  {
    id: "claude",
    name: "Claude",
    hosts: ["claude.ai"],
    stop: ['button[aria-label="Stop response"]', '[data-is-streaming="true"]'],
    answer: ".font-claude-response, .font-claude-message",
    model: '[data-testid="model-selector-dropdown"]',
  },
  { id: "grok", name: "Grok", hosts: ["grok.com"], stop: [], answer: ".message-bubble", model: "" },
  { id: "perplexity", name: "Perplexity", hosts: ["perplexity.ai", "www.perplexity.ai"], stop: [], answer: ".prose", model: "" },
  { id: "deepseek", name: "DeepSeek", hosts: ["chat.deepseek.com"], stop: [], answer: ".ds-markdown", model: "" },
  { id: "mistral", name: "Le Chat", hosts: ["chat.mistral.ai"], stop: [], answer: '[data-message-author-role="assistant"]', model: "" },
  { id: "copilot", name: "Copilot", hosts: ["copilot.microsoft.com"], stop: [], answer: '[data-content="ai-message"]', model: "" },
];

function boofferSiteFor(hostname) {
  return BOOFFER_SITES.find((s) => s.hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))) ?? null;
}
