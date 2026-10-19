// Global Deterioration Scale (Reisberg, Ferris, de Leon & Crook 1982, Am J Psychiatry
// 139:1136-1139). One plain-language line per stage to help a caregiver pick the stage
// a doctor or assessor gave. The app never assigns or guesses a stage.

export type Stage = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const STAGES: readonly Stage[] = [1, 2, 3, 4, 5, 6, 7];

export const GDS: Record<Stage, { en: string; hi: string; title: { en: string; hi: string } }> = {
  1: {
    title: { en: "No decline", hi: "कोई कमी नहीं" },
    en: "No memory problems that they or others notice.",
    hi: "याददाश्त में कोई परेशानी नहीं दिखती।",
  },
  2: {
    title: { en: "Very mild", hi: "बहुत हल्की" },
    en: "Forgets names or where things are kept; others usually do not notice.",
    hi: "नाम या चीज़ें कहाँ रखीं, भूल जाते हैं; दूसरों को अक्सर पता नहीं चलता।",
  },
  3: {
    title: { en: "Mild", hi: "हल्की" },
    en: "Family notices: repeats questions, gets lost in new places, trouble finding words.",
    hi: "परिवार को दिखने लगता है: एक ही बात दोहराना, नई जगह रास्ता भूलना, शब्द ढूँढने में मुश्किल।",
  },
  4: {
    title: { en: "Moderate", hi: "मध्यम" },
    en: "Needs help with money, shopping or planning; forgets recent events.",
    hi: "पैसे, ख़रीदारी या योजना में मदद चाहिए; हाल की बातें भूल जाते हैं।",
  },
  5: {
    title: { en: "Moderately severe", hi: "काफ़ी गंभीर" },
    en: "Needs help choosing clothes; often unsure of the date or place; still knows close family.",
    hi: "कपड़े चुनने में मदद चाहिए; तारीख़ या जगह को लेकर अक्सर उलझन; अपने क़रीबी लोगों को पहचानते हैं।",
  },
  6: {
    title: { en: "Severe", hi: "गंभीर" },
    en: "Needs help dressing, bathing and with the toilet; may forget a spouse's name; restless or anxious.",
    hi: "कपड़े पहनने, नहाने, शौचालय में मदद चाहिए; जीवनसाथी का नाम भूल सकते हैं; बेचैनी या घबराहट।",
  },
  7: {
    title: { en: "Very severe", hi: "बहुत गंभीर" },
    en: "Very few or no words; needs help to eat and walk.",
    hi: "बहुत कम या कोई शब्द नहीं; खाने और चलने में मदद चाहिए।",
  },
};

export const isStage = (n: unknown): n is Stage => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 7;
