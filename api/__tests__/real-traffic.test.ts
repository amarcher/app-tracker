import { expect, it } from 'vitest';
import {
  DATA_CENTRE_PLACES,
  HEADLESS_SCREENS,
  OWNER_IPS,
  ROBOT_SCREENS,
  ga4RealTrafficFilter,
  withRealTraffic,
  posthogRealTrafficFilter,
  type Ga4FilterExpression,
} from '../_shared/real-traffic';

/** Evaluates the GA4 filter against one row, the way GA4 would. */
function keeps(expr: Ga4FilterExpression, row: Record<string, string>): boolean {
  if ('notExpression' in expr) return !keeps(expr.notExpression, row);
  if ('andGroup' in expr) return expr.andGroup.expressions.every((e) => keeps(e, row));
  if ('orGroup' in expr) return expr.orGroup.expressions.some((e) => keeps(e, row));
  const { fieldName, stringFilter, inListFilter } = expr.filter;
  const value = row[fieldName] ?? '';
  return stringFilter ? value === stringFilter.value : !!inListFilter?.values.includes(value);
}

const person = { city: 'Sydney', region: 'New South Wales', sessionDefaultChannelGroup: 'Direct', screenResolution: '1920x1080' };

it('drops the owner by city and region, never a namesake city', () => {
  const filter = ga4RealTrafficFilter();
  expect(keeps(filter, person)).toBe(true);
  expect(keeps(filter, { ...person, city: 'Lexington', region: 'Massachusetts' })).toBe(false);
  expect(keeps(filter, { ...person, city: 'Lexington', region: 'Kentucky' })).toBe(true);
});

it('drops data-centre towns but keeps big cities that also host clouds', () => {
  const filter = ga4RealTrafficFilter();
  for (const place of DATA_CENTRE_PLACES) expect(keeps(filter, { ...person, ...place })).toBe(false);
  expect(keeps(filter, { ...person, city: 'Phoenix', region: 'Arizona' })).toBe(true);
  expect(keeps(filter, { ...person, city: 'Des Moines', region: 'Iowa' })).toBe(true);
});

it('drops headless screens only on a Direct session', () => {
  const filter = ga4RealTrafficFilter();
  for (const screenResolution of HEADLESS_SCREENS) {
    expect(keeps(filter, { ...person, screenResolution })).toBe(false);
    expect(keeps(filter, { ...person, screenResolution, sessionDefaultChannelGroup: 'Organic Search' })).toBe(true);
  }
});

it('drops screens no real device has on every channel', () => {
  const filter = ga4RealTrafficFilter();
  for (const screenResolution of ROBOT_SCREENS) {
    expect(keeps(filter, { ...person, screenResolution, sessionDefaultChannelGroup: 'Paid Social' })).toBe(false);
  }
});

it('gives PostHog a HogQL filter on the owner IPs and data-centre towns that keeps events without them', () => {
  const { type, key } = posthogRealTrafficFilter();
  expect(type).toBe('hogql');
  for (const ip of OWNER_IPS) expect(key).toContain(`'${ip}'`);
  expect(key).toContain("('Boydton', 'Virginia')");
  expect(key).toContain("ifNull(properties.$ip, '')");
  expect(key).not.toContain('1280');
});

it('keeps a window\'s own hour filter and adds the real-traffic filter beside it', () => {
  const hours = { filter: { fieldName: 'dateHour', inListFilter: { values: ['2026110112'] } } };
  const window = withRealTraffic({ dateRanges: [{ startDate: '2026-11-01', endDate: '2026-11-01' }], dimensionFilter: hours });
  const row = { ...person, dateHour: '2026110112' };
  expect(keeps(window.dimensionFilter, row)).toBe(true);
  expect(keeps(window.dimensionFilter, { ...row, dateHour: '2026110111' })).toBe(false);
  expect(keeps(window.dimensionFilter, { ...row, city: 'Lexington', region: 'Massachusetts' })).toBe(false);
  expect(withRealTraffic({ dateRanges: [] }).dimensionFilter).toEqual(ga4RealTrafficFilter());
});
