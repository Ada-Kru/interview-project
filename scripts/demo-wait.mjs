const endpoint = (
  process.env.LOCALSTACK_ENDPOINT_URL ?? 'http://localstack:4566'
).replace(/\/+$/, '');
const timeoutMs = Number(process.env.LOCALSTACK_WAIT_TIMEOUT_MS ?? 180_000);
const deadline = Date.now() + timeoutMs;

while (Date.now() < deadline) {
  try {
    const response = await fetch(`${endpoint}/_localstack/health`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (response.ok) {
      console.log(`LocalStack is ready at ${endpoint}`);
      process.exit(0);
    }
  } catch {
    // LocalStack is still starting up.
  }

  await new Promise((resolve) => setTimeout(resolve, 2_000));
}

console.error(
  `LocalStack did not become ready at ${endpoint} within ${timeoutMs}ms`
);
process.exit(1);
