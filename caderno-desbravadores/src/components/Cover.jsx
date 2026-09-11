export default function Cover({ scout }) {
  return (
    <section className="cover">
      <div className="cover-title">
        <div className="eyebrow">CLUBE DE DESBRAVADORES</div>
        <h1>CADERNO DE CLASSES</h1>
      </div>

      <div className="identity">
        <div><strong>Nome:</strong><span>{scout.name}</span></div>
        <div><strong>Nascimento:</strong><span>{scout.birth || '—'}</span></div>
        <div><strong>Clube:</strong><span>{scout.club || '—'}</span></div>
        <div><strong>Unidade:</strong><span>{scout.unit || '—'}</span></div>
      </div>
    </section>
  );
}
