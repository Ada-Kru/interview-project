import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import {
  APIGatewayClient,
  GetRestApisCommand,
} from '@aws-sdk/client-api-gateway';

interface RestApi {
  id?: string;
  name?: string;
}

const DEFAULT_ENDPOINT = 'http://localhost:4566';
const DEFAULT_STAGE = 'prod';
const API_NAME_HINT = 'LocationsProxyApi';

const endpoint = (
  process.env.AWS_ENDPOINT_URL ?? DEFAULT_ENDPOINT
).replace(/\/+$/, '');
const region =
  process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
const stage = process.env.API_STAGE ?? DEFAULT_STAGE;

const apiGateway = new APIGatewayClient({
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

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  return error.message;
}

async function resolveBaseUrl(): Promise<string> {
  if (process.env.API_BASE_URL) {
    return process.env.API_BASE_URL.replace(/\/+$/, '');
  }

  let apis: RestApi[];

  try {
    const result = await apiGateway.send(new GetRestApisCommand({}));
    apis = result.items ?? [];
  } catch (error) {
    throw new Error(
      [
        `Could not query MiniStack at ${endpoint}.`,
        'Make sure the emulator is running and the stack is deployed:',
        '  docker compose up -d ministack',
        '  npm run local-deploy',
        '',
        `error: ${describeError(error)}`,
      ].join('\n')
    );
  }

  if (apis.length === 0) {
    throw new Error(
      [
        `No REST APIs found in MiniStack at ${endpoint}.`,
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

  if (!api?.id) {
    throw new Error(
      [
        `Could not identify the locations API among ${apis.length} REST APIs.`,
        'Set API_NAME (or API_BASE_URL) to choose one. Available APIs:',
        ...apis.map(
          (candidate) =>
            `  - ${candidate.name ?? '(unnamed)'} (${candidate.id ?? 'unknown'})`
        ),
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

async function main(): Promise<void> {
  try {
    const baseURL = await resolveBaseUrl();
    console.log(`Running API tests against ${baseURL}`);
    process.exit(runPlaywright(baseURL, process.argv.slice(2)));
  } catch (error) {
    console.error(describeError(error));
    process.exit(1);
  }
}

void main();
