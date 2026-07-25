import { AppShell } from "../components/AppShell";
import { LaunchWizard } from "./LaunchWizard";

export default function LaunchPage() {
  return (
    <AppShell>
      <section className="launch-page-head section-frame">
        <div>
          <p className="eyebrow"><span /> HoodiePad launch studio</p>
          <h1>Make a market.</h1>
        </div>
        <p>Seven creator inputs. Every protocol choice fixed and disclosed.</p>
      </section>
      <section className="launch-shell section-frame">
        <LaunchWizard />
      </section>
    </AppShell>
  );
}

