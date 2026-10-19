/**
 * Vitest global setup.
 *
 * Folder-first atlas: world data lives on disk (File System Access API in the
 * browser, mocked in-memory for tests). IDB is retained only for the
 * FileSystemDirectoryHandle vault, so fake-indexeddb stays loaded as a polyfill.
 *
 * MSW server is started here; test files register handlers per scenario.
 */

import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { __setRegistryTabBaseForTests } from '../src/registry/registry';

// Every attach asks keel's roster whether others share the world (B12 Q1).
// By default a world is its owner's alone; a file about sharing mocks its own
// roster. A base handler, so it survives `resetHandlers`.
export const mswServer = setupServer(
  http.get('*/api/v2/members/', () => HttpResponse.json({
    data: [{ id: null, kind: 'owner', role: 'owner', character: null, status: 'active' }],
  })),
);

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
// The registry's two-tab merge base is module state: a base left by one
// test must not shape the next test's saves (S365 gate lens A L2).
beforeEach(() => __setRegistryTabBaseForTests(null));
afterAll(() => mswServer.close());

// jsdom doesn't pin navigator.onLine reliably; default to true.
Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });

// jsdom has no Range layout. A TipTap `focus()` scrolls the selection into
// view (prosemirror `scrollToSelection` → `Range.getClientRects`), inside a
// rAF, so a test that opens an editor ended the RUN with an unhandled
// TypeError and exit 1 while every test passed (Boss, 1.11). Zero rects:
// nothing here measures layout; e2e owns geometry.
const zeroRect = (): DOMRect => ({
  x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0,
  toJSON: () => ({}),
}) as DOMRect;
if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => Object.assign([] as DOMRect[], { item: () => null }) as unknown as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = zeroRect;
}
