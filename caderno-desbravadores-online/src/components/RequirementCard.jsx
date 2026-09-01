export default function RequirementCard({ number, text, status = "Não iniciado" }) {
  const statusClass = {
    "Não iniciado": "status-gray",
    "Aguardando liderança": "status-yellow",
    "Aprovado": "status-green",
    "Devolvido": "status-red"
  }[status];

  return (
    <article className="requirement">
      <div className="req-number">{number}</div>
      <div className="req-content">
        <h3>{text}</h3>
        <div className={`status ${statusClass}`}>{status}</div>

        <div className="evidence">
          <div>
            <strong>Data da realização</strong>
            <span>—</span>
          </div>
          <div>
            <strong>Comprovação</strong>
            <span className="muted">Nenhum arquivo enviado</span>
          </div>
          <div>
            <strong>Observação</strong>
            <span className="muted">Nenhuma observação registrada</span>
          </div>
        </div>
      </div>
    </article>
  );
}