import { AppShell } from "../components/AppShell";
import { ExploreMarkets } from "../components/ExploreMarkets";
import {
  readHoodiePadLaunches,
  summarizeHoodiePadLaunches,
} from "../lib/launches";

export const revalidate = 0;

async function readRegistry() {
  try {
    return { launches: await readHoodiePadLaunches(), registryError: "" };
  } catch {
    return {
      launches: [],
      registryError: "Live Robinhood market discovery is temporarily unavailable.",
    };
  }
}

export default async function ExplorePage() {
  const { launches, registryError } = await readRegistry();
  const markets = summarizeHoodiePadLaunches(launches);

  return (
    <AppShell>
      <section className="page-hero section-frame compact-hero">
        <p className="eyebrow"><span /> Canonical V4 CHILD / HOODIE markets</p>
        <h1>Find your next hood.</h1>
        <p>Every market below is discovered and validated directly from Robinhood Chain.</p>
      </section>
      {registryError ? (
        <section className="section-frame">
          <div className="live-empty-state is-error">
            <strong>Could not read the live market registry.</strong>
            <p>{registryError}</p>
          </div>
        </section>
      ) : (
        <ExploreMarkets markets={markets} />
      )}
    </AppShell>
  );
}
