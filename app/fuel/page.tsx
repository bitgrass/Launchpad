import { AppShell } from "../components/AppShell";
import { FuelDashboard } from "../components/FuelDashboard";
import { readFuelSnapshot } from "../lib/fuel";

export const revalidate = 0;

export default async function FuelPage() {
  const snapshot = await readFuelSnapshot().catch(() => null);

  return (
    <AppShell>
      <section className="page-hero section-frame explore-hero">
        <p className="eyebrow"><span /> Live, on-chain, independently verifiable</p>
        <h1>HOODIE Fuel.</h1>
        <p>
          Every HoodiePad market is paired with HOODIE, so every trade routes
          through it. Here is exactly where the volume and the fees go.
        </p>
      </section>
      {snapshot ? (
        <FuelDashboard initial={snapshot} />
      ) : (
        <section className="section-frame">
          <div className="live-empty-state is-error">
            <strong>Fee transparency data is temporarily unavailable.</strong>
            <p>HoodiePad could not read the live registry. Try again shortly.</p>
          </div>
        </section>
      )}
    </AppShell>
  );
}
