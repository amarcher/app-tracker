import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SourcesTable } from '../SourcesTable';

describe('SourcesTable', () => {
  const data = [
    { source: 'google', medium: 'organic', sessions: 500, users: 400, engagementRate: 0.82, avgSessionDuration: 145 },
    { source: '(direct)', medium: '(none)', sessions: 200, users: 180, engagementRate: 0.45, avgSessionDuration: 30 },
  ];

  it('renders source and medium', () => {
    render(<SourcesTable data={data} />);
    expect(screen.getByText('google')).toBeDefined();
    expect(screen.getByText('organic')).toBeDefined();
    expect(screen.getByText('(direct)')).toBeDefined();
    expect(screen.getByText('(none)')).toBeDefined();
  });

  it('renders engagement rate as percentage', () => {
    render(<SourcesTable data={data} />);
    expect(screen.getByText('82%')).toBeDefined();
    expect(screen.getByText('45%')).toBeDefined();
  });

  it('renders avg session duration formatted', () => {
    render(<SourcesTable data={data} />);
    expect(screen.getByText('2m 25s')).toBeDefined();
    expect(screen.getByText('30s')).toBeDefined();
  });

  it('renders updated column headers', () => {
    render(<SourcesTable data={data} />);
    expect(screen.getByText('Source')).toBeDefined();
    expect(screen.getByText('Engaged')).toBeDefined();
    expect(screen.getByText('Avg Duration')).toBeDefined();
  });
});
