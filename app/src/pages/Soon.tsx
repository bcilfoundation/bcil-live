export default function Soon({ title }: { title: string }) {
  return (
    <section className="view">
      <h1>{title}</h1>
      <div className="empty"><b>Coming in the next build</b>This screen is designed in the prototype and is next on the list.</div>
    </section>
  );
}
