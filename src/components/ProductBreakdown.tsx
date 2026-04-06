interface ProductBreakdownProps {
  data: Record<string, number>;
}

const PRODUCT_COLORS: Record<string, string> = {
  'TTS': '#f59e0b',
  'Conversational AI': '#6366f1',
  'Conversational AI - LLM': '#8b5cf6',
  'Sound Effects': '#06b6d4',
  'Voice Changer': '#10b981',
};

export function ProductBreakdown({ data }: ProductBreakdownProps) {
  const entries = Object.entries(data)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Characters</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([product, chars]) => (
            <tr key={product}>
              <td>
                <span
                  className="product-dot"
                  style={{ backgroundColor: PRODUCT_COLORS[product] || '#64748b' }}
                />
                {product}
              </td>
              <td>{chars.toLocaleString()}</td>
              <td className="source-medium">{total > 0 ? ((chars / total) * 100).toFixed(1) : 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
