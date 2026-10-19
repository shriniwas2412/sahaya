import { test } from "node:test";
import assert from "node:assert/strict";
import { guardOutput, toSpeakable, capLength, isMedicalAdvice } from "./outputGuard.ts";

test("markdown, lists, links, emoji and stage directions are removed", () => {
  assert.equal(toSpeakable("**Namaste!** How are *you*?"), "Namaste! How are?");
  assert.equal(toSpeakable("*smiles warmly* Hello there."), "Hello there.");
  assert.equal(toSpeakable("(softly) Hello."), "Hello.");
  assert.equal(toSpeakable("## Title\nSome text."), "Title Some text.");
  assert.equal(toSpeakable("We can:\n- sing a song\n- talk about food\n1. rest"), "We can: sing a song. talk about food. rest.");
  assert.equal(toSpeakable("See [this](https://x.y) and https://a.b/c now."), "See this and now.");
  assert.equal(toSpeakable("How lovely 😊🌸!"), "How lovely!");
  assert.equal(toSpeakable("कितना अच्छा! 🙏"), "कितना अच्छा!");
});

test("medicine, dose and diagnosis talk is detected in English, Hindi and Hinglish", () => {
  for (const s of [
    "Take two tablets after food.", "You can take 500 mg of paracetamol.", "Maybe skip your medicine today.",
    "Your dose is fine.", "दवा खा लीजिए।", "दो गोली ले लीजिए।", "dawai le lo", "goli kha lo",
    "You may have dementia.", "That sounds like a diagnosis of diabetes.", "आपको शुगर है।", "insulin is important",
  ]) assert.equal(isMedicalAdvice(s), true, s);
  for (const s of [
    "Tell me about Diwali.", "Your daughter is a doctor? How wonderful.", "Shall we sing a bhajan?",
    "होली पर क्या बनाते थे?", "I had 2 cups of chai.", "The doser...", "Let's talk.",
  ]) assert.equal(isMedicalAdvice(s), false, s);
});

test("medical replies are replaced by the fixed safe line, in the right language", () => {
  const hi = guardOutput("आप दो गोली ले लीजिए।", { stage: 3, lang: "hi" });
  assert.deepEqual(hi, { text: "दवा की बात आपके घरवाले या डॉक्टर ही बताएँगे। चलिए, कुछ और बात करते हैं।", reasons: ["medical"] });
  const en7 = guardOutput("Take your pills now.", { stage: 7, lang: "en" });
  assert.equal(en7.text, "Your family or doctor will help with medicines.");
});

test("avoid phrases in the output mean the caller must redirect", () => {
  assert.deepEqual(guardOutput("Do you remember the hospital?", { stage: 3, lang: "en", avoid: ["hospital"] }), { text: null, reasons: ["trigger"] });
  assert.equal(guardOutput("Tell me about mangoes.", { stage: 3, lang: "en", avoid: ["hospital"] }).text, "Tell me about mangoes.");
});

test("length cap: sentences by stage, one question at most", () => {
  const long = "One. Two. Three. Four.";
  assert.equal(capLength(long, 2, "en"), "One. Two. Three.");
  assert.equal(capLength(long, 4, "en"), "One. Two.");
  assert.equal(capLength(long, 7, "en"), "One.");
  assert.equal(capLength("Hello. Do you like tea? And coffee?", 2, "en"), "Hello. Do you like tea?");
  assert.equal(capLength("नमस्ते। आप कैसे हैं? चाय पिएँगे?", 3, "hi"), "नमस्ते। आप कैसे हैं?");
});

test("length cap: characters by stage, cut on a word boundary with an end mark", () => {
  const words = Array.from({ length: 40 }, () => "बहुत").join(" ");
  const out = capLength(words, 7, "hi");
  assert.ok(out.length <= 91, String(out.length));
  assert.ok(out.endsWith("।"));
  assert.ok(!out.includes("बहु।"), "no half words");
});

test("persona breaks are dropped", () => {
  assert.deepEqual(guardOutput("As an AI, I cannot sing. But I love bhajans.", { stage: 3, lang: "en" }), { text: "But I love bhajans.", reasons: ["persona"] });
});

test("empty or symbol-only output asks for a scripted line", () => {
  assert.equal(guardOutput("", { stage: 3, lang: "en" }).text, null);
  assert.equal(guardOutput("😊 **", { stage: 3, lang: "en" }).text, null);
});

test("clean short text passes untouched", () => {
  assert.deepEqual(guardOutput("आज मौसम बहुत सुहाना है।", { stage: 4, lang: "hi" }), { text: "आज मौसम बहुत सुहाना है।", reasons: [] });
});
