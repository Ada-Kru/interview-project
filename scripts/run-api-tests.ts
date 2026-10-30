import { execFileSync, spawnSync } from 'node:child_process';
import * as path from 'node:path';

interface RestApi {
  id: string;
  name?: string;
}

const DEFAULT_ENDPOINT = 'http://localhost:4566';
const DEFAULT_STAGE = 'prod';
const API_NAME_HINT = 'LocationsProxyApi';

const endpoint = (
  process.env.LOCALSTACK_ENDPOINT_URL ??
  process.env.AWS_ENDPOINT_URL ??
  DEFAULT_ENDPOINT
).replace(/\/+$/, '');
const region =
  process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
const stage = process.env.API_STAGE ?? DEFAULT_STAGE;

function awsCommandEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    AWS_DEFAULT_REGION: region,
  };
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const stderr = (error as Error & { stderr?: Buffer | string }).stderr;
  if (stderr && stderr.toString().trim().length > 0) {
    return stderr.toString().trim();
  }

  return error.message;
}

function runAws(args: string[]): string {
  const env = awsCommandEnv();
  const options = {
    encoding: 'utf8' as const,
    env,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
  };

  try {
    return execFileSync('lstk', ['aws', ...args], options);
  } catch (lstkError) {
    try {
      return execFileSync(
        'aws',
        ['--endpoint-url', endpoint, ...args],
        options
      );
    } catch (awsError) {
      throw new Error(
        [
          `Could not query LocalStack at ${endpoint}.`,
          'Make sure the emulator is running and the stack is deployed:',
          '  npm run local-deploy',
          '',
          `lstk error: ${describeError(lstkError)}`,
          `aws error: ${describeError(awsError)}`,
        ].join('\n')
      );
    }
  }
}

function parseJson<T>(output: string): T {
  const trimmed = output.trim();

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`Unexpected AWS CLI output:\n${trimmed}`);
    }
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  }
}

function resolveBaseUrl(): string {
  if (process.env.API_BASE_URL) {
    return process.env.API_BASE_URL.replace(/\/+$/, '');
  }

  const raw = runAws([
    'apigateway',
    'get-rest-apis',
    '--region',
    region,
    '--output',
    'json',
  ]);
  const apis = parseJson<{ items?: RestApi[] }>(raw).items ?? [];

  if (apis.length === 0) {
    throw new Error(
      [
        `No REST APIs found in LocalStack at ${endpoint}.`,
        'Deploy the stack first:',
        '  npm run local-deploy',
      ].join('\n')
    );
  }

  const requestedName = process.env.API_NAME;
  const selected = requestedName
    ? apis.find((api) => api.name === requestedName)
    : apis.find((api) => api.name?.includes(API_NAME_HINT));

  const api = selected ?? (apis.length === 1 ? apis[0] : undefined);

  if (!api) {
    throw new Error(
      [
        `Could not identify the locations API among ${apis.length} REST APIs.`,
        'Set API_NAME (or API_BASE_URL) to choose one. Available APIs:',
        ...apis.map((candidate) => `  - ${candidate.name ?? '(unnamed)'} (${candidate.id})`),
      ].join('\n')
    );
  }

  return `${endpoint}/restapis/${api.id}/${stage}/_user_request_`;
}

function runPlaywright(baseURL: string, args: string[]): number {
  const playwrightBin = path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'playwright.cmd' : 'playwright'
  );

  const result = spawnSync(playwrightBin, ['test', ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      API_BASE_URL: baseURL,
    },
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

try {
  const baseURL = resolveBaseUrl();
  console.log(`Running API tests against ${baseURL}`);
  process.exit(runPlaywright(baseURL, process.argv.slice(2)));
} catch (error) {
  console.error(describeError(error));
  process.exit(1);
}
