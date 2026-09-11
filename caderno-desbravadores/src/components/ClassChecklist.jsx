export default function ClassChecklist({ item }) {
  const done = item.done;
  const total = item.total;

  return (
    <div className="check-card" style={{ "--class-color": item.color, "--class-light": item.light }}>
      <div className="check-head">
        <div>
          <span className="check-name">{item.name}</span>
          <span className="check-percent">{done}/{total} — {Math.round((done / total) * 100)}%</span>
        </div>
        <span className="check-badge">●</span>
      </div>

      <div className="check-grid" aria-label={`Checklist ${item.name}`}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i < done ? "check-dot done" : "check-dot"}>
            {i + 1}
          </span>
        ))}
      </div>

      <div className="progress">
        <span style={{ width: `${(done / total) * 100}%` }} />
      </div>
    </div>
  );
}