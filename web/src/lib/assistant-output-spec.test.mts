import assert from "node:assert/strict";
import test from "node:test";

import {
  getDialogueTextFromBlocks,
  normalizeCommandOutput,
  parseAssistantOutputSpecFromStreamMeta,
  type AssistantOutputBlock,
  type SlashCommand,
} from "./assistant-output-spec.ts";

function assertSlashContract(command: SlashCommand, raw: string, nonDialogueRole: "scene_setup" | "guidance") {
  const spec = normalizeCommandOutput(command, raw);
  const dialogueBlocks = spec.blocks.filter((block) => block.role === "dialogue");
  assert.equal(dialogueBlocks.length, 1, `${command} should have exactly one dialogue block`);
  assert.equal(dialogueBlocks[0].style, "main", `${command} dialogue must use main style`);
  assert.equal(dialogueBlocks[0].speak, true, `${command} dialogue must be speakable`);

  for (const block of spec.blocks.filter((entry) => entry.role !== "dialogue")) {
    assert.equal(block.style, "mono", `${command} non-dialogue block must use mono style`);
    assert.equal(block.speak, false, `${command} non-dialogue block must not be speakable`);
    assert.equal(block.role, nonDialogueRole, `${command} non-dialogue block role mismatch`);
  }

  return spec;
}

test("normalizeCommandOutput keeps /vibe as scene_setup + dialogue", () => {
  const raw = `Scene Setup: You are sharing a post-work coffee moment with a friend in a quiet street cafe.

Dialogue: What was the most surprising part of your day?`;
  const spec = assertSlashContract("/vibe", raw, "scene_setup");
  assert.equal(spec.blocks.some((block) => block.role === "guidance"), false);
});

test("normalizeCommandOutput keeps /help /optimize /daily as guidance + dialogue", () => {
  const cases: Array<{ command: SlashCommand; raw: string }> = [
    {
      command: "/help",
      raw: `Translation Logic: Keep the sentence natural and concise for daily conversation.

Continue Topic: In one sentence, what do you want to say next?`,
    },
    {
      command: "/optimize",
      raw: `Translation Logic: Swap literal wording for idiomatic phrasing and reduce filler words.

Continue Topic: Which part sounds least natural to you now?`,
    },
    {
      command: "/daily",
      raw: `Today focus: describe one tiny win from your day with specific detail.

Prompt: What tiny win are you proud of today?`,
    },
  ];

  for (const item of cases) {
    const spec = assertSlashContract(item.command, item.raw, "guidance");
    assert.equal(spec.blocks.some((block) => block.role === "scene_setup"), false);
  }
});

test("normalizeCommandOutput avoids optimize/vibe cross-role pollution", () => {
  const optimizeRaw = `Scene Setup: This line should not become dialogue for optimize.

Dialogue: Which sentence do you want me to optimize first?`;
  const optimizeSpec = normalizeCommandOutput("/optimize", optimizeRaw);
  assert.equal(optimizeSpec.blocks[0]?.role, "guidance");
  assert.equal(optimizeSpec.blocks.some((block) => block.role === "scene_setup"), false);

  const vibeRaw = `Translation Logic: This should still stay in scene setup for vibe mode.

Continue Topic: How do you feel in this moment?`;
  const vibeSpec = normalizeCommandOutput("/vibe", vibeRaw);
  assert.equal(vibeSpec.blocks[0]?.role, "scene_setup");
  assert.equal(vibeSpec.blocks.some((block) => block.role === "guidance"), false);
});

test("parseAssistantOutputSpecFromStreamMeta rewrites malformed blocks deterministically", () => {
  const malformedBlocks = [
    {
      role: "guidance",
      text: "Keep the answer in one sentence.",
      style: "main",
      speak: true,
    },
  ] satisfies AssistantOutputBlock[];

  const parsed = parseAssistantOutputSpecFromStreamMeta({
    spec: {
      command: "/help",
      raw: "Keep the answer in one sentence.\n\nWhat would you like to say back?",
      blocks: malformedBlocks,
    },
  });

  assert.ok(parsed);
  const dialogue = parsed.blocks.filter((block) => block.role === "dialogue");
  assert.equal(dialogue.length, 1);
  assert.equal(dialogue[0].style, "main");
  assert.equal(dialogue[0].speak, true);
  for (const block of parsed.blocks.filter((entry) => entry.role !== "dialogue")) {
    assert.equal(block.role, "guidance");
    assert.equal(block.style, "mono");
    assert.equal(block.speak, false);
  }
});

test("getDialogueTextFromBlocks reads dialogue only", () => {
  const dialogue = getDialogueTextFromBlocks([
    { role: "guidance", text: "Guidance", style: "mono", speak: false },
    { role: "dialogue", text: "Can you tell me more?", style: "main", speak: true },
  ]);
  assert.equal(dialogue, "Can you tell me more?");
});
