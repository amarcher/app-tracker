import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

describe('App', () => {
  it('renders the project selector with all projects', () => {
    render(<App />);
    expect(screen.getByText('Animal Pen Pals')).toBeDefined();
    expect(screen.getByText('Space Explorer')).toBeDefined();
    expect(screen.getByText('Periodic Table')).toBeDefined();
    expect(screen.getByText('Crossword Clash')).toBeDefined();
    expect(screen.getByText('Delivery Picker')).toBeDefined();
    expect(screen.getByText('Superbowl Squares')).toBeDefined();
    expect(screen.getByText('Tabbit Rabbit')).toBeDefined();
    expect(screen.getByText('Mark My Words')).toBeDefined();
  });

  it('renders the ElevenLabs account button', () => {
    render(<App />);
    expect(screen.getByText('ElevenLabs')).toBeDefined();
  });

  it('renders date range selector', () => {
    render(<App />);
    expect(screen.getByText('7 days')).toBeDefined();
    expect(screen.getByText('14 days')).toBeDefined();
    expect(screen.getByText('30 days')).toBeDefined();
    expect(screen.getByText('90 days')).toBeDefined();
  });

  it('shows loading state initially', () => {
    render(<App />);
    const buttons = screen.getAllByRole('button');
    const refreshBtn = buttons.find(b => b.classList.contains('refresh-btn'));
    expect(refreshBtn?.textContent).toBe('Loading...');
  });

  it('renders Traffic and API Usage section headers', () => {
    render(<App />);
    expect(screen.getByText('Traffic')).toBeDefined();
    expect(screen.getByText('API Usage (per-project)')).toBeDefined();
  });
});
