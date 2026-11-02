import { readFile } from 'node:fs/promises';
import {
  ExecuteStatementCommand,
  RDSDataClient,
} from '@aws-sdk/client-rds-data';

const DEFAULT_ENDPOINT = 'http://localhost:4566';
const DEFAULT_ENV_FILE = '/tmp/demo/database.env';
const REQUIRED_ENV_VARS = [
  'DATABASE_ARN',
  'DATABASE_SECRET_ARN',
  'LOCATIONS_DB_NAME',
] as const;

type RequiredEnvVar = typeof REQUIRED_ENV_VARS[number];

const endpoint =
  process.env.AWS_ENDPOINT_URL_RDS_DATA ??
  process.env.AWS_ENDPOINT_URL ??
  DEFAULT_ENDPOINT;
const region =
  process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
const envFile = process.env.DEMO_DATABASE_ENV_FILE ?? DEFAULT_ENV_FILE;

const client = new RDSDataClient({
  endpoint,
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    ...(process.env.AWS_SESSION_TOKEN
      ? { sessionToken: process.env.AWS_SESSION_TOKEN }
      : {}),
  },
});

/**
 * Loads the local Aurora connection details written by `scripts/local-db.ts`
 * when they are not already present in the process environment.
 */
async function loadDatabaseEnv(): Promise<void> {
  if (REQUIRED_ENV_VARS.every((name) => process.env[name])) {
    return;
  }

  const contents = await readFile(envFile, 'utf8');

  for (const line of contents.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());

    if (match) {
      process.env[match[1]] ??= match[2];
    }
  }

  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Missing database environment variable(s): ${missing.join(', ')}. ` +
        `Set them or create ${envFile}.`
    );
  }
}

function getEnv(name: RequiredEnvVar): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

/**
 * Deletes every location in the database.
 *
 * Used before each API test so tests do not depend on data left behind by
 * earlier runs. The table itself (and the deployed stack) stays intact.
 */
export async function clearLocationsTable(): Promise<void> {
  await loadDatabaseEnv();

  await client.send(
    new ExecuteStatementCommand({
      resourceArn: getEnv('DATABASE_ARN'),
      secretArn: getEnv('DATABASE_SECRET_ARN'),
      database: getEnv('LOCATIONS_DB_NAME'),
      sql: 'TRUNCATE TABLE locations RESTART IDENTITY',
    })
  );
}
