import { AppShell } from "../components/AppShell";
import { KingOfTheHood } from "../components/KingOfTheHood";
import { LeaderboardTables } from "../components/LeaderboardTables";
import { readDisplayPrices } from "../lib/display-prices";
import { readCrownState } from "../lib/king";
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
  const crown = await readCrownState(launches, prices.hoodieUsd).catch(() => null);
  const traders = buildTraderLeaderboard(launches);
  const creators = buildCreatorLeaderboard(launches);

  return (
    <AppShell>
      <section className="section-frame">
        <div className="leaderboard-banner">
          <div className="leaderboard-banner-copy">
            <p className="eyebrow"><span /> HoodiePad&apos;s highest distinction</p>
            <h1>Trade. Climb.<br />Own the hood.</h1>
            <p>
              Real wallets. Real PnL. On-chain verified. Ranks belong to
              whoever earns them — never curated, never sold, and they can be
              taken at any moment.
            </p>
            <div className="leaderboard-banner-facts">
              <span><strong>{traders.length}</strong> ranked wallets</span>
              <span><strong>{creators.length}</strong> creators earning</span>
              <span><strong>{launches.length}</strong> live markets</span>
            </div>
          </div>
          <div className="leaderboard-banner-art" aria-hidden="true">
            <span className="banner-crown">👑</span>
            <span className="banner-glow" />
          </div>
        </div>
      </section>
      {crown && <KingOfTheHood initial={{ ...crown, hoodieUsd: prices.hoodieUsd }} />}
      <LeaderboardTables
        initial={{
          traders: traders.slice(0, 50),
          creators: creators.slice(0, 50),
          hoodieUsd: prices.hoodieUsd,
          weights: { ...TRADER_SCORE_WEIGHTS },
        }}
      />
    </AppShell>
  );
}
