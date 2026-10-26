import { describe, it, expect } from 'vitest';
import { canOfferInvite, owAccessUrl, noAccountYetHtml, OW_SIGNUP_URL, OW_PIN_URL } from '../../src/core/ow-site';
import type { WorldRegistryEntry, AccountWorldRow } from '../../src/core/types';

// Invite someone opens the website's Access pane (keel makes invite
// links only there), and only where the person can make one.

function linked(api: Partial<NonNullable<WorldRegistryEntry['api']>> = {}): WorldRegistryEntry {
  return {
    id: 'w1', name: 'W', state: 'api-linked',
    api: { world_id: 'srv-1', api_key: 'k', ...api },
  } as unknown as WorldRegistryEntry;
}

const row = (role: AccountWorldRow['role']): AccountWorldRow =>
  ({ id: 'srv-1', name: 'W', role, public_read: false, keys: [] });

describe('canOfferInvite', () => {
  it('offers on a linked world with no account list (the owner is the likely case)', () => {
    expect(canOfferInvite(linked(), [])).toBe(true);
  });
  it('offers when the account list says owner', () => {
    expect(canOfferInvite(linked(), [row('owner')])).toBe(true);
  });
  it('not for a world the account only collaborates on', () => {
    expect(canOfferInvite(linked(), [row('collaborator')])).toBe(false);
  });
  it('with the account list loaded, only a world on it as owner (#341, gate M2)', () => {
    expect(canOfferInvite(linked(), [], true)).toBe(false);
    expect(canOfferInvite(linked(), [row('owner')], true)).toBe(true);
    expect(canOfferInvite(linked(), [row('collaborator')], true)).toBe(false);
  });
  it('not for a seat, a view-only world, or a local one', () => {
    expect(canOfferInvite(linked({ seat: { role: 'contributor' } }), [])).toBe(false);
    expect(canOfferInvite(linked({ read_only: true }), [])).toBe(false);
    expect(canOfferInvite({ id: 'w2', name: 'L', state: 'local' } as unknown as WorldRegistryEntry, [])).toBe(false);
  });
});

describe('the onlyworlds.com addresses', () => {
  it('opens the world page at Access, the id encoded', () => {
    expect(owAccessUrl('0e1f')).toBe('https://www.onlyworlds.com/account/worlds/0e1f/access');
    expect(owAccessUrl('a/b')).toBe('https://www.onlyworlds.com/account/worlds/a%2Fb/access');
  });
  it('the no-account line carries both links, opening a new tab', () => {
    const html = noAccountYetHtml();
    expect(html).toContain(`href="${OW_SIGNUP_URL}"`);
    expect(html).toContain(`href="${OW_PIN_URL}"`);
    expect(html.match(/target="_blank" rel="noopener"/g)).toHaveLength(2);
    expect(html).not.toMatch(/—/);
  });
});
