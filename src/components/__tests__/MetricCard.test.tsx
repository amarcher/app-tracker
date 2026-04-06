import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from '../MetricCard';

describe('MetricCard', () => {
  it('renders label and numeric value', () => {
    render(<MetricCard label="Pageviews" value={1234} />);
    expect(screen.getByText('Pageviews')).toBeDefined();
    expect(screen.getByText('1,234')).toBeDefined();
  });

  it('renders string value without formatting', () => {
    render(<MetricCard label="Plan" value="Creator" />);
    expect(screen.getByText('Creator')).toBeDefined();
  });

  it('renders subtitle when provided', () => {
    render(<MetricCard label="Characters" value={5000} subtitle="of 300,000 limit" />);
    expect(screen.getByText('of 300,000 limit')).toBeDefined();
  });

  it('does not render subtitle when not provided', () => {
    const { container } = render(<MetricCard label="Users" value={42} />);
    expect(container.querySelector('.metric-subtitle')).toBeNull();
  });
});
