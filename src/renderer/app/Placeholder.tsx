// Simple placeholder for dashboard sections that later phases implement.
export function Placeholder({ title, phase, blurb }: { title: string; phase: string; blurb: string }) {
  return (
    <div className="section-body">
      <h1 className="section-title">{title}</h1>
      <p className="section-lede">{blurb}</p>
      <span className="phase-pill">Arrives in {phase}</span>
    </div>
  );
}
