const endpoint = (
  process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566'
).replace(/\/+$/, '');
const timeoutMs = Number(process.env.MINISTACK_WAIT_TIMEOUT_MS ?? 180_000);
const deadline = Date.now() + timeoutMs;

while (Date.now() < deadline) {
  try {
    const response = await fetch(`${endpoint}/_ministack/health`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (response.ok) {
      console.log(`MiniStack is ready at ${endpoint}`);
      process.exit(0);
    }
  } catch {
    // MiniStack is still starting up.
  }

  await new Promise((resolve) => setTimeout(resolve, 2_000));
}

console.error(
  `MiniStack did not become ready at ${endpoint} within ${timeoutMs}ms`
);
process.exit(1);
