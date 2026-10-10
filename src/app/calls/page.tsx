import CallSimulator from "@/components/CallSimulator";
import { PageHeader } from "@/components/ui";
import { ready } from "@/lib/ready";
import { SCENARIOS } from "@/lib/seed/scenarios";
import { maskPhone } from "@/lib/service";
import { telephonyStatus } from "@/lib/telephony";

export const dynamic = "force-dynamic";

export default async function CallsPage() {
  await ready();
  const scenarios = SCENARIOS.map((s) => ({ key: s.key, label: s.label, source: s.source, rubricTag: s.rubricTag ?? null, adapted: s.adapted ?? null, phoneMasked: maskPhone(s.phone) }));
  return (
    <div>
      <PageHeader
        title="Incoming call simulator"
        description={`${telephonyStatus().message} The call runs through the same workflow a real call would: ring → AI answers → questions → qualification → handoff.`}
      />
      <CallSimulator scenarios={scenarios} />
    </div>
  );
}
