import { randomUUID } from 'node:crypto';

const baseUrl = (
  process.env.DEMO_API_URL ?? 'http://localhost:8080'
).replace(/\/+$/, '');

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  let body;

  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} failed with HTTP ${response.status}: ${text}`
    );
  }

  return body;
}

async function main() {
  const listBefore = await request('/api/v1/locations');
  if (!Array.isArray(listBefore.items)) {
    throw new Error('Expected GET /api/v1/locations to return an items array');
  }

  const payload = {
    name: `Docker smoke ${randomUUID()}`,
    city: 'Seattle',
    state: 'WA',
    country: 'United States',
  };

  const created = await request('/api/v1/locations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (typeof created.id !== 'string' || created.id.length === 0) {
    throw new Error('Created location did not include an id');
  }

  for (const [key, value] of Object.entries(payload)) {
    if (created[key] !== value) {
      throw new Error(
        `Created location field "${key}" was ${JSON.stringify(created[key])}, expected ${JSON.stringify(value)}`
      );
    }
  }

  const fetched = await request(
    `/api/v1/locations/${encodeURIComponent(created.id)}`
  );

  if (fetched.id !== created.id) {
    throw new Error(`GET /api/v1/locations/${created.id} returned the wrong id`);
  }

  const listAfter = await request('/api/v1/locations?limit=100');
  if (
    !Array.isArray(listAfter.items) ||
    !listAfter.items.some(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        item.id === created.id
    )
  ) {
    throw new Error('Created location did not appear in the list response');
  }

  console.log(`Smoke test passed. Created location ${created.id}.`);
}

main().catch((error) => {
  console.error(
    `Smoke test failed: ${error instanceof Error ? error.message : error}`
  );
  process.exit(1);
});
