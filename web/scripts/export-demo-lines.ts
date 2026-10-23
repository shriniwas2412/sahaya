// Writes every scripted Sahaya line from the demo (after speech normalisation) to
// tools/demo_lines.json, for tools/prerender_demo_voice.py. Run: npm run voice:lines
import { writeFileSync } from "node:fs";
import { generateDemo } from "../src/data/demoGen.ts";
import { normalizeForSpeech } from "../src/core/speech/prosody.ts";

const g = generateDemo(Date.parse("2026-10-20T06:00:00Z"));
const lines: { id: string; lang: string; text: string }[] = [];
for (const [session, conv] of Object.entries(g.conversations)) {
  const elder = g.elder.find((e) => session.startsWith(e.id))!;
  conv.filter((l) => l.who === "sahaya").forEach((l, i) => {
    lines.push({ id: `${elder.id}-${i + 1}`, lang: elder.language ?? "hi-IN", text: normalizeForSpeech(l.text, elder.language ?? "hi-IN") });
  });
}
writeFileSync(new URL("../../tools/demo_lines.json", import.meta.url), JSON.stringify(lines, null, 2) + "\n");
console.log(`${lines.length} lines -> tools/demo_lines.json`);
