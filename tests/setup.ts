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
import { afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';

export const mswServer = setupServer();

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

// jsdom doesn't pin navigator.onLine reliably; default to true.
Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
