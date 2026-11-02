#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const endpoint = (
  process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566'
).replace(/\/+$/, '');
const region =
  process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';

const env = {
  ...process.env,
  AWS_ENDPOINT_URL: endpoint,
  AWS_ENDPOINT_URL_S3: process.env.AWS_ENDPOINT_URL_S3 ?? endpoint,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'test',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  AWS_REGION: region,
  AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION ?? region,
  CDK_DEFAULT_ACCOUNT: process.env.CDK_DEFAULT_ACCOUNT ?? '000000000000',
  CDK_DEFAULT_REGION: process.env.CDK_DEFAULT_REGION ?? region,
  CDK_S3_FORCE_PATH_STYLE: process.env.CDK_S3_FORCE_PATH_STYLE ?? '1',
  CDK_CLI_TELEMETRY: process.env.CDK_CLI_TELEMETRY ?? 'false',
  DATABASE_MODE: process.env.DATABASE_MODE ?? 'local',
};

const cdkBin = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'cdk.cmd' : 'cdk'
);

const result = spawnSync(cdkBin, process.argv.slice(2), {
  cwd: projectRoot,
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
