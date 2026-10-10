import { handler } from "@/lib/api";
import { SCENARIOS } from "@/lib/seed/scenarios";
import { maskPhone } from "@/lib/service";

export const GET = handler(async () =>
  SCENARIOS.map((s) => ({ key: s.key, label: s.label, source: s.source, rubricTag: s.rubricTag ?? null, adapted: s.adapted ?? null, phoneMasked: maskPhone(s.phone), hangUpAfterTurns: s.hangUpAfterTurns ?? null })),
);
