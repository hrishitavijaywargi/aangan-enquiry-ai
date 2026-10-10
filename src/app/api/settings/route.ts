import { handler } from "@/lib/api";
import { getSettings, resetSettings, updateSettings } from "@/lib/settings";
import { systemStatus } from "@/lib/status";

export const dynamic = "force-dynamic";
export const GET = handler(async () => ({ settings: await getSettings(), status: await systemStatus() }));
export const PUT = handler(async (req: Request) => ({ settings: await updateSettings(await req.json()) }));
export const DELETE = handler(async () => {
  await resetSettings();
  return { settings: await getSettings() };
});
