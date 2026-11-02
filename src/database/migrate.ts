import { readFile } from 'node:fs/promises';
import { executeStatement } from './locationsDataApi';

const OUTPUT_FILE = process.env.DEMO_OUTPUTS_FILE ??
                     '/tmp/demo/outputs.json';

const loadDatabaseEnv = async (): Promise<void> => {
  if (
    process.env.DATABASE_ARN &&
    process.env.DATABASE_SECRET_ARN &&
    process.env.LOCATIONS_DB_NAME
  ) {
    return;
  }

  const raw = JSON.parse(
    await readFile(OUTPUT_FILE, 'utf8'),
  ) as Record<string, Record<string, string>>;

  const outputs = raw.InterviewProjectStack ??
                  Object.values(raw)[0];

  if (!outputs) {
    throw new Error(`Could not find outputs in ${OUTPUT_FILE}`);
  }

  process.env.DATABASE_ARN ??= outputs.DatabaseClusterArn;
  process.env.DATABASE_SECRET_ARN ??= outputs.DatabaseSecretArn;
  process.env.LOCATIONS_DB_NAME ??= outputs.LocationsDbName;
};

const main = async (): Promise<void> => {
  await loadDatabaseEnv();

  await executeStatement(`
    CREATE TABLE IF NOT EXISTS locations (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name text NOT NULL,
      city text NOT NULL,
      state text NOT NULL,
      country text NOT NULL,
      latitude double precision,
      longitude double precision,
      geodata_status text NOT NULL DEFAULT 'PENDING'
        CHECK (geodata_status IN ('MATCHED', 'NOT_FOUND', 'PENDING', 'ERROR')),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await executeStatement(`
    CREATE INDEX IF NOT EXISTS locations_created_at_id_idx
      ON locations (created_at DESC, id DESC)
  `);

  if (process.argv.includes('--reset')) {
    await executeStatement('TRUNCATE TABLE locations RESTART IDENTITY');
    console.log('Cleared locations table');
  }

  console.log('Locations table ready');
};

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
