/** `npm run reset-demo` — wipe the local database and re-create the demo data from the scenarios. */
import { resetDemoData } from "../src/lib/seed/seed";
import { dashboard } from "../src/lib/data";

resetDemoData().then(() => {
  const m = dashboard({});
  console.log(`Demo data reset: ${m.total} enquiries (${m.calls} calls), ${m.qualified} qualified, ${m.notQualified} not qualified, ${m.awaiting} awaiting info, ${m.escalated} escalated.`);
});
