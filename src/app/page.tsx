import Dashboard from "@/components/Dashboard";
import { dashboard } from "@/lib/data";
import { ready } from "@/lib/ready";

export const dynamic = "force-dynamic";

export default async function Page() {
  await ready();
  return <Dashboard initial={await dashboard({})} />;
}
