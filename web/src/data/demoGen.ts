// Deterministic synthetic demo data. Same seed + same day -> the same rows, so
// screenshots, tests and the guided tour always see the same residents.
//
// Everything here is invented for the demo: names end in "(demo)", phone numbers
// are the fictional +91 90000 0000x range, medicines are "Demo Tablet …", and
// nothing is drawn from any real person or field record.

import { dosesForDay, type DoseEvent, type Medicine } from "../core/doses.ts";
import { localDay, IST_OFFSET_MIN } from "../core/doseTick.ts";
import type { ElderRow } from "../core/profile.ts";
import type { Stage } from "../core/companion/types.ts";

export const DEMO_SEED = 2412;
const DAY = 86_400_000;
const MIN = 60_000;

/** mulberry32: tiny seeded PRNG, good enough for demo variety. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ConvLine { who: "elder" | "sahaya"; text: string }

export interface DemoData {
  elder: ElderRow[];
  medicine: Medicine[];
  dose_event: DoseEvent[];
  session: Record<string, unknown>[];
  activity_score: Record<string, unknown>[];
  safety_event: Record<string, unknown>[];
  consent: Record<string, unknown>[];
  /** Scripted sample conversations, keyed by session id (device-local, never synced). */
  conversations: Record<string, ConvLine[]>;
}

type Lang = "hi" | "en" | "mr";

interface Persona {
  id: string; name: string; stage: Stage; language: string; dialect: string | null; lang: Lang;
  decade: number; prefs: string[]; triggers: string[]; energy: string; sundown: [string, string] | null;
  notes: string; days: number; meds: { name: string; dose: string; times: string[]; instructions: string }[];
  /** Memory-activity trend: "steady" or "decline" (a synthetic example of the flag). */
  trend: "steady" | "decline" | "none";
}

const PEOPLE: Persona[] = [
  {
    id: "demo-elder", name: "Shanti (demo)", stage: 4, language: "hi-IN", dialect: null, lang: "hi", decade: 1950,
    prefs: ["पुराने फ़िल्मी गाने", "खाना बनाना"], triggers: ["अस्पताल की बात"], energy: "सुबह शांत, शाम को थकान",
    sundown: ["17:00", "19:00"], notes: "नमूना कहानी: शांति जी को रसोई में नई चीज़ें बनाना और रेडियो पर पुराने गाने सुनना अच्छा लगता था।",
    days: 21, trend: "steady",
    meds: [
      { name: "Demo Tablet A", dose: "1 गोली", times: ["08:00", "20:00"], instructions: "नाश्ते के बाद" },
      { name: "Demo Tablet B", dose: "1 गोली", times: ["14:00"], instructions: "खाने के बाद" },
    ],
  },
  {
    id: "demo-e2", name: "Ramkali (demo)", stage: 5, language: "hi-IN", dialect: "Bundeli", lang: "hi", decade: 1940,
    prefs: ["भजन", "गाय-बछड़े", "आल्हा"], triggers: ["पति की बात"], energy: "दोपहर में नींद",
    sundown: ["17:30", "19:30"], notes: "नमूना कहानी: गाँव में आँगन, तुलसी चौरा और सुबह का भजन।",
    days: 28, trend: "none",
    meds: [{ name: "Demo Tablet C", dose: "1 गोली", times: ["09:00", "21:00"], instructions: "पानी के साथ" }],
  },
  {
    id: "demo-e3", name: "Govind (demo)", stage: 3, language: "hi-IN", dialect: "Malwi", lang: "hi", decade: 1950,
    prefs: ["क्रिकेट", "पोहा-जलेबी", "खेती"], triggers: [], energy: "सुबह अच्छा मन",
    sundown: null, notes: "नमूना कहानी: इंदौर के पास खेत, शाम को रेडियो पर कमेंट्री।",
    days: 14, trend: "steady",
    meds: [{ name: "Demo Tablet D", dose: "1 गोली", times: ["08:30"], instructions: "नाश्ते के साथ" }],
  },
  {
    id: "demo-e4", name: "Sushila (demo)", stage: 6, language: "hi-IN", dialect: "Malwi", lang: "hi", decade: 1940,
    prefs: ["मीठा", "फूल", "बारिश की आवाज़"], triggers: ["अंधेरा"], energy: "ज़्यादातर थकी रहती हैं",
    sundown: ["16:30", "19:00"], notes: "नमूना कहानी: फूलों की क्यारी और मीठी खीर।",
    days: 30, trend: "none",
    meds: [{ name: "Demo Syrup E", dose: "5 ml", times: ["10:00", "18:00"], instructions: "खाने के बाद" }],
  },
  {
    id: "demo-e5", name: "Joseph (demo)", stage: 2, language: "en-IN", dialect: null, lang: "en", decade: 1950,
    prefs: ["old hymns", "railway stories", "gardening"], triggers: ["talk of hospitals"], energy: "Best before lunch",
    sundown: null, notes: "Sample story: worked on the railways and loved tending roses.",
    days: 16, trend: "steady",
    meds: [{ name: "Demo Tablet F", dose: "1 tablet", times: ["07:30", "19:30"], instructions: "after food" }],
  },
  {
    id: "demo-e6", name: "Vithabai (demo)", stage: 4, language: "mr-IN", dialect: "Varhadi", lang: "mr", decade: 1950,
    prefs: ["अभंग", "पुरणपोळी", "शेतातली कामं"], triggers: [], energy: "संध्याकाळी गोंधळ",
    sundown: ["17:00", "19:00"], notes: "नमुना कथा: अमरावतीजवळचं गाव आणि पंढरपूरची वारी.",
    days: 24, trend: "steady",
    meds: [{ name: "Demo Tablet G", dose: "1 गोळी", times: ["08:00", "20:00"], instructions: "जेवणानंतर" }],
  },
  {
    id: "demo-e7", name: "Prabhakar (demo)", stage: 5, language: "mr-IN", dialect: "Varhadi", lang: "mr", decade: 1940,
    prefs: ["जुनी गाणी", "बैलगाडी", "चहा"], triggers: ["पैशांची गोष्ट"], energy: "दुपारी झोप",
    sundown: ["18:00", "20:00"], notes: "नमुना कथा: बैलगाडीतून बाजारात जाणं आणि गरम चहा.",
    days: 20, trend: "decline",
    meds: [{ name: "Demo Tablet H", dose: "1 गोळी", times: ["09:00"], instructions: "न्याहारीनंतर" }],
  },
];

// Short scripted conversations. Elder lines are invented; Sahaya lines follow the
// stage rules (short, one question, no quizzing) and pass the output guard (tested).
const CONVERSATIONS: Record<string, ConvLine[]> = {
  "demo-elder": [
    { who: "sahaya", text: "नमस्ते शांति जी। आज आपका मन कैसा है?" },
    { who: "elder", text: "ठीक है। रेडियो पर गाना आ रहा था।" },
    { who: "sahaya", text: "वाह, गाने सुनना कितना अच्छा लगता है। कौन सा गाना था?" },
    { who: "elder", text: "पुराना वाला… लता जी का।" },
    { who: "sahaya", text: "बहुत सुंदर। उनकी आवाज़ बहुत मीठी है।" },
  ],
  "demo-e2": [
    { who: "sahaya", text: "राम राम रामकली जी। भजन सुनें?" },
    { who: "elder", text: "हाँ।" },
    { who: "sahaya", text: "अच्छा। आँगन में तुलसी है।" },
    { who: "elder", text: "गाय को रोटी दो।" },
    { who: "sahaya", text: "हाँ, गाय बहुत प्यारी है।" },
  ],
  "demo-e3": [
    { who: "sahaya", text: "नमस्ते गोविंद जी। आज नाश्ते में पोहा था?" },
    { who: "elder", text: "हाँ, और जलेबी भी।" },
    { who: "sahaya", text: "वाह, इंदौर वाला नाश्ता! आपको खेत में कौन सा काम सबसे अच्छा लगता था?" },
    { who: "elder", text: "सोयाबीन की कटाई।" },
    { who: "sahaya", text: "मेहनत का काम, और फ़सल देखकर खुशी भी।" },
  ],
  "demo-e4": [
    { who: "sahaya", text: "सुशीला जी, मैं यहीं हूँ।" },
    { who: "elder", text: "अंधेरा…" },
    { who: "sahaya", text: "देखिए, फूल हैं। पीले फूल।" },
    { who: "elder", text: "फूल।" },
    { who: "sahaya", text: "हाँ, सुंदर फूल।" },
  ],
  "demo-e5": [
    { who: "sahaya", text: "Good morning, Joseph. How are your roses doing?" },
    { who: "elder", text: "The red ones are blooming. I watered them early." },
    { who: "sahaya", text: "Lovely. Which train route did you enjoy most in your railway days?" },
    { who: "elder", text: "The ghat section near Pune. Tunnels everywhere." },
    { who: "sahaya", text: "That sounds beautiful, with all those hills and tunnels." },
  ],
  "demo-e6": [
    { who: "sahaya", text: "नमस्कार विठाबाई. आज अभंग ऐकूया का?" },
    { who: "elder", text: "हो, विठ्ठलाचा." },
    { who: "sahaya", text: "छान. वारीची आठवण येते का?" },
    { who: "elder", text: "हो, खूप चालायचो." },
    { who: "sahaya", text: "किती सुंदर आठवण आहे." },
  ],
  "demo-e7": [
    { who: "sahaya", text: "नमस्कार प्रभाकरराव. चहा घेऊया?" },
    { who: "elder", text: "बाजारात जायचंय." },
    { who: "sahaya", text: "बैलगाडीतून जायचात ना? छान." },
    { who: "elder", text: "हो." },
    { who: "sahaya", text: "गरम चहा आणि गप्पा. छान वाटतं." },
  ],
};

const TOPICS = ["music", "reminiscence", "food", "festivals", "family", "nature"] as const;

/** ISO for a local IST clock time `daysAgo` days before `now`. */
function at(now: number, daysAgo: number, hhmm: string): string {
  const day = localDay(now - daysAgo * DAY, IST_OFFSET_MIN);
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - IST_OFFSET_MIN * MIN).toISOString();
}

export function generateDemo(now: number, seed: number = DEMO_SEED): DemoData {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const out: DemoData = { elder: [], medicine: [], dose_event: [], session: [], activity_score: [], safety_event: [], consent: [], conversations: {} };

  PEOPLE.forEach((p, pi) => {
    out.elder.push({
      id: p.id, display_name: p.name, age: null, birth_decade: p.decade, gds_stage: p.stage,
      language: p.language, dialect: p.dialect, preferences: p.prefs, triggers: p.triggers, energy_pattern: p.energy,
      sundown_start: p.sundown?.[0] ?? null, sundown_end: p.sundown?.[1] ?? null, facility: "Demo Ghar",
      family_contacts: [
        { name: p.lang === "en" ? "Demo Son" : "Demo Beta", relation: p.lang === "en" ? "son" : p.lang === "mr" ? "मुलगा" : "बेटा", phone: `+91 90000 0000${(pi * 2 + 1) % 10}`, whatsapp: true, order: 1 },
        { name: p.lang === "en" ? "Demo Daughter" : "Demo Beti", relation: p.lang === "en" ? "daughter" : p.lang === "mr" ? "मुलगी" : "बेटी", phone: `+91 90000 0000${(pi * 2 + 2) % 10}`, whatsapp: true, order: 2 },
      ],
      ngo_helpline: null, // deliberately empty: a real setup adds a verified local helpline
      persona_name: "Sahaya", source: "app", notes: p.notes,
    });
    out.consent.push({
      id: `${p.id}-consent`, subject_type: "elder", subject_id: p.id, given_by: "guardian", method: "digital",
      scope_store: 1, scope_sync: 0, scope_audio_cloud: 1, scope_llm_cloud: 0, scope_contact_share: 0, scope_research_aggregate: 0,
      language: p.lang, recorded_at: at(now, p.days + 2, "10:00"),
    });

    // Medicines and their dose history up to yesterday (today is created by the live tick).
    let missedSoFar = 0;
    p.meds.forEach((m, mi) => {
      const med: Medicine = { id: `${p.id}-med-${mi + 1}`, elder_id: p.id, name: m.name, dose: m.dose, times: m.times,
        instructions: m.instructions, escalate_after_min: 30, alert_user_id: null, active: 1 };
      out.medicine.push(med);
      for (let d = p.days; d >= 1; d--) {
        const day = localDay(now - d * DAY, IST_OFFSET_MIN);
        for (const ev of dosesForDay(med, day, IST_OFFSET_MIN)) {
          const due = Date.parse(ev.scheduled_at);
          const x = r();
          // Roughly 1 in 12 doses missed (capped at 3 per person), a few skipped, the rest taken.
          if (x < 0.085 && missedSoFar < 3) {
            missedSoFar++;
            const escalated = new Date(due + 30 * MIN).toISOString();
            out.dose_event.push({ ...ev, status: "escalated", escalated_at: escalated });
            out.safety_event.push({ id: `${ev.id}-alert`.replace(/:/g, "-"), elder_id: p.id, session_id: null, at: escalated,
              trigger: "missed_dose", matched: m.name, action: "caregiver_push", resolved_at: null, resolved_by: null });
          } else if (x < 0.11) {
            out.dose_event.push({ ...ev, status: "skipped", confirmed_at: new Date(due + 20 * MIN).toISOString(), confirmed_by: "caregiver" });
          } else {
            out.dose_event.push({ ...ev, status: "taken", confirmed_at: new Date(due + Math.floor(r() * 25) * MIN).toISOString(), confirmed_by: r() < 0.7 ? "elder" : "caregiver" });
          }
        }
      }
    });

    // Companion sessions every 2-4 days, each with caregiver feedback.
    let lastTalk = "";
    for (let d = p.days - 1; d >= 1; d -= 2 + Math.floor(r() * 3)) {
      const id = `${p.id}-talk-${d}`;
      const start = at(now, d, pick(["10:30", "11:00", "16:00"]));
      const topics = [pick(TOPICS), pick(TOPICS)].filter((t, i, a) => a.indexOf(t) === i);
      const mood = Math.min(5, Math.max(2, Math.round(3 + r() * 2 - (p.stage >= 6 ? 1 : 0))));
      out.session.push({
        id, elder_id: p.id, mode: "companion", started_at: start, ended_at: new Date(Date.parse(start) + (8 + Math.floor(r() * 12)) * MIN).toISOString(),
        stage_at_session: p.stage, language: p.language, topics, feedback_mood: mood,
        feedback_keep: mood >= 4 ? [topics[0]] : [], feedback_avoid: mood <= 2 ? [topics[0]] : [],
        feedback_notes: mood >= 5 ? (p.lang === "en" ? "Sample note: smiled a lot today." : "नमूना: आज बहुत मुस्कुराए।") : null,
      });
      lastTalk = id;
    }
    if (lastTalk) out.conversations[lastTalk] = CONVERSATIONS[p.id];

    // Weekly memory activities (not for stage 6+, where they would only frustrate).
    if (p.trend !== "none") {
      const weeks = Math.floor(p.days / 7);
      for (let w = weeks; w >= 1; w--) {
        const sid = `${p.id}-act-${w}`;
        const start = at(now, w * 7 - 1, "11:30");
        out.session.push({ id: sid, elder_id: p.id, mode: "memory_activity", started_at: start, ended_at: start, stage_at_session: p.stage,
          language: p.language, topics: [], feedback_mood: null, feedback_keep: [], feedback_avoid: [], feedback_notes: null });
        const drop = p.trend === "decline" && w <= 2 ? 2 : 0;
        const base = { orientation: p.stage <= 3 ? 5 : 4, immediate: 4 - Math.floor(p.stage / 3), delayed: 3 - Math.floor(p.stage / 3), fluency: 13 - p.stage };
        const max: Record<string, number | null> = { orientation: 5, immediate: 5, delayed: 5, fluency: null };
        for (const task of ["orientation", "immediate", "delayed", "fluency"] as const) {
          const noise = task !== "orientation" && r() < 0.25 ? 1 : 0;
          const v = Math.max(0, base[task] - drop * (task === "fluency" ? 2 : 1) - noise);
          out.activity_score.push({ id: `${sid}-${task}`, session_id: sid, task, score: v, max_score: max[task] });
        }
      }
    }
  });

  // One worked incident: Ramkali says her leg hurts, accepts a call, family answers.
  const incSession = "demo-e2-talk-incident";
  const t0 = Date.parse(at(now, 3, "16:10"));
  out.session.push({ id: incSession, elder_id: "demo-e2", mode: "companion", started_at: new Date(t0 - 4 * MIN).toISOString(),
    ended_at: new Date(t0 + 12 * MIN).toISOString(), stage_at_session: 5, language: "hi-IN", topics: ["music"],
    feedback_mood: 3, feedback_keep: ["music"], feedback_avoid: [], feedback_notes: "नमूना: पैर में दर्द कहा, बेटे से बात के बाद शांत हुईं।" });
  const steps: [number, string][] = [[0, "reassure_ask"], [25, "call_family_1"], [140, "connected"], [600, "resolved"]];
  for (const [i, [s, action]] of steps.entries()) {
    const ts = new Date(t0 + s * 1000).toISOString();
    out.safety_event.push({ id: `demo-e2-inc-${i + 1}`, elder_id: "demo-e2", session_id: incSession, at: ts, trigger: "keyword",
      matched: "pair mein dard", action, resolved_at: action === "resolved" ? ts : null, resolved_by: action === "resolved" ? "caregiver" : null });
  }
  return out;
}

export const DEMO_PEOPLE_COUNT = PEOPLE.length;
