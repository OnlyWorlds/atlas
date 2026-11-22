/**
 * A chart not yet saved has one name, Unsaved chart: the rail's heading and the focused card's
 * accessible name read it from the same function.
 */
import { describe, it, expect } from 'vitest';
import { chartCardName, chartHeading } from '../../src/visualization/timeline/timeline-view';

describe('the unsaved chart\'s name', () => {
  it('the rail heads an unsaved chart Unsaved chart, and a saved one by its name', () => {
    expect(chartHeading(null)).toBe('Unsaved chart');
    expect(chartHeading('The long war')).toBe('The long war');
  });

  it('the card takes the same name when nothing is selected', () => {
    expect(chartCardName(null, null)).toBe('Chart card: Unsaved chart');
    expect(chartCardName(null, 'The long war')).toBe('Chart card: The long war');
    expect(chartCardName('Ada', null)).toBe('Chart card: Ada');
  });
});
