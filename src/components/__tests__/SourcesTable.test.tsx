import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SourcesTable } from '../SourcesTable';

describe('SourcesTable', () => {
  const data = [
    { source: 'google', medium: 'organic', sessions: 500, users: 400 },
    { source: '(direct)', medium: '(none)', sessions: 200, users: 180 },
  ];

  it('renders source and medium', () => {
    render(<SourcesTable data={data} />);
    expect(screen.getByText('google')).toBeDefined();
    expect(screen.getByText('organic')).toBeDefined();
    expect(screen.getByText('(direct)')).toBeDefined();
    expect(screen.getByText('(none)')).toBeDefined();
  });

  it('renders column headers', () => {
    render(<SourcesTable data={data} />);
    expect(screen.getByText('Source')).toBeDefined();
    expect(screen.getByText('Medium')).toBeDefined();
    expect(screen.getByText('Sessions')).toBeDefined();
    expect(screen.getByText('Users')).toBeDefined();
  });
});
