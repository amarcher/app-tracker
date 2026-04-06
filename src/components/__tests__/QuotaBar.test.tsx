import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuotaBar } from '../QuotaBar';

describe('QuotaBar', () => {
  it('renders label and values', () => {
    render(<QuotaBar label="Character Quota" used={150000} limit={300000} />);
    expect(screen.getByText('Character Quota')).toBeDefined();
    expect(screen.getByText('150,000 / 300,000')).toBeDefined();
  });

  it('calculates percentage correctly', () => {
    render(<QuotaBar label="Quota" used={75000} limit={300000} />);
    expect(screen.getByText('25.0% used')).toBeDefined();
  });

  it('caps at 100%', () => {
    render(<QuotaBar label="Quota" used={400000} limit={300000} />);
    expect(screen.getByText('100.0% used')).toBeDefined();
  });

  it('handles zero limit', () => {
    render(<QuotaBar label="Quota" used={0} limit={0} />);
    expect(screen.getByText('0.0% used')).toBeDefined();
  });

  it('sets fill width based on percentage', () => {
    const { container } = render(<QuotaBar label="Quota" used={150} limit={300} />);
    const fill = container.querySelector('.quota-fill') as HTMLElement;
    expect(fill.style.width).toBe('50%');
  });
});
