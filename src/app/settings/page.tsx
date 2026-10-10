import SettingsForm from "@/components/SettingsForm";
import { PageHeader } from "@/components/ui";
import { ready } from "@/lib/ready";
import { getSettings } from "@/lib/settings";
import { systemStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await ready();
  return (
    <div>
      <PageHeader title="Settings" description="Integration status, cost assumptions and demo data controls." />
      <SettingsForm initial={await getSettings()} status={await systemStatus()} />
    </div>
  );
}
