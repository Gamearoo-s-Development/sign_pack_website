const assert = require("assert");
const {
  FRIENDLY_OFF_TOPIC_MESSAGE,
  classifySignpackRelevance,
  enforceFocusedResponse,
} = require("./ramAiGuardrails");

function testClassify() {
  const blocked1 = classifySignpackRelevance({
    action: "ask",
    context: { question: "code me a discord bot" },
    userText: "code me a discord bot",
  });
  assert.strictEqual(blocked1.allowed, false, "discord bot prompt must be blocked");

  const blocked2 = classifySignpackRelevance({
    action: "ask",
    context: { question: "install discord.py" },
    userText: "install discord.py",
  });
  assert.strictEqual(blocked2.allowed, false, "discord.py prompt must be blocked");

  const blocked3 = classifySignpackRelevance({
    action: "ask",
    context: { question: "make a website" },
    userText: "make a website",
  });
  assert.strictEqual(blocked3.allowed, false, "generic website prompt must be blocked");

  const allowed1 = classifySignpackRelevance({
    action: "ask",
    context: { question: "write signs.json for a stop sign" },
    userText: "write signs.json for a stop sign",
  });
  assert.strictEqual(allowed1.allowed, true, "signs.json prompt must be allowed");

  const allowed2 = classifySignpackRelevance({
    action: "help_textlines",
    context: { signName: "Stop Sign" },
    userText: "help me with textlines",
  });
  assert.strictEqual(allowed2.allowed, true, "textlines prompt must be allowed");
}

function testOutputFilter() {
  const offTopic = "Use pip install discord.py and create a bot token from Discord Developer Portal.";
  assert.strictEqual(
    enforceFocusedResponse(offTopic),
    FRIENDLY_OFF_TOPIC_MESSAGE,
    "off-topic output should be replaced"
  );

  const onTopic = "Use signs.json with name, pack_id, and signs entries.";
  assert.strictEqual(
    enforceFocusedResponse(onTopic),
    onTopic,
    "on-topic output should pass through"
  );
}

function run() {
  testClassify();
  testOutputFilter();
  console.log("ramAiGuardrails tests passed");
}

run();
