// Tofu (new file, 2026-10-25): applies supabase/migrations at the start of the build (see TOFU.md, Schema).
//
// Each file the database's migration ledger does not record yet (the Supabase CLI's own
// supabase_migrations.schema_migrations, created the way Tofu creates it) is applied in file-name order, each in one
// transaction with its ledger row, so neither this script, Tofu nor the Supabase CLI ever runs a file twice. Without
// DATABASE_URL it applies nothing, so a build anywhere else (upstream's Docker image, a laptop) is unchanged. It uses
// the app's own driver (postgres.js) with unnamed statements, which Tofu's transaction pooler accepts.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

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

try {
	await sql`create schema if not exists supabase_migrations`;
	await sql`create table if not exists supabase_migrations.schema_migrations (version text not null primary key)`;
	await sql`alter table supabase_migrations.schema_migrations add column if not exists statements text[], add column if not exists name text, add column if not exists created_by text`;

	const recorded = new Set(
		(await sql`select version from supabase_migrations.schema_migrations`).map((row) => row.version)
	);
	let applied = 0;

	for (const file of files) {
		const [, version, name] = /^([0-9]+)_(.*)\.sql$/.exec(file);

		if (recorded.has(version)) {
			continue;
		}

		const text = readFileSync(join(directory, file), 'utf8');

		await sql.begin(async (tx) => {
			// The ledger row goes in first, so a build racing this one stops on its primary key instead of applying twice.
			await tx`insert into supabase_migrations.schema_migrations (version, name) values (${version}, ${name})`;
			// The file whole, as one simple-protocol query (it holds several statements).
			await tx.unsafe(text).simple();
		});

		applied += 1;
		console.log(`[tofu-migrate] applied ${file}`);
	}

	console.log(
		`[tofu-migrate] ${applied} applied, ${files.length - applied} already recorded, ${files.length} files.`
	);
} catch (error) {
	// The message alone: a connection error object can carry the URL, and with it the password.
	console.error(`[tofu-migrate] failed: ${error instanceof Error ? error.message : 'unknown error'}`);
	process.exitCode = 1;
} finally {
	await sql.end({ timeout: 5 });
}
