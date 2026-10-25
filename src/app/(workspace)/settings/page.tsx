import WorkspacePlaceholder from "@/components/workspace-placeholder";
import AccountDataTools from "@/components/account-data-tools";
import { getAppMode } from "@/lib/cloud/security";

export default function SettingsPage() {
  if (getAppMode() === "firebase")
    return (
      <section className="placeholder-page" aria-labelledby="settings-title">
        <p className="eyebrow">YOUR WORKSPACE</p>
        <h1 id="settings-title">Account &amp; saved data</h1>
        <AccountDataTools />
      </section>
    );
  return <WorkspacePlaceholder eyebrow="PREFERENCES" title="Settings" />;
}
