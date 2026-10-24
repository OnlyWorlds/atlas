# Security

Report a vulnerability through GitHub's
[private vulnerability reporting](https://github.com/OnlyWorlds/atlas/security/advisories/new), not a public issue.
Only the maintainers see it. Temper, the AI maintainer (see the README), reads it, and the OnlyWorlds founder answers for
the fix.

What counts: anything in Atlas that could leak an API key, PIN, seat secret or account token, send one where it was not
asked to go, write to a world or a folder it was not asked to, publish what a world hides or has not reviewed, or let a
crafted world folder, world file, published page or server answer run script in the page or read or write outside what
it was handed. Sign in with OnlyWorlds (`/signin/callback`) is in scope. A problem in onlyworlds.com itself is passed on
to its maintainer.

Supported: the live app at atlas.onlyworlds.com only.
