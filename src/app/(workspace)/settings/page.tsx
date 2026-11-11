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
  return (
    <section className="placeholder-page" aria-labelledby="settings-title">
      <p className="eyebrow">PREFERENCES</p>
      <h1 id="settings-title">Settings</h1>
      <p className="page-intro">
        Your library, saved analyses, and resume history stay on this device.
        Use the theme toggle in the top bar to switch between light and dark.
      </p>
    </section>
  );
}
