import http from 'node:http';
import { readFile } from 'node:fs/promises';

const endpoint = (
  process.env.LOCALSTACK_ENDPOINT_URL ?? 'http://localstack:4566'
).replace(/\/+$/, '');
const outputsFile =
  process.env.DEMO_OUTPUTS_FILE ??
  `${process.env.DEMO_STATE_DIR ?? '/tmp/demo'}/outputs.json`;
const port = Number(process.env.DEMO_API_PORT ?? 8080);
const defaultStage = process.env.DEMO_API_STAGE ?? 'prod';

async function loadApi() {
  const raw = JSON.parse(await readFile(outputsFile, 'utf8'));
  const entry = raw.InterviewProjectStack ?? Object.values(raw)[0];
  const outputs =
    entry && typeof entry === 'object' ? entry : {};

  let apiId =
    typeof outputs.DemoApiId === 'string' ? outputs.DemoApiId : undefined;
  const apiStage =
    typeof outputs.DemoApiStage === 'string' && outputs.DemoApiStage
      ? outputs.DemoApiStage
      : defaultStage;

  if (!apiId) {
    for (const value of Object.values(outputs)) {
      if (typeof value !== 'string') {
        continue;
      }

      const match = value.match(/^https?:\/\/([^.]+)\.execute-api\./);
      if (match) {
        apiId = match[1];
        break;
      }
    }
  }

  if (!apiId) {
    throw new Error(`Could not find the demo API ID in ${outputsFile}`);
  }

  return { apiId, apiStage };
}

const { apiId, apiStage } = await loadApi();
const upstreamPrefix = `/restapis/${apiId}/${apiStage}/_user_request_`;

async function waitForApi() {
  const timeoutMs = Number(process.env.DEMO_API_WAIT_TIMEOUT_MS ?? 120_000);
  const deadline = Date.now() + timeoutMs;
  const url = `${endpoint}${upstreamPrefix}/api/v1/locations`;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5_000),
      });

      if (response.ok) {
        return;
      }

      console.log(`API not ready yet (HTTP ${response.status}); retrying...`);
    } catch (error) {
      console.log(
        `API not ready yet (${error instanceof Error ? error.message : error}); retrying...`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(`Demo API did not become ready at ${url}`);
}

await waitForApi();

const server = http.createServer((request, response) => {
  const requestUrl = request.url ?? '/';

  if (requestUrl === '/health' || requestUrl === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', apiId, stage: apiStage }));
    return;
  }

  if (requestUrl === '/') {
    response.writeHead(302, { location: '/api/v1/locations' });
    response.end();
    return;
  }

  const target = new URL(`${endpoint}${upstreamPrefix}${requestUrl}`);
  const headers = { ...request.headers, host: target.host };
  delete headers.connection;

  console.log(`${request.method} ${requestUrl} -> ${target.pathname}`);

  const upstream = http.request(
    target,
    { method: request.method, headers },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers
      );
      upstreamResponse.pipe(response);
    }
  );

  upstream.on('error', (error) => {
    console.error(
      `Gateway error for ${request.method} ${requestUrl}: ${error.message}`
    );

    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'application/json' });
    }

    response.end(JSON.stringify({ error: 'Demo API upstream request failed' }));
  });

  request.pipe(upstream);
});

server.listen(port, '0.0.0.0', () => {
  console.log(
    `Demo API listening on http://localhost:${port} (API ${apiId}, stage ${apiStage})`
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
