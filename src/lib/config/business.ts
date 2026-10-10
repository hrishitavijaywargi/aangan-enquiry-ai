/**
 * Business rules extracted from the supplied source files.
 * Every value cites where it came from. Values marked ASSUMPTION are
 * not stated in the source files and should be confirmed with Nikhil.
 */

/** services.md → "Service area" (Pune city list). */
export const PUNE_CITY_AREAS = [
  "kothrud", "baner", "aundh", "wakad", "koregaon park", "kalyani nagar", "viman nagar",
  "hadapsar", "magarpatta", "nibm", "kondhwa", "undri", "shivane", "warje", "erandwane", "deccan",
];

/** services.md → "Service area" (PCMC list). */
export const PCMC_AREAS = [
  "pimpri", "chinchwad", "pimple saudagar", "pimple nilakh", "ravet", "hinjewadi",
];

/**
 * ASSUMPTION: services.md says "and adjoining areas" for Pune city.
 * These are well-known PMC/PCMC localities (several appear in the Sep 2026
 * transcripts, e.g. Kharadi T10, Nanded City T08, Sunderban/Aundh W09).
 * Confirm the list with Nikhil.
 */
export const ADJOINING_AREAS = [
  "kharadi", "nanded city", "bavdhan", "pashan", "shivajinagar", "sadashiv peth", "swargate",
  "bibwewadi", "katraj", "dhanori", "yerawada", "vishrantwadi", "sinhagad road", "balewadi",
  "sangvi", "akurdi", "nigdi", "bhosari", "moshi", "tathawade", "punawale", "kalewadi", "thergaon",
  "dahanukar colony", "cybercity", "sunderban", "camp", "model colony", "prabhat road",
];

/** services.md → "We do not currently serve Talegaon, Lonavala, Nashik, Mumbai, or other cities". */
export const OUT_OF_AREA = [
  "talegaon", "lonavala", "nashik", "mumbai", "thane", "navi mumbai", "satara", "kolhapur",
  "nagpur", "aurangabad", "sambhajinagar", "bangalore", "bengaluru", "hyderabad", "delhi", "goa",
  "chennai", "ahmedabad", "indore", "solapur", "ahmednagar", "chakan", "shirur", "baramati",
];

/** services.md → "Restaurants, hotels, retail stores, gyms: out of scope." */
export const OUT_OF_SCOPE_PROJECT_TYPES: Record<string, string> = {
  restaurant: "Restaurants are outside our scope (services.md).",
  cafe: "Cafés/restaurants are outside our scope (services.md).",
  hotel: "Hotels and hospitality are outside our scope (services.md).",
  "retail store": "Retail stores are outside our scope (services.md).",
  showroom: "Retail/showroom spaces are outside our scope (services.md).",
  gym: "Gyms are outside our scope (services.md).",
};

/** services.md → Timelines. qualified.md → criterion 3. */
export const TIMELINE_RULES = {
  designWeeksMin: 3, // services.md: design phase 3–4 weeks
  designWeeksMax: 4,
  executionWeeksMin: 8, // services.md: execution 8–16 weeks
  executionWeeksMax: 16,
  minLeadWeeks: 6, // services.md: cannot begin a project that must be ready in < 6 weeks
  maxSiteAvailabilityWeeks: 10, // qualified.md: site available for execution within 8–10 weeks of consultation
};

/** services.md → "Office: up to ~3,000 sq ft". */
export const COMMERCIAL_MAX_SQFT = 3000;
/** "~" in services.md → small tolerance before treating as a fail. ASSUMPTION: 10%. */
export const COMMERCIAL_MAX_TOLERANCE = 0.1;
/**
 * ASSUMPTION from front-desk practice in transcript T18 ("Our commercial projects are
 * typically 500 sq ft or more"). Not stated in services.md — confirm with Nikhil.
 */
export const COMMERCIAL_MIN_SQFT = 500;

/** pricing.md → the ONLY acceptable response to a pricing question (verbatim). */
export const PRICING_SCRIPT =
  "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.";

/** qualified.md → "At the boundary" decline line (verbatim). */
export const DECLINE_LINE =
  "This sounds like it may not be the right fit for us right now — but feel free to reach out if your timeline or scope changes.";

/** Problem statement: front desk 10am–7pm. Transcripts show calls answered on Saturdays (T11 12 Sep, T16 19 Sep); W05 says closed Sundays. */
export const DEFAULT_OFFICE_HOURS = { startHour: 10, endHour: 19, workingDays: [1, 2, 3, 4, 5, 6] };
