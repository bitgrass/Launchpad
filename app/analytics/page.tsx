import { AnalyticsDashboard } from "../components/AnalyticsDashboard";
import { AppShell } from "../components/AppShell";
import { readProtocolAnalytics } from "../lib/analytics";

export const revalidate = 0;

async function loadAnalytics() {
  try {
    return await readProtocolAnalytics();
  } catch {
    return null;
  }
}

export default async function AnalyticsPage() {
  const analytics = await loadAnalytics();
  return (
    <AppShell>
      {analytics ? (
        <AnalyticsDashboard initialAnalytics={analytics} />
      ) : (
        <section className="page-hero section-frame compact-hero">
          <p className="eyebrow"><span /> Robinhood onchain reporting</p>
          <h1>Analytics unavailable.</h1>
          <p>HoodiePad could not read the live event registry. Try again shortly.</p>
        </section>
      )}
    </AppShell>
  );
}
