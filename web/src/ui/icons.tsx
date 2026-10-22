// One small stroke icon set (24×24, stroke 2, currentColor), used instead of emoji so the
// screen looks the same on every phone and screen readers read only the label.

const P: Record<string, string> = {
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3 M8 21h8",
  speakerUp: "M4 9h4l5-4v14l-5-4H4z M16 8.5a5 5 0 0 1 0 7 M18.5 6a8.5 8.5 0 0 1 0 12",
  speakerDown: "M4 9h4l5-4v14l-5-4H4z M16 9.5a3.5 3.5 0 0 1 0 5",
  replay: "M4 12a8 8 0 1 0 2.4-5.7 M4 4v4h4",
  phone: "M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  chat: "M4 5h16v11H9l-5 4z",
  keyboard: "M3 7h18v10H3z M7 11h.01 M11 11h.01 M15 11h.01 M8 14h8",
  check: "M5 12.5l4.5 4.5L19 7",
  cross: "M6 6l12 12 M18 6L6 18",
  music: "M9 18V5l11-2v13 M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3z M20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z",
  book: "M4 5a2 2 0 0 1 2-2h5v17H6a2 2 0 0 0-2 2z M20 5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2z",
  hand: "M8 13V6a1.5 1.5 0 0 1 3 0v5 M11 11V4.5a1.5 1.5 0 0 1 3 0V11 M14 11V6a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 15.3L3 12.5a1.5 1.5 0 0 1 2.7-1.3L8 14",
  backspace: "M9 5h11v14H9l-6-7z M12 9l6 6 M18 9l-6 6",
  close: "M6 6l12 12 M18 6L6 18",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v5 M12 8h.01",
  print: "M7 9V3h10v6 M6 17H4V9h16v8h-2 M7 14h10v7H7z",
  share: "M4 12v7h16v-7 M12 3v12 M7 8l5-5 5 5",
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 28 }: { name: IconName; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d={P[name]} />
    </svg>
  );
}
