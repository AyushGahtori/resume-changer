import Link from "next/link";

export default function Home() {
  return (
    <main className="workspace">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="Resume Changer home">
          <span className="wordmark-mark" aria-hidden="true">
            R
          </span>
          <span>Resume Changer</span>
        </Link>
        <span className="local-status">
          <span aria-hidden="true" />
          Local workspace
        </span>
      </header>

      <section className="welcome" aria-labelledby="welcome-heading">
        <p className="eyebrow">RESUME WORKSPACE</p>
        <h1 id="welcome-heading">A better fit, built from your experience.</h1>
        <p className="welcome-copy">
          Bring a job description and your achievement library together to
          prepare a focused, truthful resume.
        </p>
        <div className="setup-state" role="status">
          <span className="setup-icon" aria-hidden="true">
            +
          </span>
          <div>
            <p className="setup-title">Your workspace is ready</p>
            <p className="setup-copy">
              The resume workflow will take shape here, one step at a time.
            </p>
          </div>
        </div>
      </section>

      <footer className="workspace-footer">
        Local-first by design <span aria-hidden="true">·</span> Your resume data
        stays on this device
      </footer>
    </main>
  );
}
