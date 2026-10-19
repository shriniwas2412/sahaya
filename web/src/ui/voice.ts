// Speech output with a volume setting (the elder screen's louder/softer button).
// Listening and capability checks come from core/speech (WebSpeechProvider).

function voiceFor(locale: string): SpeechSynthesisVoice | undefined {
  const vs = speechSynthesis.getVoices();
  const base = locale.split("-")[0];
  return vs.find((v) => v.lang === locale) ?? vs.find((v) => v.lang.startsWith(base));
}

export function speak(text: string, locale: string, rate = 0.85, volume = 1): Promise<void> {
  if (typeof speechSynthesis === "undefined" || !text) return Promise.resolve();
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = locale;
    u.rate = rate;
    u.volume = volume;
    const v = voiceFor(locale);
    if (v) u.voice = v;
    // Resolve on end, on error, or after a generous estimate, whichever comes first.
    const t = setTimeout(resolve, 2000 + text.length * 120 / rate);
    u.onend = u.onerror = () => { clearTimeout(t); resolve(); };
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
