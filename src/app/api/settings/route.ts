import { handler } from "@/lib/api";
import { getSettings, resetSettings, updateSettings } from "@/lib/settings";
import { systemStatus } from "@/lib/status";

export const dynamic = "force-dynamic";
export const GET = handler(async () => ({ settings: getSettings(), status: systemStatus() }));
export const PUT = handler(async (req: Request) => ({ settings: updateSettings(await req.json()) }));
export const DELETE = handler(async () => {
  resetSettings();
  return { settings: getSettings() };
});
