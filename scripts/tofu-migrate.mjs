// Tofu (new file, 2026-10-25; the lock and the exits, 2026-10-27): applies supabase/migrations at the start of
// the build (see TOFU.md, Schema).
//
// Each file the database's migration ledger does not record yet (the Supabase CLI's own
// supabase_migrations.schema_migrations, created the way Tofu creates it) is applied in file-name order, each in one
// transaction with its ledger row, so neither this script, Tofu nor the Supabase CLI ever runs a file twice. Two builds
// of one copy can run at the same time (a deploy started while the one before it still builds), so every transaction
// here first takes one advisory lock: one build at a time creates the ledger or applies a file, and the other waits,
// then reads the ledger again and finds the file recorded. Without DATABASE_URL it applies nothing, so a build anywhere
// else (upstream's Docker image, a laptop) is unchanged. It uses the app's own driver (postgres.js) with unnamed
// statements, which Tofu's transaction pooler accepts.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

// A transaction-level lock: Tofu's transaction pooler keeps a transaction on one server connection from its BEGIN to
// its end, and PostgreSQL lets go of the lock when the transaction ends, however the build ends. A session-level lock
// (pg_advisory_lock) could stay behind on a server connection the pooler then lends to someone else.
const LOCK_KEY = 'scripts/tofu-migrate.mjs';
const LOCK = `pg_advisory_xact_lock(hashtext('${LOCK_KEY}'))`;
// The wait for the lock is bounded. statement_timeout is set above that bound for the wait, so a limit set for the
// database or the role (Supabase's two-minute global default, which caps its postgres role) cannot end it first with a
// less clear error; once the lock is held, both go back to their defaults (the role's or the database's own values) for
// the rest of the transaction.
const LOCK_WAIT = '120s';
const LOCK_STATEMENT_LIMIT = '150s';

const url = process.env.DATABASE_URL?.trim();

if (!url) {
	console.log('[tofu-migrate] DATABASE_URL is not set; nothing to apply.');
	process.exit(0);
}

const directory = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(directory)
	.filter((name) => /^[0-9]+_[^/]*\.sql$/.test(name))
	.sort();

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 30, onnotice: () => {} });

// The first statements of every transaction below.
async function takeLock(tx) {
	await tx
		.unsafe(
			`set local lock_timeout = '${LOCK_WAIT}'; set local statement_timeout = '${LOCK_STATEMENT_LIMIT}'`
		)
		.simple();
	try {
		await tx`select pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`;
	} catch (error) {
		if (error?.code === '55P03') {
			throw new Error(
				`the migration lock ${LOCK} was still held by another session after ${LOCK_WAIT} (most likely another build of this app, applying migrations), so this build stops. Deploy again once that build has finished.`
			);
		}
		throw error;
	}
	await tx
		.unsafe('set local lock_timeout to default; set local statement_timeout to default')
		.simple();
}

let failure;

try {
	const recorded = await sql.begin(async (tx) => {
		await takeLock(tx);
		await tx`create schema if not exists supabase_migrations`;
		await tx`create table if not exists supabase_migrations.schema_migrations (version text not null primary key)`;
		await tx`alter table supabase_migrations.schema_migrations add column if not exists statements text[], add column if not exists name text, add column if not exists created_by text`;
		return new Set(
			(await tx`select version from supabase_migrations.schema_migrations`).map(
				(row) => row.version
			)
		);
	});
	let applied = 0;

	for (const file of files) {
		const [, version, name] = /^([0-9]+)_(.*)\.sql$/.exec(file);

		if (recorded.has(version)) {
			continue;
		}

		const text = readFileSync(join(directory, file), 'utf8');

		const appliedHere = await sql.begin(async (tx) => {
			await takeLock(tx);
			// Read again under the lock: a build that held it first may have applied the file while this one waited.
			const [found] =
				await tx`select version from supabase_migrations.schema_migrations where version = ${version}`;
			if (found) {
				return false;
			}
			// The file whole, as one simple-protocol query (it holds several statements), then its ledger row.
			await tx.unsafe(text).simple();
			await tx`insert into supabase_migrations.schema_migrations (version, name) values (${version}, ${name})`;
			return true;
		});

		if (appliedHere) {
			applied += 1;
			console.log(`[tofu-migrate] applied ${file}`);
		} else {
			console.log(`[tofu-migrate] ${file} was applied by another build while this one waited`);
		}
	}

	console.log(
		`[tofu-migrate] ${applied} applied, ${files.length - applied} already recorded, ${files.length} files.`
	);
} catch (error) {
	failure = error;
}

if (failure) {
	// The message alone: a connection error object can carry the URL, and with it the password. Then exit as soon as it
	// is written, without closing the connection: postgres.js closes one it gives up on by half-closing its socket, which
	// keeps this process, and the build, alive until the server closes its end or TCP gives up. PostgreSQL rolls back a
	// transaction whose connection goes away, and the lock goes with it.
	const message = `[tofu-migrate] failed: ${failure instanceof Error ? failure.message : 'unknown error'}`;
	process.stderr.write(message + '\n', () => process.exit(1));
} else {
	// Close the connection, waiting at most 5 s for the server to close its end, then exit once the output is written:
	// the same half-closed socket would otherwise keep this process, and the build, alive when the server or the network
	// path never closes its end.
	await sql.end({ timeout: 5 });
	process.stdout.write('', () => process.exit(0));
}
