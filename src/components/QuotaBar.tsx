interface QuotaBarProps {
  used: number;
  limit: number;
  label: string;
}

export function QuotaBar({ used, limit, label }: QuotaBarProps) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const color = pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#10b981';

  return (
    <div className="quota-bar-container">
      <div className="quota-header">
        <span className="quota-label">{label}</span>
        <span className="quota-values">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="quota-track">
        <div className="quota-fill" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="quota-pct">{pct.toFixed(1)}% used</div>
    </div>
  );
}
