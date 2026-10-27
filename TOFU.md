# Tofu gallery copy

This repository is Tofu's copy of **polaroi8d/cactoide** (licence: AGPL-3.0), listed in Tofu's app gallery as an event page that guests reply to, so the host sees who is coming.

- `main` mirrors the upstream repository and is never committed to by Tofu.
- `tofu` carries Tofu's own changes; tags named `pin/<date>` mark the versions the gallery points to.
- A visitor who chooses this app gets a private snapshot of the pinned version in their own Tofu account. Their copy does not follow upstream updates.

## What the app is

Cactoide is an RSVP site. A host creates an event (name, date, time, an optional place or map link, an optional limit on how many people can come, and whether it is public, private or invite-only) and shares its link. Guests open the link, type their name (and how many guests they bring) and appear on the event's list of attendees; the host sees who is coming, and can edit or delete the event. There are no accounts: each browser gets a random id in a cookie, which is what makes someone the host of the events they created and the owner of the replies they added. Public events are listed on `/discover`. Upstream: https://github.com/polaroi8d/cactoide, forked at commit `7a07d7439ff87eb5dfa9c8ad3787646c764693f3` (2025-11-10, version 0.1.1).

## How Tofu runs it

| | |
|---|---|
| Preset | `sveltekit` (SvelteKit 2, Svelte 5, Vite 7), on Tofu's server hosting |
| Root folder | the repository root |
| Install | the host's `npm install`, from `package-lock.json` |
| Build | `npm run build`: `node scripts/tofu-migrate.mjs && vite build` (see *Schema*) |
| Output | `.vercel/output`, written by `@sveltejs/adapter-vercel` 6.3.4: one Node.js function (Node 20, 22 or 24, whichever the build runs on) and the static files |
| Database | Tofu's managed PostgreSQL, created with the first deploy. The app reads `DATABASE_URL` (Tofu's transaction pooler) through postgres.js with unnamed statements; the other database settings Tofu saves (the Data API address and public key, `SUPABASE_CA_CERT`) are not used |
| Schema | `supabase/migrations/20251110000000_cactoide_init.sql`, applied by the build's first step (see *Schema*) |
| Public settings | `PUBLIC_SOURCE_URL`, which the gallery sets to this pin's source (see *Source code*). Nothing else is needed: event links are built from the address a page is opened at |
| Hidden values | none needed. `HOST_PASSWORD` is optional (see *Who can create events*) |

## Who can create events

Upstream lets anyone who opens the site create events, and a copy is online at a public address. So a copy takes an optional **host password**:

- `HOST_PASSWORD` unset (the default): anyone who opens the copy can create events, as upstream. The create page says so under its form, and says how to change it.
- `HOST_PASSWORD` set (save it on the app's Keys & settings page with *Hide this value after saving*, then deploy again): the create page asks for it once per browser. A browser that typed it keeps a pass cookie for up to 400 days. The cookie holds an HMAC keyed by the password, never the password, so **changing `HOST_PASSWORD` ends every pass at once** (every host types the new one). A wrong password answers after a second, which slows down guessing; a long passphrase is still the real protection, since nothing counts attempts. Leading and trailing spaces are ignored.
- Either way, guests open events, reply and remove their own replies without it, and a host can still edit or delete only the events their own browser created.

There is no administrator. Nothing in the app removes another browser's event, so an event a stranger created before the password was set stays until it is deleted in the database itself.

## Schema: what applies `supabase/migrations`

Upstream creates its tables only through docker-compose (`database/init.sql` mounted into the PostgreSQL container); nothing in the app creates them. On Tofu the build does:

1. `scripts/tofu-migrate.mjs` runs before `vite build`. It creates the Supabase CLI's migration ledger (`supabase_migrations.schema_migrations`) the way Tofu creates it, then applies each file in `supabase/migrations` the ledger does not record, in file-name order, each in one transaction that also writes the file's ledger row. So neither this script, Tofu nor the Supabase CLI runs a file twice. Without `DATABASE_URL` it applies nothing, so upstream's Docker image and local builds are unchanged. A file that fails stops the build, and the version already online keeps serving.
2. Two builds of one copy can run at the same time: the owner saves `HOST_PASSWORD` and deploys again while the first deploy still builds, for example. So each of the script's transactions first takes one transaction-level advisory lock, `pg_advisory_xact_lock(hashtext('scripts/tofu-migrate.mjs'))`, and one build at a time creates the ledger or applies a file. The other build waits; once it holds the lock, it reads the ledger again for that file, finds it recorded, prints `… was applied by another build while this one waited` and goes on. The lock is transaction-level because `DATABASE_URL` is Tofu's transaction pooler, which keeps a transaction on one server connection from `BEGIN` to its end, and PostgreSQL lets go of the lock when that transaction ends, however the build ends; a session-level lock (`pg_advisory_lock`) could stay behind on a server connection the pooler lends to someone else. The wait is bounded: `lock_timeout` is 120 s, and `statement_timeout` is 150 s while it waits, so a limit set for the database or the role (Supabase's two-minute global default, which caps its `postgres` role) cannot end the wait first with a less clear error; once the lock is held, both go back to their defaults. A build still waiting after 120 s stops with `[tofu-migrate] failed: the migration lock pg_advisory_xact_lock(hashtext('scripts/tofu-migrate.mjs')) was still held by another session after 120s …`, which says to deploy again once the other build has finished.
3. When anything fails, the script prints `[tofu-migrate] failed:` and the error's message alone (a connection error object can carry `DATABASE_URL`, and with it the password), then exits with status 1 as soon as that line is written, without closing its connection. Closing it could keep the build running: postgres.js ends a connection by half-closing its socket, so if the server or the network path never closes its end, the process stays alive. Nothing of a failed file stays behind: its transaction is rolled back before the script exits, or by PostgreSQL when the connection goes away, and the lock goes with it. After a run that succeeds, the script does close its connection, but waits at most 5 s for the server to close its end, then exits with status 0 once its output is written, so the same half-closed socket cannot keep that build running either.
4. Tofu reads the build command, finds a step whose name says it migrates, and leaves the folder to the build (it applies `supabase/migrations` itself only for a build that runs no such step), so Tofu opens nothing to its Data API for these tables.
5. `20251110000000_cactoide_init.sql` is upstream's `init.sql` without `BEGIN`/`COMMIT` (whatever applies it runs it in a transaction of its own) and without `CREATE EXTENSION pgcrypto` (`gen_random_uuid()` is built into PostgreSQL 13 and later), plus row-level security turned on for `events`, `rsvps` and `invite_tokens`, with no policy. The app's own connection owns the tables and is not limited by it; on a database whose old default still opens every new table to the Data API's roles, these lines are what keep anyone holding the database's public key from every row (each browser's id, which is its only credential, is in those rows). **Never remove those lines, and give any table a new file creates the same line.** When a later upstream version changes `database/init.sql`, add a new file with only the change.

## What Tofu changes

One commit each, every one titled `Tofu: …` with its reason:

- `svelte.config.js`, `Dockerfile`, `package.json`, `package-lock.json`: builds with `@sveltejs/adapter-vercel` 6.3.4 (a new dev dependency; the 6.x line is the one for SvelteKit 2), which Tofu's `sveltekit` preset runs. `CACTOIDE_ADAPTER=node` builds upstream's Node server instead, and the Dockerfile sets it. The lockfile otherwise only adds the adapter's own dependencies and moves `minipass` 7.1.2 → 7.1.3 and `picomatch` 4.0.3 → 4.0.7, which npm chose to share them.
- `src/app.html`: upstream's analytics script (its author's own Umami site, `analytics.dalev.hu`) is removed, so a copy does not report its visitors to a third party.
- `src/lib/database/db.ts`, `src/lib/database/healthCheck.ts`: `prepare: false`. Tofu's `DATABASE_URL` is a transaction pooler, which keeps no prepared statements between transactions.
- `supabase/migrations/20251110000000_cactoide_init.sql` (new), `scripts/tofu-migrate.mjs` (new), `package.json` (`build`): the schema at build (see *Schema*). Two more commits (2026-10-27) give the script its lock and make it exit promptly, after a failure and after a success.
- `src/lib/sourceUrl.ts` (new), `src/routes/+layout.svelte`, `src/routes/+page.svelte`, `static/llms.txt`, `src/lib/i18n/messages.json`, `src/lib/i18n/it.json`: the source link (see *Source code*).
- `src/lib/server/hostPassword.ts` (new), `src/routes/create/+page.server.ts`, `src/routes/create/+page.svelte`, `messages.json`, `it.json`: the host password (see *Who can create events*). The create action is now named `create` (it was the default action) and the page's form posts to `?/create`; `unlock` checks the password.
- `src/routes/event/[id]/+page.server.ts`: removing a reply now needs the browser that added it, as the page's own Remove button (shown on your own replies only) and the invite page's `removeRSVP` already intended. Upstream deleted any reply whose id was posted, and every reply's id is sent to everyone who opens the event.
- `TOFU.md`: this file.

Nothing else changed: the pages, the name, the strings (but the new ones) and the logo are upstream's.

## What works differently on Tofu

- **Federation stays off.** `federation.config.js` lists no other instances (as upstream ships it), so the copy fetches no one's events, and `/api/federation/*` answer 403 while `FEDERATION_INSTANCE` is unset. Leave it unset: the app treats any value, even `false`, as on. `/instance` shows *No federation instances configured*.
- **Identity is the browser.** Clearing cookies, or another device, means a host can no longer edit or delete their earlier events, and a guest can no longer remove their reply (upstream's design).
- **"Today" is the server's day.** Creating or editing an event refuses a date before the server's today, and Tofu's server runs on UTC; late in the evening west of UTC, today's local date can be refused as past.
- **Logs** are pino's JSON lines in the app's logs. Leave `LOG_PRETTY` unset: `pino-pretty` runs in a worker thread, which was not tried on Tofu's hosting.
- **Database TLS.** postgres.js reads `sslmode=require` in `DATABASE_URL` as encrypted without verifying the server's certificate (libpq's meaning of `require`); the app does not use `SUPABASE_CA_CERT` to verify it.
- **Docker.** The `Dockerfile` and `docker-compose.yml` are upstream's self-hosting path (Node adapter, tables from `database/init.sql`, no row-level security). Tofu does not use them; a root `Dockerfile` makes Tofu's detector suggest `container`, and the gallery sets `sveltekit`.

## Optional settings

| Name | What it does | Kind |
|---|---|---|
| `HOST_PASSWORD` | Keeps event creation to the browsers that typed it (see *Who can create events*). | hidden value |
| `PUBLIC_SOURCE_URL` | Where the footer's *Source code* link and the home page's *View on GitHub* point. The gallery sets it to this pin's source; unset, they open this fork's `tofu` branch. | public |
| `PUBLIC_LANDING_INFO` | `false` opens the site on `/discover` instead of upstream's home page. | public |
| `LOG_LEVEL` | pino's level, `info` by default. | public |

Leave unset: `FEDERATION_INSTANCE` (see above), `LOG_PRETTY`, `CACTOIDE_ADAPTER`.

## Source code

AGPL-3.0 section 13 asks a modified copy that people use over a network to offer them its source. Every page's footer has a *Source code* link, and the home page's *View on GitHub* button opens the same address: `PUBLIC_SOURCE_URL` when it is a web address, else https://github.com/tofu-gallery/cactoide/tree/tofu. Nobody signs in to Cactoide, so every visitor sees it. `static/llms.txt` links this fork's `tofu` branch, since a static file cannot read a setting.

## Licence

AGPL-3.0. `LICENSE` and the footer's `© 2025 Cactoide` stay exactly as upstream has them. Every file Tofu changed carries a dated `Tofu` note where its format allows a comment; `package.json`, `package-lock.json`, `messages.json` and `it.json` are JSON, which takes no comments, so this file lists them above. The name **Cactoide** is upstream's; the copy shows it because it runs Cactoide, and implies no endorsement. The favicon and `docs/federation_example.png` ship as upstream distributes them.

## Verification (2026-10-25)

On a Mac (Node 22.22.3, npm 10.9.8), against a throwaway local PostgreSQL 14 database (`cactoide_r9b`, dropped afterwards). No deployment and no Docker. The code was checked at commit `bffac224d239deb6550db8d72c24727921c01598` (the commit before this file).

- A tree with no executable file, as Tofu's import delivers one: `git archive tofu | tar -x`, then `chmod a-x` on every file (0 executable files left), and `.npmrc` removed (Tofu does not upload it). Everything below ran from that tree.
- `npm ci`: 298 packages. `npx svelte-check`: 6 errors, all in files Tofu did not touch (upstream's own: `fetchFederatedEvents.ts`, `discover/+page.server.ts`, `instance/+page.server.ts`, and `db.ts`'s `env.DATABASE_URL` typed as possibly undefined, on a line Tofu did not change).
- `DATABASE_URL=<that database> npm run build`: passed; `[tofu-migrate] 1 applied, 0 already recorded, 1 files.`, then *Using @sveltejs/adapter-vercel ✔ done*, function runtime `nodejs22.x`. The database then held `events`, `rsvps` and `invite_tokens`, all three with row-level security, and one ledger row (`20251110000000 cactoide_init`). A second build printed `0 applied, 1 already recorded, 1 files.`
- The build's real Vercel function (`.vercel/output/functions/…/catchall.func`, with the files the adapter traced into it: postgres, drizzle-orm, pino and the rest), copied away from the tree so that nothing outside it could be loaded, served on a free 127.0.0.1 port by a small harness standing in for Vercel's front (static files first, then the function's `fetch`, with the request seen as `https://`). `/`, `/discover`, `/create`, `/event`, `/instance` and `/api/healthz` (`{"ok":true}`) answered 200, `/llms.txt` 200, an unknown path 404; `/api/federation/events` answered 403 (federation off); the pages carry no analytics script, and the footer and *View on GitHub* link `https://github.com/tofu-gallery/cactoide/tree/tofu`.
- As three browsers (cookies): the host created *Team lunch* (303 to `/event/<id>`); Frank replied with one guest and Mike replied (200 each); the event page listed *Frank*, *Frank's Guest #1* and *Mike*. A stranger's delete of the host's event was refused (403); a post from another site was refused (403); a stranger removing Frank's reply was refused (404) and the reply stayed; Frank removed his own guest (200).
- With `HOST_PASSWORD` set (with spaces around it): `/create` showed the password form; creating without the pass was refused (403); a wrong password was refused after one second (403); the right one (typed without the spaces) answered 303 to `/create` with an `HttpOnly`, `SameSite=Lax` pass cookie; with it, `/create` showed the event form and an event was created (303); a made-up pass was refused (403); a guest could still reply (200).
- Row-level security: a role granted `select, insert, update, delete` on the three tables (as the Data API's roles are, on a database with the old default) saw 0 events, 0 replies and 0 invite tokens where the app's own connection saw 2 and 3; its insert was refused by row-level security, and its update and delete of replies changed nothing.
- Headless Chromium (Playwright) against 127.0.0.1 only, every other host refused (none was asked for): the six pages loaded; a reply typed into the event page's own form and an event created through the create page's own form both worked (the browser landed on the new event's page). No page errors and no console errors.
- Tofu's own GitHub import and checks, run from Tofu's code (`lane_check_r9.mts`) on the `tofu` branch at `26567601`: the import reads 77 files; Tofu's safety check passes with 0 findings; 64 files would be published, but the app is not one for the static lane (server code, and the detector answers `container` because of upstream's root `Dockerfile`): it runs on Tofu's server hosting with the preset the gallery sets, `sveltekit`.

## Verification of the lock and the exits (2026-10-27)

On a Mac (Node 22.22.3, npm 10.9.8; `npm ci`: 298 packages), against a throwaway local PostgreSQL 14.24 cluster on 127.0.0.1, stopped and deleted afterwards. The script connected as an ordinary login role (not a superuser) that owns each test database, with `statement_timeout` set to 2 minutes on the role, standing in for Supabase's two-minute global default, which caps its `postgres` role; cases with the limit on the database used a role with no limit of its own, in a database with `statement_timeout` set to 2 minutes. Every case used a new, empty database. No deployment, no pooler and no Docker. The script was checked as it is committed with this note; *before* means the script as tagged `pin/2026-10-25`.

- Two first builds at once: two runs of the script, each held by a preloaded module until the same instant, six times. Each time both exited 0: one printed `applied 20251110000000_cactoide_init.sql` and `1 applied, 0 already recorded, 1 files.`, the other `20251110000000_cactoide_init.sql was applied by another build while this one waited` and `0 applied, 1 already recorded, 1 files.` The database then held `events`, `rsvps` and `invite_tokens`, all three with row-level security, one ledger row (`20251110000000 cactoide_init`) and no advisory lock. Three more times on databases whose ledger already existed, empty: the same. Before, one of the two runs exited 1 in all nine: `duplicate key value violates unique constraint "pg_namespace_nspname_index"` (five times), `"pg_type_typname_nsp_index"` (once) and, where the ledger already existed, `"schema_migrations_pkey"` (three times). The script also ran three at once, twice (one applied, two waited), and two at once with the limit on the database, twice: every run exited 0, and each database ended as above.
- A third run: `0 applied, 1 already recorded, 1 files.`, exit 0, still one ledger row. Without `DATABASE_URL`, or with a blank one: `DATABASE_URL is not set; nothing to apply.`, exit 0.
- Waiting for the lock: while another session held `pg_advisory_xact_lock(hashtext('scripts/tofu-migrate.mjs'))` in an open transaction, the script's session showed in `pg_stat_activity` as waiting on an advisory lock, and the database held nothing yet. Held for 8 s: once the holder committed, the script applied the file and exited 0, 7.5 s after it started (half a second after the holder took the lock). Held for 135 s by a session with no statement timeout: the script exited 1 after 120.0 s with `[tofu-migrate] failed: the migration lock pg_advisory_xact_lock(hashtext('scripts/tofu-migrate.mjs')) was still held by another session after 120s (most likely another build of this app, applying migrations), so this build stops. Deploy again once that build has finished.`, and the database held no ledger and no table; the same with the limit on the database. Beside each, a session of the same role that set only `lock_timeout = '120s'` and asked for the same lock was ended at 120 s by the two-minute limit instead (`canceling statement due to statement timeout`): the less clear error that the script's 150 s `statement_timeout` for the wait avoids. In `psql`, the script's statements (the two `set local`, the lock, then `set local … to default`) showed `statement_timeout` at 150s during the wait and left `lock_timeout` at 0 and `statement_timeout` at 2min for the rest of the transaction, with the limit on the role and on the database alike.
- Failing, then exiting: against the real server through a local proxy that never passes a close on (a server or network path that stopped answering), on a database where the file fails (`column "user_id" does not exist`, because of an `events` table made beforehand): exit 1 after 0.1 s. Before: the same line, and the process was still running when it was killed at 90 s. Against a local TCP server that answers the startup with an error and then holds the socket: exit 1 after 0.1 s (before: 30.1 s). Against one that accepts connections and never answers: exit 1 after 30.0 s, its `connect_timeout`, with and without `sslmode=require` (`failed: write CONNECT_TIMEOUT 127.0.0.1:<port>`; before, the same). The failed file left no ledger row and none of its tables, and no output held the URL or its password.
- Succeeding, then exiting: through the same proxy, a first run printed `applied 20251110000000_cactoide_init.sql` and `1 applied, 0 already recorded, 1 files.` and exited 0 after 5.1 s, the 5 s it waits for the server to close its end; a run that applied nothing exited 0 after 5.1 s too. Run the way npm runs the build script (`sh -c 'node scripts/tofu-migrate.mjs && …'`, its output on a pipe), the step after it ran, and both had finished 5.1 s after the start. Before: both runs printed the same lines and were still running when they were killed at 20 s. Straight to the server, without the proxy: exit 0 after 0.1 s.
- `npx prettier --check` and `npx eslint` on the script: no findings.

## Needs a real deploy to verify

- Tofu's `sveltekit` preset builds the app with the host's `npm install` and `npm run build`, and the Node version the host picks is one adapter-vercel 6.3.4 supports (20, 22 or 24).
- `DATABASE_URL` is present at build time, so `tofu-migrate.mjs` creates the tables in the new managed database through its transaction pooler, and Tofu leaves `supabase/migrations` to the build as described above.
- Two builds of one copy at once, through that pooler: the second waits for the first's lock, then finds the file recorded (checked on 2026-10-27 over a direct connection to a local PostgreSQL only).
- The app reaches the database through the pooler with `prepare: false` and `sslmode=require`, on the first request and on a function instance that has served many.
- Cookies are set `Secure` behind HTTPS, and the host password's pass works across the copy's own address.
- `/api/healthz` on the copy's address answers `{"ok":true}`, and the function's logs show pino's JSON lines.
