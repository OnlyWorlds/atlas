import { expect, test } from 'vitest';

// A probe, never merged: this pull request exists to show the suites run on a
// pull request and read red on a broken test.
test('the pull request check reads red on a broken test', () => {
  expect(1 + 1).toBe(3);
});
