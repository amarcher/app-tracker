interface Props {
  scope?: string;
  unpricedRequests?: number;
  unpricedUsage?: Array<{ service: string; model: string | null; requests: number }>;
}

export function formatEstimatedCost(usd: number, requests: number, unpricedRequests = 0): string {
  if (requests > 0 && unpricedRequests >= requests) return 'Unpriced';
  const value = `$${usd.toFixed(usd < 0.01 ? 4 : usd < 1 ? 3 : 2)}`;
  return unpricedRequests > 0 ? `${value} + unpriced` : value;
}

export function CostCoverage({ scope, unpricedRequests = 0, unpricedUsage = [] }: Props) {
  return (
    <div className="section-note">
      <p>{scope ?? 'Logged API usage only; estimates do not include unlogged activity or the separate ElevenLabs account usage.'}</p>
      {unpricedRequests > 0 && <p role="status">{unpricedRequests.toLocaleString()} logged requests have no supported price and are excluded from the estimate.</p>}
      {unpricedUsage.length > 0 && <ul>{unpricedUsage.map(u => <li key={`${u.service}:${u.model}`}>{u.service} / {u.model ?? 'unspecified model'}: {u.requests.toLocaleString()} unpriced requests</li>)}</ul>}
    </div>
  );
}
