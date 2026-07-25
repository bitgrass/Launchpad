import { AppShell } from "../components/AppShell";
import { DashboardMarkets } from "../components/DashboardMarkets";
import {
  readHoodiePadLaunches,
  summarizeHoodiePadLaunches,
} from "../lib/launches";

export const revalidate = 0;

export default async function DashboardPage() {
  const launches = await readHoodiePadLaunches().catch(() => []);
  const markets = summarizeHoodiePadLaunches(launches);

  return (
    <AppShell>
      <section className="page-hero section-frame compact-hero">
        <p className="eyebrow"><span /> Creator command center</p>
        <h1>Your hood, your markets.</h1>
        <p>Connect the fee-recipient wallet used at launch to see its real onchain markets.</p>
      </section>
      <DashboardMarkets markets={markets} />
    </AppShell>
  );
}
