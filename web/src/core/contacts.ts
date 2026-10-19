// Phone numbers, helpline choices and the on-device links that use them.
// No paid SMS: tel:, sms: and https://wa.me/ links open the phone's own apps.

export interface Contact {
  name: string;
  relation?: string | null;
  phone: string;
  whatsapp?: boolean;
  order: number;
}

export interface Helpline {
  id: string;
  label: { en: string; hi: string };
  number: string;
  source: string;
}

// Offered to the caregiver as choices; nothing is selected unless they pick one.
export const HELPLINE_OPTIONS: readonly Helpline[] = [
  {
    id: "elderline",
    label: { en: "Elderline, national helpline for senior citizens (8 am to 8 pm)", hi: "एल्डरलाइन, वरिष्ठ नागरिक राष्ट्रीय हेल्पलाइन (सुबह 8 से रात 8)" },
    number: "14567",
    source: "https://ladakh.gov.in/elderline-14567-the-national-helpline-for-senior-citizens-launched-in-ladakh/",
  },
  {
    id: "erss",
    label: { en: "112 Emergency Response Support System", hi: "112 आपातकालीन सहायता" },
    number: "112",
    source: "https://112.gov.in/",
  },
];

/** Keep digits and one leading +. Returns "" when nothing usable is left. */
export function cleanPhone(raw: string): string {
  const s = String(raw ?? "").trim();
  const plus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  return digits ? (plus ? "+" : "") + digits : "";
}

/** 3 to 15 digits (E.164 max is 15; short codes like 112 are allowed). */
export const isValidPhone = (raw: string) => {
  const d = cleanPhone(raw).replace("+", "");
  return d.length >= 3 && d.length <= 15;
};

/**
 * Number for wa.me, which needs the country code and no +.
 * A 10-digit Indian mobile (starts 6-9) gets 91. A leading 0 is ambiguous (STD landline
 * like 0755... or a mobile with a trunk 0), so it is not guessed.
 * Anything else is used as entered. Returns null when WhatsApp cannot be addressed.
 */
export function waNumber(raw: string): string | null {
  const c = cleanPhone(raw);
  if (!c) return null;
  if (c.startsWith("+")) return c.slice(1).length >= 8 ? c.slice(1) : null;
  if (/^[6-9]\d{9}$/.test(c)) return "91" + c;
  if (/^91[6-9]\d{9}$/.test(c)) return c;
  return null;
}

export const telLink = (raw: string) => `tel:${cleanPhone(raw)}`;
export const smsLink = (raw: string, text: string) => `sms:${cleanPhone(raw)}?body=${encodeURIComponent(text)}`;
export function waLink(raw: string, text: string): string | null {
  const n = waNumber(raw);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
