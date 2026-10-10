import { ADJOINING_AREAS, OUT_OF_AREA, OUT_OF_SCOPE_PROJECT_TYPES, PCMC_AREAS, PUNE_CITY_AREAS } from "./config/business";
import { parseTimeline } from "./timeline";
import type { DecisionMaker, EnquiryFields, LocationStatus, QuestionKey, ScopeType } from "./types";

/**
 * Deterministic interpretation of one caller utterance.
 * Returns only the fields this utterance established, plus a quote per field (evidence).
 */
export interface Extraction {
  fields: Partial<EnquiryFields>;
  evidence: Record<string, string>;
  isPricingQuestion: boolean;
  isComplaint: boolean;
  declinedToAnswer: boolean;
  affirmative: boolean;
  negative: boolean;
}

const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function quote(text: string, needle: RegExp | string): string {
  const sentences = text.split(/(?<=[.?!])\s+|\s+--\s+|\s+—\s+/);
  const re = typeof needle === "string" ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : needle;
  const s = sentences.find((x) => re.test(x)) ?? text;
  return s.trim().slice(0, 220);
}

export function matchLocation(text: string): { location?: string; status?: LocationStatus } {
  const t = text.toLowerCase();
  const find = (list: string[]) => list.filter((a) => new RegExp(`\\b${a}\\b`).test(t)).sort((a, b) => b.length - a.length)[0];
  const out = find(OUT_OF_AREA);
  const pune = find(PUNE_CITY_AREAS) ?? find(PCMC_AREAS) ?? find(ADJOINING_AREAS);
  if (out) return { location: cap(out), status: "out_of_area" };
  if (pune) return { location: cap(pune), status: "in_area" };
  if (/\b(near|outside|around|outskirts of)\s+pune\b/.test(t)) return { location: "Near Pune (unspecified)", status: "unclear" };
  if (/\b(pcmc|pimpri[- ]chinchwad)\b/.test(t)) return { location: "PCMC", status: "in_area" };
  if (/\bpune\b/.test(t)) return { location: "Pune", status: "in_area" };
  return {};
}

const ROOM_PATTERNS: [RegExp, string][] = [
  [/\bkitchen\b/i, "kitchen"],
  [/\bliving( room)?\b|\bhall\b/i, "living room"],
  [/\bdining\b/i, "dining area"],
  [/\bmaster bedroom\b/i, "master bedroom"],
  [/\b(all|both|two|three|four|\d) (?:of the )?bedrooms\b/i, "bedrooms"],
  [/\b(one|a|the|single) bedroom\b|\bbedroom\b/i, "bedroom"],
  [/\bwardrobes?\b/i, "wardrobes"],
  [/\bstudy\b|\bhome office\b|\bworkspace\b/i, "study / home office"],
  [/\bflooring\b/i, "flooring"],
  [/\bbathroom/i, "bathrooms"],
  [/\bworkstations?\b/i, "workstations"],
  [/\bcabins?\b/i, "cabins"],
  [/\bmeeting rooms?\b|\bboardroom\b|\bconference\b/i, "meeting room"],
  [/\breception\b/i, "reception"],
  [/\bbreak area\b|\bpantry\b|\bcafeteria\b|\blounge\b/i, "break area / pantry"],
];

export function extract(text: string, lastQuestion: QuestionKey | undefined, ref: Date, festivals: Record<string, string> = {}): Extraction {
  const t = text.toLowerCase().replace(/[’']/g, "'");
  const f: Partial<EnquiryFields> = {};
  const ev: Record<string, string> = {};
  const set = <K extends keyof EnquiryFields>(k: K, v: EnquiryFields[K], re: RegExp | string) => {
    f[k] = v;
    ev[k as string] = quote(text, re);
  };

  const affirmative = /^(yes|yeah|yep|sure|ok(ay)?|please|absolutely|definitely|of course|correct|that's right|haan|ha|ji|right|fine|perfect|sounds good|go ahead|book it)\b/.test(t.trim()) || /\b(yes,? please|let's (book|do) it|book (it|that|a consultation)|that works)\b/.test(t);
  const negative = /^(no|nope|not really|nah|not now|not yet)\b/.test(t.trim());
  const declinedToAnswer = /\b(rather not|prefer not|don't want to say|skip|not comfortable sharing|would not like to share|no comment)\b/.test(t);

  // ── Name ─────────────────────────────────────────────
  const nm = text.replace(/’/g, "'").match(/\b(?:[Mm]y name is|[Tt]his is|I'm|I am|[Ii]t's|[Nn]ame's)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  const notNames = /^(Calling|Looking|Planning|Just|Getting|In|From|The|A|Not|Doing|Opening|Interested|Sorry|Here|Fine|Okay|Good|Very)$/;
  if (nm && !notNames.test(nm[1].split(" ")[0])) set("callerName", nm[1], nm[1]);
  else if (lastQuestion === "name" && !declinedToAnswer && text.trim().split(/\s+/).length <= 4 && !/^(we|i|my|our|the|it|yes|no|hi|hello)\b/i.test(text.trim())) {
    const w = text.trim().replace(/^(it's|its|i'm|this is|my name is)\s+/i, "").match(/^([A-Za-z]+(?:\s+[A-Za-z]+)?)/);
    if (w && w[1].length > 1) set("callerName", cap(w[1].toLowerCase()), w[1]);
  }

  // ── Complaint / existing client ───────────────────────
  const complaintRe = /\b(my (current |ongoing )?project|my designer|existing (client|project)|hasn't replied|has not replied|haven't heard|not acceptable|unacceptable|complain|complaint|site (work )?(has )?stopped|work has stopped|nobody (is )?(responding|replying)|been going for \w+ months|speak to (nikhil|someone senior|a senior|the owner|your manager)|furious|very upset)\b/;
  const isComplaint = complaintRe.test(t) && !/\b(friend|recommended)\b/.test(t.match(complaintRe)?.[0] ?? "");
  if (isComplaint) set("complaint", true, complaintRe);

  // Missed commitment on a new enquiry (T16): "someone said they'd get back… two days"
  const missedRe = /\b(said (they'd|they would|someone would) (get back|call)|no one (got back|called back|replied)|nobody (got back|called)|still waiting|called (on )?\w+day[^.]*(no|nobody|never)|messaged \w+ days ago|didn't get a call back|never heard back)\b/;
  if (missedRe.test(t)) set("missedCommitment", true, missedRe);

  // ── Pricing question ─────────────────────────────────
  const isPricingQuestion =
    /\b(how much|what (would|will|might|does) (it|that|this) cost|cost me|rough(ly)? (cost|idea|range|ballpark|estimate)|ballpark|price list|your (\w+ )?(rates?|pricing|prices|charges|fees)|per (sq|square)\s*(ft|feet|foot)|what do you charge|how much do you charge|estimate|quotation|quote me|give me a (number|range|figure)|even a range|typical(ly)? cost|it's typically|what's the cost|pricing|times your)\b/.test(t) ||
    (!/\bbudget\b/.test(t) && /\b(cost|price|rate|lakh|per sq)\b[^.]*\?/.test(t));

  // ── Location ─────────────────────────────────────────
  // Ignore places describing someone else's project ("she had her flat done by you in Aundh").
  const ownText = text.split(/(?<=[.?!])\s+|\s+--\s+/).filter((x) => !/\b(friend|her flat|his flat|their flat|done by you|you did)\b/i.test(x)).join(" ");
  const loc = matchLocation(ownText);
  if (loc.location) set("location", loc.location, new RegExp(loc.location.split(" ")[0], "i"));
  if (loc.status) f.locationStatus = loc.status;
  if (!loc.location && (lastQuestion === "location" || lastQuestion === "location_confirm") && !declinedToAnswer) {
    if (lastQuestion === "location_confirm" && affirmative) { f.locationStatus = "in_area"; ev.locationStatus = text; }
    else if (lastQuestion === "location_confirm" && negative) { f.locationStatus = "out_of_area"; ev.locationStatus = text; }
    else {
      const raw = text.trim().replace(/^(it's|its|in|at|the property is in|it is in)\s+/i, "").replace(/[.?!]$/, "");
      // Only treat a short, place-like answer as a location ("Lohegaon", "Near Chakan").
      const placeLike = raw.split(/\s+/).length <= 4 && !/\d/.test(raw) && !/\b(we|i|my|our|like|want|need|done|by|yes|no|not|sure|sorry|it|the)\b/i.test(raw);
      if (placeLike && raw.length > 1) { set("location", cap(raw), raw); f.locationStatus = "unclear"; }
    }
  }

  // ── Project category / property type ──────────────────
  for (const [kw, why] of Object.entries(OUT_OF_SCOPE_PROJECT_TYPES)) {
    if (new RegExp(`\\b${kw}s?\\b`).test(t)) {
      set("outOfScopeType", kw, kw);
      f.projectCategory = "commercial";
      ev.outOfScopeReason = why;
    }
  }
  if (/\bretail\b|\bshop\b|\bstore\b/.test(t) && !/\bstorage\b/.test(t) && !f.outOfScopeType && /\b(open|opening|my|our|a)\s+(retail|shop|store)/.test(t)) {
    set("outOfScopeType", "retail store", /retail|shop|store/);
    f.projectCategory = "commercial";
  }
  const bhk = t.match(/\b(\d)\s*-?\s*bhk\b/);
  if (bhk) {
    const kind = /\bindependent house\b/.test(t) ? "independent house" : /\bvilla\b/.test(t) ? "villa" : "apartment";
    set("propertyType", `${bhk[1]}BHK ${kind}`, /bhk/i);
    f.projectCategory = "residential";
  } else if (/\bvilla\b/.test(t)) { set("propertyType", "villa", "villa"); f.projectCategory = "residential"; }
  else if (/\b(independent house|bungalow|row house)\b/.test(t)) { set("propertyType", "independent house", /independent house|bungalow|row house/); f.projectCategory = "residential"; }
  else if (/\b(flat|apartment|home|house)\b/.test(t) && !f.projectCategory && !/\bhome office\b/.test(t)) { f.projectCategory = "residential"; ev.projectCategory = quote(text, /flat|apartment|home|house/); }
  if (/\b(office|startup|fitout|fit-out|workstations|coworking|clinic|studio space|commercial)\b/.test(t) && !/\bhome office\b/.test(t) && !f.outOfScopeType) {
    const kind = /\bclinic\b/.test(t) ? "clinic" : /\bcoworking\b/.test(t) ? "coworking space" : "office";
    set("propertyType", kind, /office|startup|fitout|workstations|coworking|clinic|commercial/);
    f.projectCategory = "commercial";
  }

  // ── Carpet area ──────────────────────────────────────
  const area = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*(?:ft|feet|foot)|square\s*(?:feet|foot|ft)|sqft)/);
  if (area) set("carpetAreaSqft", Number(area[1].replace(/,/g, "")), area[0]);
  else if (lastQuestion === "property") {
    const n = t.match(/\b(\d{3,5})\b/);
    if (n) set("carpetAreaSqft", Number(n[1]), n[1]);
  }

  // ── Rooms ───────────────────────────────────────────
  const rooms = ROOM_PATTERNS.filter(([re]) => re.test(text)).map(([, r]) => r);
  const dedupRooms = rooms.filter((r) => !(r === "bedroom" && (rooms.includes("bedrooms") || rooms.includes("master bedroom"))));
  if (/\b(whole (thing|flat|house|home)|full home|entire (flat|home|house)|everything (in|at) (the|my|our) (home|flat|house)|all (the )?rooms|full (flat|house)|poora ghar|full interiors|complete redesign)\b/.test(t)) dedupRooms.push("full home");
  if (dedupRooms.length) set("rooms", Array.from(new Set(dedupRooms)), ROOM_PATTERNS.find(([re]) => re.test(text))?.[0] ?? /whole|full|entire|everything/);

  // ── Scope: design + execution vs advice ───────────────
  const failScope: [RegExp, ScopeType][] = [
    [/\b(execution myself|do the execution (myself|ourselves)|handle (the )?execution ourselves|only (the )?design\b(?! and)|just (the )?designs?( drawings)?\b(?! and)|design only)\b/, "design_only"],
    [/\b(ideas|suggestions|advice|advise|second opinion|consultation only|just (want )?(a )?consult)\b/, "advice_only"],
    [/\b(colou?rs?|rearrange|furniture arrangement|styling|decor(ate)?)\b(?![^.]*\b(execution|full redesign)\b)/, "styling_only"],
    [/\b(only|just) (source|sourcing|buy|procure)\w* furniture\b|\bfurniture sourcing\b/, "furniture_only"],
    [/\bvastu (consultation|advice|only)\b|\bjust vastu\b/, "vastu_only"],
    [/\b(move|break|knock down|remove) (a |the |some )?walls?\b|\bstructural (changes|work)\b|\badd (a|an) (floor|room)\b/, "structural"],
  ];
  const negatedFull = /\bnot (planning to |looking to )?(do )?(the )?full\b/.test(t);
  for (const [re, type] of failScope) {
    if (re.test(t)) {
      // "no structural changes" / "no wall-breaking" is the opposite of a structural request.
      if (type === "structural" && /\b(no|not|without|don't|won't)\b[^.]{0,25}(structural|walls?)/.test(t)) continue;
      if (type === "structural") { set("structuralRequest", true, re); continue; }
      set("scopeType", type, re);
      break;
    }
  }
  const strongExec = /\b(full redesign|complete redesign|redo the whole|redo (my|our|the) (whole|entire|flat|home|house)|end[- ]to[- ]end|full interiors|full execution|design and execution|design,? materials|full package|full fitout|fit ?out|fitout from scratch|from scratch|properly design|the whole thing|everything|interior design karwana|poora ghar|full home|design and fittings|modular kitchen)\b/;
  const weakExec = /\b(redo|redesign|renovate|do up|interiors?|design (the|my|our)|make (it|the \w+) look)\b/;
  if (!f.scopeType && !negatedFull) {
    if (strongExec.test(t) || (lastQuestion === "execution" && (affirmative || /\b(full|execution|both|all of it|everything)\b/.test(t)) && !/\b(just|only) (ideas|advice|design)\b/.test(t))) {
      set("scopeType", "design_and_execution", strongExec.test(t) ? strongExec : text);
      f.scopeSignal = "strong";
    } else if (weakExec.test(t)) {
      f.scopeSignal = "weak";
      ev.scopeSignal = quote(text, weakExec);
    }
  }
  if (negatedFull && !f.scopeType) set("scopeType", "advice_only", /not (planning to )?(do )?(the )?full/);
  if (/\b(just exploring|early stage|still exploring|just looking|just checking)\b/.test(t)) { f.earlyStage = true; ev.earlyStage = quote(text, /exploring|early stage|just looking|just checking/); }

  // ── Site condition ────────────────────────────────────
  const siteRe = /\b(bare shell|shell and core|new possession|just got possession|possession (was |is |in |next |on )?\w*|builder (flat|furniture|handover)|completely (empty|bare)|flat is empty|moved out temporarily|already moved out|lived here \w+ years|been here \w+ (years?|months?)|moved in \w+ (months?|years?) ago|we moved in|new construction|basic furniture|quite bare|still looks like the builder flat|living there|we live there|currently living)\b/;
  const site = t.match(siteRe);
  if (site) set("siteCondition", site[0].replace(/^\w/, (c) => c.toUpperCase()), siteRe);
  else if (lastQuestion === "site" && !declinedToAnswer && text.trim().length > 2) set("siteCondition", text.trim().slice(0, 120), text);
  if (/\b(rented|rental|on rent|lease|tenant|landlord)\b/.test(t)) set("rented", true, /rented|rental|on rent|lease|tenant|landlord/);

  // ── Timeline ──────────────────────────────────────────
  const tl = isComplaint ? {} as ReturnType<typeof parseTimeline> : parseTimeline(text, ref, festivals);
  if (tl.requiredBy) { set("requiredByDate", tl.requiredBy.toISOString().slice(0, 10), tl.matched ?? text); f.timelineText = quote(text, tl.matched ?? text); }
  if (tl.flexible) { set("timelineFlexible", true, /no rush|flexible|deadline|whenever|no hurry|plenty of time/); f.timelineText ??= quote(text, /no rush|flexible|deadline|whenever|no hurry|plenty of time/); }
  if (tl.startText) f.startText = tl.startText;
  if (tl.siteAvailableInWeeks !== undefined) set("siteAvailableInWeeks", Math.round(tl.siteAvailableInWeeks * 10) / 10, /possession|empty|bare shell|moved out|go now|ready/);
  if (tl.asap && !tl.requiredBy) f.startText = f.startText ?? "as soon as possible";
  if (lastQuestion === "timeline" && !tl.requiredBy && !tl.flexible && /\b(not sure|don't know|no idea|haven't decided|depends)\b/.test(t)) {
    set("timelineFlexible", true, text); // no fixed deadline given when asked directly
  }

  // ── Budget (only if volunteered — never asked) ─────────
  const lakh = t.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(?:(?:to|-|–|or)\s*(\d+(?:\.\d+)?))?\s*(lakh|lakhs|lac|lacs|l\b|crore|cr\b)/);
  if (lakh && !isPricingQuestion && /\b(budget|spend|afford|maximum|max|all-in|can do|is that possible|we have|i have)\b|₹|rs/.test(t)) {
    const unit = /cr/.test(lakh[3]) ? 10_000_000 : 100_000;
    const hi = Number(lakh[2] ?? lakh[1]) * unit;
    set("budgetMaxInr", hi, lakh[0]);
    f.budgetText = quote(text, lakh[0]);
  } else if (/\bbudget\b/.test(t) && /\b(not sure|prefer not|will discuss|discuss at|bhi hai|is there|have a budget|we have budget|flexible)\b/.test(t)) {
    set("budgetMentionedNoFigure", true, /budget/);
    f.budgetText = quote(text, /budget/);
  }

  // ── Decision-maker ────────────────────────────────────
  const dm: [RegExp, DecisionMaker][] = [
    [/\b(just|only) (doing |checking |calling for )?(some )?(initial )?(research|checking) for (my )?(in-laws|parents|boss|friend|relative|uncle|aunt)\b(?![^.]*\b(authori[sz]ed|asked me to go ahead|told me to book)\b)|\bi can't decide\b|\bnot (my|the) decision\b|\bthey haven't decided (whether|if)\b|\bnot authori[sz]ed\b/, "not_authorised"],
    [/\b(authori[sz]ed|asked me to (go ahead|book|proceed)|told me to (go ahead|book)|said to go ahead|happy to go ahead|knows we're calling|on (his|her|their) behalf)\b/, "authorised_representative"],
    [/\b(my parents|my in-laws|for my (mother|father|mom|dad))\b[^.]*\b(they('ll| will)? (come|attend|decide)|would come|will be at)\b|\bthey would come\b|\bthey('ll| will) decide\b/, "representing_attending"],
    [/\b(myself and my (husband|wife|partner)|my (husband|wife|partner) and i|we both|both of us|both my (wife|husband) and i)\b/, "joint_owner_confirmed"],
    [/\b(i'm|i am) the (owner|founder|decision[- ]maker|ceo|director|md|proprietor)\b|\bi (own|decide|make the decision)\b|\bmy (own )?(flat|home|house|villa|office|company)\b|\bi'm the one deciding\b|\bit's my decision\b|\bours\b/, "self"],
  ];
  for (const [re, val] of dm) {
    if (re.test(t)) {
      // "My husband and I" when the husband "is happy to go ahead" → joint owner confirmed.
      const v = val === "authorised_representative" && /\b(husband|wife|partner|spouse)\b/.test(t) ? "joint_owner_confirmed" : val;
      set("decisionMaker", v, re);
      f.decisionText = quote(text, re);
      break;
    }
  }
  if (!f.decisionMaker && lastQuestion === "decision") {
    if (/\b(me|myself|i will|i'll|i do|i am|i'm)\b/.test(t) || affirmative) { set("decisionMaker", "self", text); f.decisionText = text.trim(); }
    else if (/\b(wife|husband|partner|spouse|we)\b/.test(t)) { set("decisionMaker", "joint_owner_confirmed", text); f.decisionText = text.trim(); }
  }
  if (/\b(operations head|head of|manager|admin)\b/.test(t) && !f.decisionMaker && f.projectCategory === "commercial") {
    set("decisionMaker", "authorised_representative", /operations head|head of|manager|admin/);
    f.decisionText = quote(text, /operations head|head of|manager|admin/);
  }

  // ── Referral ──────────────────────────────────────────
  const ref1 = text.match(/\b(?:got your number from|recommended by|referred by|asked me to (?:call|message))\s+(?:a friend\s*(?:--|—|-)?\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (ref1) set("referralSource", `Referral — ${ref1[1]}`, ref1[0]);
  else if (/\b([A-Z][a-z]+ [A-Z][a-z]+) asked me to call\b/.test(text)) {
    const m = text.match(/\b([A-Z][a-z]+ [A-Z][a-z]+) asked me to call\b/)!;
    set("referralSource", `Referral — ${m[1]}`, m[0]);
  } else {
    const src = t.match(/\b(instagram|linkedin|google|facebook|youtube|pune mirror|justdial|houzz|a friend|friend|builder|website)\b/);
    if (src && /\b(saw|found|heard|from|on|via|through|looking at|referred|recommend)\b/.test(t)) set("referralSource", cap(src[1]), src[0]);
  }

  // ── Consultation ─────────────────────────────────────
  if (lastQuestion === "consultation" || /\b(book (a|the)? ?consultation|set up a consultation|schedule a (consultation|site visit)|site visit)\b/.test(t)) {
    if (affirmative || /\b(book|schedule|set (it )?up|please do|let's)\b/.test(t)) {
      f.consultationRequested = true;
      ev.consultationRequested = quote(text, /book|schedule|yes|please|let's|sure/);
      const slot = text.match(/\b((?:this|next) week(?:end)?|weekdays?(?: after \d+ ?(?:pm|am))?|weekends?|(?:mon|tues|wednes|thurs|fri|satur|sun)day(?: (?:morning|afternoon|evening))?|mornings?|evenings?|after \d+ ?(?:pm|am))\b[^.?!]*/i);
      if (slot) f.preferredSlot = slot[0].trim();
    } else if (negative) f.consultationRequested = false;
  }
  if (lastQuestion === "contact" && (affirmative || /\d{6,}/.test(t))) { f.phoneConfirmed = true; ev.phoneConfirmed = text; }
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (email) f.email = email[0];

  if (lastQuestion === "complaint_details" && !f.complaintDetails) f.complaintDetails = text.trim().slice(0, 300);

  return { fields: f, evidence: ev, isPricingQuestion, isComplaint, declinedToAnswer, affirmative, negative };
}
