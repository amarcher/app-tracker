import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopPagesTable } from '../TopPagesTable';

describe('TopPagesTable', () => {
  const data = [
    { path: '/mailbox', pageviews: 100, sessions: 80 },
    { path: '/', pageviews: 50, sessions: 45 },
    { path: '/animals/elephant', pageviews: 25, sessions: 20 },
  ];

  it('renders all rows', () => {
    render(<TopPagesTable data={data} />);
    expect(screen.getByText('/mailbox')).toBeDefined();
    expect(screen.getByText('/')).toBeDefined();
    expect(screen.getByText('/animals/elephant')).toBeDefined();
  });

  it('renders column headers', () => {
    render(<TopPagesTable data={data} />);
    expect(screen.getByText('Page')).toBeDefined();
    expect(screen.getByText('Views')).toBeDefined();
    expect(screen.getByText('Sessions')).toBeDefined();
  });

  it('formats numbers with commas', () => {
    render(<TopPagesTable data={[{ path: '/big', pageviews: 10000, sessions: 8000 }]} />);
    expect(screen.getByText('10,000')).toBeDefined();
    expect(screen.getByText('8,000')).toBeDefined();
  });

  it('renders empty table for empty data', () => {
    const { container } = render(<TopPagesTable data={[]} />);
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(0);
  });
});
