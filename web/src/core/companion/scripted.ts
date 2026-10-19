// ScriptedCompanion: the offline companion. No network, no model.
//
// Topic banks by language × stage band (early 1–3, middle 4–5, late 6–7):
// reminiscence, music, festivals, food, weather, plus life-story mode, which
// only asks about the caregiver's own notes. Lines are generic questions or
// gentle sensory statements; they never state facts about the person.
// Early stages ask open questions, middle stages one-idea questions, late
// stages offer comfort and sensory images rather than questions.
//
// mr/gu: add a bank to BANKS and it is used; until then Hindi is spoken.

import type { ElderProfile, FeedbackEntry, Lang, Stage, TopicId } from "./types.ts";
import { addressName, baseLang, fill, personaOf, styleStage } from "./types.ts";
import { normalize } from "./safety.ts";
import { inSundownWindow, partOfDay } from "./prompt.ts";
import { topicForTurn, topicPlan, type TopicPlan } from "./triggers.ts";

export type Band = "early" | "middle" | "late";
type BankTopic = Exclude<TopicId, "life_story">;

export interface Bank {
  topics: Record<BankTopic, Record<Band, string[]>>;
  greet: Record<Band, string>;
  ack: string[];
  joy: string[];
  comfort: string[];
  listening: string;
  calm: string[];
  redirect: string;
  lifeStory: string;
  /** Persona name as written in this script. */
  persona: (name: string) => string;
}

export function bandOf(stage: Stage | null | undefined): Band {
  const s = styleStage(stage);
  return s <= 3 ? "early" : s <= 5 ? "middle" : "late";
}

const HI: Bank = {
  topics: {
    reminiscence: {
      early: ["आप जहाँ बड़े हुए, वह जगह कैसी थी?", "बचपन में आप कौन से खेल खेलते थे?", "आपके स्कूल के दिनों की कोई मज़ेदार बात बताइए।"],
      middle: ["बचपन का घर कैसा था?", "आपके गाँव या मोहल्ले में सबसे अच्छी जगह कौन सी थी?", "बचपन में आपका पसंदीदा खेल कौन सा था?"],
      late: ["पुराने दिनों की बातें कितनी प्यारी होती हैं।", "आपके साथ बैठना बहुत अच्छा लगता है।", "आप बहुत ख़ास हैं।"],
    },
    music: {
      early: ["आपको कौन सा पुराना गाना सबसे ज़्यादा पसंद है?", "कोई भजन या गीत जो आप अक्सर गुनगुनाते हैं?", "आपके ज़माने में रेडियो पर कौन से गाने आते थे?"],
      middle: ["चलिए, कोई पुराना गाना गुनगुनाएँ?", "आपको भजन पसंद है या फ़िल्मी गाना?", "कोई गाना जो आपको खुश कर देता है?"],
      late: ["चलिए, एक धीमा सा गाना सुनते हैं।", "संगीत कितना सुकून देता है।", "हम साथ में गुनगुनाते हैं।"],
    },
    festivals: {
      early: ["बचपन में आपका सबसे पसंदीदा त्योहार कौन सा था?", "त्योहार पर आपके घर में क्या-क्या बनता था?", "दिवाली, होली या ईद, आपको कौन सा त्योहार सबसे अच्छा लगता है?"],
      middle: ["त्योहार पर घर में रौनक कैसी होती थी?", "आपको होली के रंग पसंद हैं या दिवाली के दीये?", "त्योहार की मिठाई में आपको क्या पसंद है?"],
      late: ["दीयों की रोशनी कितनी सुंदर लगती है।", "मिठाई की खुशबू कितनी अच्छी होती है।", "रंग-बिरंगे फूल कितने प्यारे लगते हैं।"],
    },
    food: {
      early: ["आपकी माँ कौन सा खाना बनाती थीं जो आपको बहुत पसंद था?", "सर्दियों में आपको क्या खाना अच्छा लगता है?", "आपकी अपनी कोई ख़ास रेसिपी है?"],
      middle: ["आपको मीठा पसंद है या नमकीन?", "गरम चाय के साथ आपको क्या अच्छा लगता है?", "आपको कौन सा फल सबसे अच्छा लगता है?"],
      late: ["गरम चाय की खुशबू कितनी अच्छी लगती है।", "मीठा आम कितना स्वादिष्ट होता है।", "गरम रोटी की खुशबू कितनी प्यारी होती है।"],
    },
    weather: {
      early: ["आपको कौन सा मौसम सबसे अच्छा लगता है?", "बारिश के दिनों की कोई बात बताइए।", "सर्दी की धूप में बैठना आपको पसंद है?"],
      middle: ["आपको बारिश पसंद है या धूप?", "ठंडी हवा कितनी अच्छी लगती है, है ना?", "आपको सुबह का समय अच्छा लगता है या शाम का?"],
      late: ["बारिश की आवाज़ कितनी सुकून वाली होती है।", "हल्की धूप कितनी अच्छी लगती है।", "नीला आसमान कितना सुंदर लगता है।"],
    },
  },
  greet: {
    early: "नमस्ते {name}। मैं {persona} हूँ। आज आप कैसा महसूस कर रहे हैं?",
    middle: "नमस्ते {name}। मैं {persona} हूँ। चलिए, थोड़ी बातें करते हैं।",
    late: "नमस्ते {name}। मैं यहीं हूँ, आपके साथ।",
  },
  ack: ["कितना अच्छा।", "बहुत सुंदर।", "बताने के लिए धन्यवाद।", "सुनकर अच्छा लगा।"],
  joy: ["आपकी खुशी देखकर मन खुश हो गया।"],
  comfort: ["मैं यहीं हूँ, {name}, आपके साथ।", "कोई बात नहीं, हम साथ हैं।"],
  listening: "आपकी बात सुनना मुझे अच्छा लगता है, {name}।",
  calm: ["चलिए, धीरे-धीरे साँस लेते हैं।", "सब ठीक है, {name}। आराम से बैठिए।"],
  redirect: "चलिए, कुछ और बात करते हैं।",
  lifeStory: "मुझे इसके बारे में और बताइए: {line}",
  persona: n => (n === "Sahaya" ? "सहाया" : n),
};

const EN: Bank = {
  topics: {
    reminiscence: {
      early: ["What was the place where you grew up like?", "What games did you play as a child?", "Tell me something funny from your school days."],
      middle: ["What was your childhood home like?", "What was the nicest place in your village or neighbourhood?", "What was your favourite game as a child?"],
      late: ["Old days have such sweet memories.", "It is lovely to sit with you.", "You are very special."],
    },
    music: {
      early: ["Which old song do you like the most?", "Is there a bhajan or song you often hum?", "Which songs played on the radio when you were young?"],
      middle: ["Shall we hum an old song together?", "Do you like bhajans or film songs?", "Is there a song that makes you happy?"],
      late: ["Let's listen to a soft song.", "Music is so soothing.", "Let's hum together."],
    },
    festivals: {
      early: ["Which festival did you love most as a child?", "What was cooked at home for festivals?", "Diwali, Holi or Eid, which festival do you enjoy most?"],
      middle: ["How did the house feel at festival time?", "Do you like Holi colours or Diwali lamps?", "Which festival sweet do you like?"],
      late: ["Diya lights look so beautiful.", "Sweets smell so lovely.", "Colourful flowers are so pretty."],
    },
    food: {
      early: ["What food did your mother make that you loved?", "What do you like to eat in winter?", "Do you have a special recipe of your own?"],
      middle: ["Do you like sweet or salty snacks?", "What do you like with hot chai?", "Which fruit do you like best?"],
      late: ["Hot chai smells so good.", "A sweet mango is so tasty.", "Warm rotis smell so lovely."],
    },
    weather: {
      early: ["Which season do you like the most?", "Tell me about rainy days you enjoyed.", "Do you like sitting in the winter sun?"],
      middle: ["Do you like rain or sunshine?", "A cool breeze feels nice, doesn't it?", "Do you like mornings or evenings?"],
      late: ["The sound of rain is so calming.", "Soft sunshine feels so nice.", "A blue sky looks so beautiful."],
    },
  },
  greet: {
    early: "Hello {name}. I'm {persona}. How are you feeling today?",
    middle: "Hello {name}. I'm {persona}, here to chat with you.",
    late: "Hello {name}. I'm right here with you.",
  },
  ack: ["That sounds lovely.", "How nice.", "Thank you for telling me.", "I love hearing that."],
  joy: ["Your happiness makes me happy too."],
  comfort: ["I'm right here with you, {name}.", "It's all right, we're together."],
  listening: "I love listening to you, {name}.",
  calm: ["Let's breathe slowly together.", "All is well, {name}. Let's sit comfortably."],
  redirect: "Let's talk about something nice.",
  lifeStory: "Tell me more about this: {line}",
  persona: n => n,
};

export const BANKS: Partial<Record<Lang, Bank>> = { hi: HI, en: EN };

export function bankFor(lang: Lang): Bank {
  return BANKS[lang] ?? HI;
}

const SAD = ["udaas", "udas", "akela", "akeli", "dukh", "rona", "ro raha", "ro rahi", "sad", "lonely", "miss", "crying",
  "उदास", "अकेला", "अकेली", "दुख", "दुखी", "रोना", "याद आ"];
const HAPPY = ["khush", "maza", "mazaa", "achha laga", "happy", "wonderful", "lovely", "खुश", "मज़ा", "मजा", "अच्छा लगा"];
const CALM_TOPICS: readonly TopicId[] = ["music", "weather"];

function hasAny(text: string, words: string[]): boolean {
  const t = ` ${normalize(text)} `;
  return words.some(w => t.includes(` ${normalize(w)}`));
}

/** Caregiver notes split into short lines; used verbatim, never embellished. */
export function storyLines(story: string | null | undefined): string[] {
  return String(story ?? "").split(/\n|[.।!?]/).map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length > 3);
}

export interface ScriptedReply {
  text: string;
  topic: TopicId | null;
  lang: Lang;
}

export interface ScriptedInput {
  /** What the person said (empty when nothing was heard). */
  text?: string;
  /** 0-based count of companion turns so far. */
  turn: number;
  /** Local "HH:MM". */
  clock?: string | null;
  /** Gently move to this topic (TriggerFilter or OutputGuard asked for it). */
  redirectTo?: TopicId | null;
}

export class ScriptedCompanion {
  readonly lang: Lang;
  readonly band: Band;
  private readonly profile: ElderProfile;
  private readonly bank: Bank;
  private readonly plan: TopicPlan;
  private readonly story: string[];
  private readonly used = new Map<TopicId, number>();

  constructor(profile: ElderProfile, opts: { feedback?: readonly FeedbackEntry[]; plan?: TopicPlan } = {}) {
    this.profile = profile;
    this.lang = baseLang(profile.language);
    this.bank = bankFor(this.lang);
    this.band = bandOf(profile.gdsStage);
    this.plan = opts.plan ?? topicPlan(profile, opts.feedback ?? []);
    // late stages: comfort, not recall
    this.story = this.band === "late" ? [] : storyLines(profile.lifeStory);
    if (!this.story.length) this.plan = { ...this.plan, weights: { ...this.plan.weights, life_story: 0 } };
  }

  private vars(): Record<string, string> {
    return { name: addressName(this.profile, this.lang), persona: this.bank.persona(personaOf(this.profile)) };
  }

  /** First line of a session. */
  opener(clock?: string | null): ScriptedReply {
    const calm = inSundownWindow(clock, this.profile.sundownStart, this.profile.sundownEnd);
    const greet = fill(this.bank.greet[calm ? "late" : this.band], this.vars());
    return { text: greet, topic: null, lang: this.lang };
  }

  reply(input: ScriptedInput): ScriptedReply {
    const text = input.text ?? "";
    const calm = inSundownWindow(input.clock, this.profile.sundownStart, this.profile.sundownEnd);
    const topic = input.redirectTo && this.plan.weights[input.redirectTo] > 0
      ? input.redirectTo
      : topicForTurn(this.plan.weights, input.turn, calm ? CALM_TOPICS : undefined);
    const line = this.topicLine(topic);

    let lead: string | null;
    if (input.redirectTo) lead = this.bank.redirect;
    else if (hasAny(text, SAD)) lead = this.pick(this.bank.comfort, input.turn);
    else if (calm) lead = this.pick(this.bank.calm, input.turn);
    else if (!normalize(text)) lead = this.bank.listening;
    else if (hasAny(text, HAPPY)) lead = this.pick(this.bank.joy, input.turn);
    else lead = this.pick(this.bank.ack, input.turn);

    // late stage: one short sentence; comfort beats a topic when they are sad
    if (this.band === "late") {
      const only = hasAny(text, SAD) ? lead : line;
      return { text: fill(only, this.vars()), topic: hasAny(text, SAD) ? null : topic, lang: this.lang };
    }
    return { text: fill(`${lead} ${line}`, this.vars()), topic, lang: this.lang };
  }

  /** A short comfort line ("I'm right here with you"). */
  comfort(turn = 0): string {
    return fill(this.pick(this.bank.comfort, turn), this.vars());
  }

  private topicLine(topic: TopicId): string {
    const n = this.used.get(topic) ?? 0;
    this.used.set(topic, n + 1);
    if (topic === "life_story") {
      const s = this.story[n % this.story.length]!;
      return fill(this.bank.lifeStory, { line: s });
    }
    const lines = this.bank.topics[topic][this.band];
    return lines[n % lines.length]!;
  }

  private pick(lines: string[], turn: number): string {
    return lines[turn % lines.length]!;
  }
}
