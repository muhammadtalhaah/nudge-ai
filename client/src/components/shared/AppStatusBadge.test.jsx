/**
 * Status badge.
 *
 * The point of these tests is the accessibility rule: status must never be conveyed by colour
 * alone, so every status has to render a readable label.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AppStatusBadge from './AppStatusBadge';

describe('AppStatusBadge', () => {
  it.each([
    ['PENDING', 'Pending'],
    ['CONFIRMED', 'Confirmed'],
    ['CANCELLED', 'Cancelled'],
    ['COMPLETED', 'Completed'],
    ['NO_SHOW', 'No show'],
  ])('renders a text label for %s', (status, label) => {
    render(<AppStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('renders an unknown status readably instead of crashing', () => {
    // A status added server-side should degrade, not blank the page.
    render(<AppStatusBadge status="RESCHEDULED_PENDING" />);
    expect(screen.getByText('RESCHEDULED_PENDING')).toBeInTheDocument();
  });

  it('hides its decorative icon from assistive technology', () => {
    const { container } = render(<AppStatusBadge status="CONFIRMED" />);
    const icon = container.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
