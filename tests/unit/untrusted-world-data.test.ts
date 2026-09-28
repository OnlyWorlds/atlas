/**
 * S360 security bout: world data is untrusted (folders anyone can write, AI
 * output, imported envelopes). These lock the helpers that turn it into HTML.
 */
import { describe, it, expect } from 'vitest';
import { escapeText, escapeAttr, isHexColour, hexColourOr, finiteOr } from '../../src/core/dom-utils';
import { parseWorldStyles } from '../../src/core/world-styles';
import { renderProseFragment } from '../../src/middle/writing-compiled';

describe('escapeText is safe in attribute values and total', () => {
  it('escapes quotes, so a value cannot break out of attr="…"', () => {
    const hostile = 'x" autofocus onfocus="alert(1)';
    const host = document.createElement('div');
    host.innerHTML = `<input value="${escapeText(hostile)}">`;
    const input = host.querySelector('input')!;
    expect(input.getAttribute('onfocus')).toBeNull();
    expect(input.hasAttribute('autofocus')).toBe(false);
    expect(input.value).toBe(hostile);
  });

  it('single quotes too', () => {
    const host = document.createElement('div');
    host.innerHTML = `<span title='${escapeText("a' onmouseover='x")}'></span>`;
    expect(host.querySelector('span')!.getAttribute('onmouseover')).toBeNull();
  });

  it('never throws on a non-string (a numeric name from a foreign folder)', () => {
    expect(escapeText(1453)).toBe('1453');
    expect(escapeText(null)).toBe('');
    expect(escapeText(undefined)).toBe('');
    expect(escapeAttr({})).toBe('[object Object]');
  });

  it('round-trips ordinary text through innerHTML unchanged', () => {
    const s = `Rachmaninov's "Prelude" & <co>`;
    const host = document.createElement('div');
    host.innerHTML = escapeText(s);
    expect(host.textContent).toBe(s);
  });
});

describe('colours and numbers from world files', () => {
  it('accepts only #rrggbb', () => {
    expect(isHexColour('#22d3ee')).toBe(true);
    expect(isHexColour('red')).toBe(false);
    expect(isHexColour('"><img src=x onerror=alert(1)>')).toBe(false);
    expect(isHexColour('red;position:fixed;inset:0')).toBe(false);
    expect(isHexColour(123)).toBe(false);
    expect(hexColourOr('#ABCDEF', '#000000')).toBe('#ABCDEF');
    expect(hexColourOr('javascript:1', '#000000')).toBe('#000000');
  });

  it('finiteOr keeps numbers and numeric strings, drops the rest', () => {
    expect(finiteOr(3, 0)).toBe(3);
    expect(finiteOr('7', 0)).toBe(7);
    expect(finiteOr('<img src=x>', 0)).toBe(0);
    expect(finiteOr('', 5)).toBe(5);
    expect(finiteOr(NaN, 1)).toBe(1);
    expect(finiteOr(Infinity, 1)).toBe(1);
  });

  it('parseWorldStyles drops hostile visuals but keeps the rule', () => {
    const styles = parseWorldStyles({
      rules: [
        { type: 'zone', supertype: 'River', color: '"><img src=x onerror=alert(1)>', weight: 'x', dash: 'url(x)', fill_opacity: 7 },
        { type: 'zone', supertype: 'Route', color: 'red;position:fixed', label_priority: 'yes' },
        { type: 'zone', supertype: 'Chora', color: '#f59e0b', weight: 3, dash: 'dashed', fill_opacity: 0.3, label_priority: true },
      ],
    });
    expect(styles.rules).toHaveLength(3);
    const [river, route, chora] = styles.rules;
    expect(river.color).toBeUndefined();
    expect(river.weight).toBeUndefined();
    expect(river.dash).toBeUndefined();
    expect(river.fill_opacity).toBe(1);
    expect(route.color).toBeUndefined();
    expect(route.label_priority).toBeUndefined();
    expect(chora).toEqual({ type: 'zone', supertype: 'Chora', color: '#f59e0b', weight: 3, dash: 'dashed', fill_opacity: 0.3, label_priority: true });
  });
});

describe('compiled prose links', () => {
  it('a query-string link keeps a single &amp; (was double-escaped)', () => {
    const el = renderProseFragment('see [the map](https://example.com/?a=1&b=2)', new Map());
    const a = el.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/?a=1&b=2');
  });

  it('a quote in a link url cannot add an attribute', () => {
    const el = renderProseFragment('[x](https://e.com/"onmouseover="alert(1))', new Map());
    const a = el.querySelector('a');
    expect(a?.getAttribute('onmouseover') ?? null).toBeNull();
  });
});
