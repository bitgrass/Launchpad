import { AppShell } from "../components/AppShell";
import { LeaderboardTables } from "../components/LeaderboardTables";
import { readDisplayPrices } from "../lib/display-prices";
import { readHoodiePadLaunches } from "../lib/launches";
import {
  buildCreatorLeaderboard,
  buildTraderLeaderboard,
  TRADER_SCORE_WEIGHTS,
} from "../lib/leaderboard";

export const revalidate = 0;

export default async function LeaderboardPage() {
  const [launches, prices] = await Promise.all([
    readHoodiePadLaunches().catch(() => []),
    readDisplayPrices().catch(() => ({ ethUsd: null, hoodieUsd: null })),
  ]);

  return (
    <AppShell>
      <section className="page-hero section-frame explore-hero">
        <p className="eyebrow"><span /> Real wallets · real PnL · on-chain verified</p>
        <h1>Trade. Climb. Own the hood.</h1>
        <p>
          Every rank is derived from canonical Robinhood Chain swap events —
          never curated, never sold.
        </p>
      </section>
      <LeaderboardTables
        initial={{
          traders: buildTraderLeaderboard(launches).slice(0, 50),
          creators: buildCreatorLeaderboard(launches).slice(0, 50),
          hoodieUsd: prices.hoodieUsd,
          weights: { ...TRADER_SCORE_WEIGHTS },
        }}
      />
    </AppShell>
  );
}
