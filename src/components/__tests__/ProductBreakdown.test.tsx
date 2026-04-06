import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductBreakdown } from '../ProductBreakdown';

describe('ProductBreakdown', () => {
  it('renders products sorted by usage descending', () => {
    const data = { 'TTS': 5000, 'Conversational AI': 10000, 'Sound Effects': 100 };
    render(<ProductBreakdown data={data} />);
    const rows = screen.getAllByRole('row');
    // header + 3 data rows
    expect(rows.length).toBe(4);
    // First data row should be highest usage
    expect(rows[1].textContent).toContain('Conversational AI');
  });

  it('filters out zero-value products', () => {
    const data = { 'TTS': 5000, 'Unused': 0 };
    render(<ProductBreakdown data={data} />);
    expect(screen.queryByText('Unused')).toBeNull();
  });

  it('calculates share percentages', () => {
    const data = { 'TTS': 5000, 'Conversational AI': 5000 };
    render(<ProductBreakdown data={data} />);
    const cells = screen.getAllByText('50.0%');
    expect(cells.length).toBe(2);
  });
});
