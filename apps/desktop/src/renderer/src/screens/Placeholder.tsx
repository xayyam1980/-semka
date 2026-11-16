export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <section>
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="text-muted">Ten ekran powstanie w etapie {phase}.</p>
    </section>
  );
}
