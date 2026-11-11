"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/cloud/api-fetch";
import type { Profile } from "@/lib/schemas/resume-data";

type LinkDraft = {
  key: string;
  label: string;
  url: string;
};

const maxLinks = 12;

function contactKey(profile: Profile) {
  return JSON.stringify({
    fullName: profile.fullName,
    headline: profile.headline ?? null,
    email: profile.email ?? null,
    phone: profile.phone ?? null,
    location: profile.location ?? null,
    summary: profile.summary ?? null,
    links: profile.links,
  });
}

function draftLinks(profile: Profile): LinkDraft[] {
  return profile.links.map((link) => ({
    key: crypto.randomUUID(),
    label: link.label,
    url: link.url,
  }));
}

export default function ProfileEditor({
  profile,
  onSaved,
}: {
  profile: Profile;
  onSaved: () => void;
}) {
  const loadedKey = contactKey(profile);
  const [seenKey, setSeenKey] = useState(loadedKey);
  const [fullName, setFullName] = useState(profile.fullName);
  const [email, setEmail] = useState(profile.email ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [location, setLocation] = useState(profile.location ?? "");
  const [headline, setHeadline] = useState(profile.headline ?? "");
  const [summary, setSummary] = useState(profile.summary ?? "");
  const [links, setLinks] = useState<LinkDraft[]>(() => draftLinks(profile));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (seenKey !== loadedKey) {
    setSeenKey(loadedKey);
    setFullName(profile.fullName);
    setEmail(profile.email ?? "");
    setPhone(profile.phone ?? "");
    setLocation(profile.location ?? "");
    setHeadline(profile.headline ?? "");
    setSummary(profile.summary ?? "");
    setLinks(draftLinks(profile));
    setError("");
  }

  const previewLinks = links.flatMap((link) => {
    const label = link.label.trim();
    const url = link.url.trim();
    if (!label || !url) return [];
    return [{ label, url }];
  });
  const preview = [
    fullName.trim(),
    ...previewLinks.map((link) => `${link.label} ${link.url}`),
  ]
    .filter((part) => part.length > 0)
    .join(" | ");

  function updateLink(key: string, field: "label" | "url", value: string) {
    setLinks((current) =>
      current.map((link) =>
        link.key === key ? { ...link, [field]: value } : link,
      ),
    );
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    const payload = {
      fullName,
      headline,
      email,
      phone,
      location,
      summary,
      links: links
        .map(({ label, url }) => ({ label, url }))
        .filter(
          (link) => link.label.trim().length > 0 || link.url.trim().length > 0,
        ),
    };
    try {
      const response = await apiFetch("/api/library/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setError(result?.error || "Could not save this change. Try again.");
        return;
      }
      onSaved();
    } catch {
      setError("Could not save this change. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <form aria-label="Profile and contact" onSubmit={save}>
        <label className="editor-field">
          <span>Preferred name</span>
          <input
            autoComplete="name"
            name="fullName"
            onChange={(event) => setFullName(event.target.value)}
            required
            value={fullName}
          />
        </label>
        <label className="editor-field">
          <span>Professional email</span>
          <input
            autoComplete="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
        </label>
        <label className="editor-field">
          <span>Phone</span>
          <input
            autoComplete="tel"
            name="phone"
            onChange={(event) => setPhone(event.target.value)}
            type="tel"
            value={phone}
          />
        </label>
        <label className="editor-field">
          <span>Location</span>
          <input
            autoComplete="address-level2"
            name="location"
            onChange={(event) => setLocation(event.target.value)}
            value={location}
          />
        </label>
        <label className="editor-field">
          <span>Headline</span>
          <input
            name="headline"
            onChange={(event) => setHeadline(event.target.value)}
            value={headline}
          />
        </label>
        <label className="editor-field">
          <span>Summary</span>
          <textarea
            name="summary"
            onChange={(event) => setSummary(event.target.value)}
            rows={4}
            value={summary}
          />
        </label>
        <div>
          <p id="profile-links-label">Links</p>
          <div aria-labelledby="profile-links-label" role="group">
            {links.map((link, index) => (
              <div key={link.key}>
                <label className="editor-field">
                  <span>{`Link ${index + 1} label`}</span>
                  <input
                    onChange={(event) =>
                      updateLink(link.key, "label", event.target.value)
                    }
                    value={link.label}
                  />
                </label>
                <label className="editor-field">
                  <span>{`Link ${index + 1} URL`}</span>
                  <input
                    inputMode="url"
                    onChange={(event) =>
                      updateLink(link.key, "url", event.target.value)
                    }
                    value={link.url}
                  />
                </label>
                <button
                  aria-label={`Remove link ${index + 1}`}
                  className="ui-button ui-button--secondary"
                  disabled={saving}
                  onClick={() =>
                    setLinks((current) =>
                      current.filter((item) => item.key !== link.key),
                    )
                  }
                  type="button"
                >
                  Remove link
                </button>
              </div>
            ))}
          </div>
        </div>
        {error ? (
          <p className="editor-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="library-edit-actions">
          <button
            className="ui-button ui-button--secondary"
            disabled={saving || links.length >= maxLinks}
            onClick={() =>
              setLinks((current) =>
                current.length >= maxLinks
                  ? current
                  : [
                      ...current,
                      { key: crypto.randomUUID(), label: "", url: "" },
                    ],
              )
            }
            type="button"
          >
            Add link
          </button>
          <button
            className="ui-button ui-button--primary"
            disabled={saving}
            type="submit"
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
      <section aria-label="Header preview">
        <p>{preview}</p>
      </section>
    </div>
  );
}
