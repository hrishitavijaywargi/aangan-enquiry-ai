/** Deterministic timeline parsing relative to the call date. */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, couple: 2, few: 3,
};

export const DAY_MS = 86_400_000;

function monthIndex(token: string): number {
  const t = token.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(t));
}

function toNum(token: string): number | undefined {
  const t = token.toLowerCase();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return NUM_WORDS[t];
}

/** Resolve "March" to the next occurrence of March relative to `ref` (end of month by default). */
export function resolveMonth(idx: number, ref: Date, explicitYear?: number, day?: number): Date {
  let year = explicitYear ?? ref.getUTCFullYear();
  if (explicitYear === undefined && idx < ref.getUTCMonth()) year += 1;
  const d = day ?? new Date(Date.UTC(year, idx + 1, 0)).getUTCDate(); // last day of month
  return new Date(Date.UTC(year, idx, d));
}

export function weeksBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (7 * DAY_MS);
}

const DURATION_RE = /\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few)\s*(?:of\s*)?(week|wk|month|day)s?\b/gi;

/**
 * "in 3 weeks", "three weeks away", "6 weeks" → weeks; "4 months" → weeks.
 * Past durations ("it's been four days", "two years ago") are ignored.
 * With `requireFutureCue`, only durations that clearly point forward are accepted.
 */
export function parseDuration(text: string, requireFutureCue = false): number | undefined {
  const all = Array.from(text.matchAll(DURATION_RE));
  const m = all.find((x) => {
    const i = x.index ?? 0;
    const before = text.slice(Math.max(0, i - 30), i).toLowerCase();
    const after = text.slice(i + x[0].length, i + x[0].length + 14).toLowerCase();
    if (/\b(been|for the (last|past)|since|over the (last|past)|here for)\s*(about\s*)?$/.test(before) || /^\s*(ago|back|old)\b/.test(after)) return false;
    if (requireFutureCue) {
      return /\b(in|within|about|around|only|just|next|max|maximum|another|are|is|that's|thats)\s*(about\s*)?$/.test(before) || /^\s*(away|max|maximum|from now)\b/.test(after);
    }
    return true;
  });
  if (!m) return undefined;
  const n = toNum(m[1]);
  if (n === undefined) return undefined;
  const unit = m[2].toLowerCase();
  if (unit.startsWith("w")) return n;
  if (unit.startsWith("m")) return n * 4.345;
  return n / 7;
}

export interface TimelineParse {
  requiredBy?: Date;
  flexible?: boolean;
  asap?: boolean;
  startText?: string;
  siteAvailableInWeeks?: number;
  matched?: string;
}

const START_CUE = /\b(start|starting|begin|commence|kick off)\b/i;
const COMPLETION_WORDS = /\b(done|ready|complete|move\s*(?:back\s*)?in|operational|finish)\b/;
const DEADLINE_BEFORE_MONTH = /\b(by|before|done|ready|complete|finish|move\s*(back\s*)?in|moving in|operational|until|deadline)\b[^,.;]*$/;

export function parseTimeline(text: string, ref: Date, festivals: Record<string, string> = {}): TimelineParse {
  const t = text.toLowerCase();
  const out: TimelineParse = {};

  if (/\b(no rush|flexible|no (?:specific |fixed |hard )?deadline|whenever|no hurry|not in a rush|plenty of time|take our time|no particular)\b/.test(t)) {
    out.flexible = true;
    out.matched = "flexible";
  }
  if (/\b(asap|as soon as possible|immediately|right away|urgent(?:ly)?)\b/.test(t)) out.asap = true;

  // Possession / site availability: "possession in six weeks", "possession next month", "possession October 15"
  const poss = t.match(/possession[^.?!]*/);
  if (poss) {
    const seg = poss[0];
    const dur = parseDuration(seg);
    if (dur !== undefined) out.siteAvailableInWeeks = dur;
    else if (/next month/.test(seg)) out.siteAvailableInWeeks = 4.3;
    else if (/(last month|already|got possession|have possession|was last)/.test(seg)) out.siteAvailableInWeeks = 0;
    else {
      const a = seg.match(new RegExp(`${MONTH_RE}\\s*(\\d{1,2})?`, "i"));
      const b = seg.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s*${MONTH_RE}`, "i"));
      if (b) out.siteAvailableInWeeks = Math.max(0, weeksBetween(ref, resolveMonth(monthIndex(b[2]), ref, undefined, Number(b[1]))));
      else if (a) out.siteAvailableInWeeks = Math.max(0, weeksBetween(ref, resolveMonth(monthIndex(a[1]), ref, undefined, a[2] ? Number(a[2]) : 15)));
    }
  }
  if (/\b(possession already|already have possession|already moved out|bare shell|completely empty|flat is empty|we can go now|site is ready|moved out temporarily|living there|been here)\b/.test(t) && out.siteAvailableInWeeks === undefined) {
    out.siteAvailableInWeeks = 0;
  }

  // Strip the possession clause so "possession in 6 weeks" isn't read as a completion deadline.
  const deadlineText = t.replace(/possession[^.?!]*/g, " ");
  const isStartPhrase = START_CUE.test(deadlineText) && !COMPLETION_WORDS.test(deadlineText);

  // Festival: "before Diwali"
  for (const [name, iso] of Object.entries(festivals)) {
    if (deadlineText.includes(name.toLowerCase())) {
      if (/\bafter\b/.test(deadlineText)) {
        out.startText = `after ${name}`;
        return out;
      }
      const dur = parseDuration(deadlineText, true);
      out.requiredBy = dur !== undefined ? new Date(ref.getTime() + dur * 7 * DAY_MS) : new Date(iso + "T00:00:00Z");
      out.matched = `before ${name}`;
      return out;
    }
  }

  // Relative duration: "in 3 weeks", "3 weeks maximum", "about 4 months"
  const dur = parseDuration(deadlineText, true);
  if (dur !== undefined && !isStartPhrase) {
    out.requiredBy = new Date(ref.getTime() + dur * 7 * DAY_MS);
    out.matched = `${Math.round(dur * 10) / 10} weeks`;
  }

  // Month names: prefer the month that follows a deadline cue ("design in October, move in by February").
  const monthMatches = Array.from(deadlineText.matchAll(new RegExp(`\\b${MONTH_RE}\\b(?:\\s*(\\d{1,2})(?:st|nd|rd|th)?)?(?:\\s*,?\\s*(20\\d{2}))?`, "gi"))).filter(
    (x) => x[1].toLowerCase() !== "may" || /\b(by|in|before) may\b|\bmay 20\d{2}\b/.test(deadlineText),
  );
  if (monthMatches.length) {
    const cueBefore = (x: RegExpMatchArray) => deadlineText.slice(Math.max(0, (x.index ?? 0) - 28), x.index);
    const deadlineMonth = monthMatches.find((x) => DEADLINE_BEFORE_MONTH.test(cueBefore(x)));
    const mm = deadlineMonth ?? monthMatches[monthMatches.length - 1];
    const idx = monthIndex(mm[1]);
    const year = mm[3] ? Number(mm[3]) : undefined;
    const day = mm[2] ? Number(mm[2]) : undefined;
    if (isStartPhrase && !deadlineMonth) {
      out.startText = `start ${MONTHS[idx]}${year ? " " + year : ""}`;
    } else if (!out.requiredBy) {
      out.requiredBy = resolveMonth(idx, ref, year, day);
      out.matched = mm[0];
    }
  }

  if (/\bnext year\b/.test(deadlineText) && !out.requiredBy && !isStartPhrase && !out.flexible) {
    out.requiredBy = new Date(Date.UTC(ref.getUTCFullYear() + 1, 2, 31));
    out.matched = "next year";
  }
  if (isStartPhrase && !out.startText) out.startText = "start mentioned";
  return out;
}
