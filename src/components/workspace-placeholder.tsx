export default function WorkspacePlaceholder({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="placeholder-page" aria-labelledby="placeholder-title">
      <p className="eyebrow">{eyebrow}</p>
      <h1 id="placeholder-title">{title}</h1>
      <div className="placeholder-state" role="status">
        <span className="placeholder-mark" aria-hidden="true">
          ···
        </span>
        <p>Available in a later step</p>
      </div>
    </section>
  );
}
