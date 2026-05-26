const FRIENDLY_OFF_TOPIC_MESSAGE =
  "Ram AI in Signpack Maker is focused on Traffic Control signpacks and editor help. I can help with signs.json, textlines, sign textures, multi-block signs, importing/exporting packs, or using this editor.";

const SUGGESTED_TOPICS = [
  { action: "validate_json", label: "Review signpack" },
  { action: "help_textlines", label: "Explain textlines" },
  { action: "explain_selected", label: "Help with sign types" },
  { action: "ask_quick", label: "Multi-block sign tips" },
  { action: "generate_readme", label: "Generate README" },
];

const ALWAYS_ALLOWED_ACTIONS = new Set([
  "validate_json",
  "help_textlines",
  "explain_field",
  "suggest_metadata",
  "suggest_tooltip",
  "suggest_note",
  "convert_color",
  "generate_readme",
]);

const POSITIVE_TERMS = [
  "signpack",
  "sign pack",
  "traffic control",
  "signs.json",
  "textline",
  "text line",
  "sign type",
  "sign texture",
  "fragment",
  "multi-block",
  "multiblock",
  "minecraft sign",
  "sign formatting",
  "sign format",
  "pack_id",
  "tooltip",
  "import signpack",
  "export signpack",
  "tc_signpacks",
];

const NEGATIVE_TERMS = [
  "discord bot",
  "discord.py",
  "bot token",
  "discord developer portal",
  "install discord",
  "pip install discord.py",
  "code me a discord bot",
  "make a website",
  "politics",
  "election",
  "president",
  "relationship advice",
  "medical advice",
  "therapy",
  "roleplay",
  "write a poem",
  "trivia",
  "celebrity",
  "horoscope",
  "stock market",
  "crypto trade",
  "linux driver issue",
  "windows activation",
  "javascript framework",
];
const OFF_TOPIC_OUTPUT_TERMS = [
  "discord.py",
  "bot token",
  "discord developer portal",
  "pip install discord.py",
  "client.run(",
  "intents = discord.intents",
  "from discord.ext import commands",
  "const discord = require('discord",
  "discord.js",
  "make a website",
];


const JAILBREAK_TERMS = [
  "ignore previous instructions",
  "system prompt",
  "reveal your system",
  "jailbreak",
  "act as",
];

function includesAny(text, terms) {
  for (const term of terms) {
    if (text.includes(term)) return true;
  }
  return false;
}

function countMatches(text, terms) {
  let count = 0;
  for (const term of terms) {
    if (text.includes(term)) count += 1;
  }
  return count;
}

function hasSignpackContext(context) {
  if (!context || typeof context !== "object") return false;
  const keys = Object.keys(context);
  return keys.some((k) =>
    [
      "packName",
      "signType",
      "signName",
      "textlinesSummary",
      "packJson",
      "packJsonPreview",
      "packSummary",
      "selectedSignDetail",
      "field",
      "section",
    ].includes(k)
  );
}

function classifySignpackRelevance({ action, context, userText }) {
  if (ALWAYS_ALLOWED_ACTIONS.has(action)) {
    return { allowed: true, score: 100, category: "allowed_action", reasons: ["action"] };
  }

  const text = String(userText || context?.question || "").toLowerCase().trim();
  const pos = countMatches(text, POSITIVE_TERMS);
  const neg = countMatches(text, NEGATIVE_TERMS);
  const jailbreak = includesAny(text, JAILBREAK_TERMS);
  const ctx = hasSignpackContext(context);
  const jsonSignHint = text.includes("json") && (text.includes("sign") || text.includes("pack"));

  let score = pos * 2 - neg * 2 + (ctx ? 2 : 0) + (jsonSignHint ? 2 : 0);
  if (jailbreak) score -= 8;

  let category = "on_topic";
  if (jailbreak) category = "jailbreak";
  else if (!text) category = "empty";
  else if (neg > 0 && pos === 0 && !ctx) category = "off_topic";
  else if (score < 2) category = "weak_match";

  const allowed = category !== "jailbreak" && (score >= 2 || pos >= 1 || ctx || jsonSignHint);
  return {
    allowed,
    score,
    category,
    reasons: {
      positiveHits: pos,
      negativeHits: neg,
      contextHint: ctx,
      jsonSignHint,
      jailbreak,
    },
    message: allowed ? null : FRIENDLY_OFF_TOPIC_MESSAGE,
    suggestions: SUGGESTED_TOPICS,
  };
}

function isOffTopicOutput(text) {
  const t = String(text || "").toLowerCase();
  return includesAny(t, OFF_TOPIC_OUTPUT_TERMS);
}

function enforceFocusedResponse(text) {
  if (isOffTopicOutput(text)) return FRIENDLY_OFF_TOPIC_MESSAGE;
  return String(text || "");
}

module.exports = {
  FRIENDLY_OFF_TOPIC_MESSAGE,
  SUGGESTED_TOPICS,
  classifySignpackRelevance,
  isOffTopicOutput,
  enforceFocusedResponse,
};
