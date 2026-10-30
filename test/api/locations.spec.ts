import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { clearLocationsTable } from './helpers/locations-db';

// Relative (no leading slash) so Playwright keeps the API_BASE_URL path prefix.
const LOCATIONS_PATH = 'api/v1/locations';

type LocationPayload = {
  name: string;
  city: string;
  state: string;
  country: string;
};

type LocationRecord = LocationPayload & {
  id: string;
  latitude: number | null;
  longitude: number | null;
};

function buildLocation(): LocationPayload {
  return {
    name: `Playwright location ${randomUUID()}`,
    city: 'Seattle',
    state: 'WA',
    country: 'United States',
  };
}

async function createLocation(
  request: APIRequestContext
): Promise<{ payload: LocationPayload; body: LocationRecord & Record<string, unknown> }> {
  const payload = buildLocation();
  const response = await request.post(LOCATIONS_PATH, { data: payload });

  expect(response.status()).toBe(201);
  const body = (await response.json()) as LocationRecord & Record<string, unknown>;
  expect(body).toMatchObject(payload);
  expect(body.id).toEqual(expect.any(String));

  return { payload, body };
}

async function listAllLocations(request: APIRequestContext): Promise<LocationRecord[]> {
  const items: LocationRecord[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < 100; page++) {
    const response = nextToken
      ? await request.get(LOCATIONS_PATH, { params: { nextToken } })
      : await request.get(LOCATIONS_PATH);

    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      items: LocationRecord[];
      nextToken: string | null;
    };

    items.push(...body.items);

    if (!body.nextToken) {
      return items;
    }

    nextToken = body.nextToken;
  }

  throw new Error('Location pagination did not terminate');
}

test.beforeEach(async () => {
  await clearLocationsTable();
});

test.afterAll(async () => {
  await clearLocationsTable();
});

test('POST /api/v1/locations creates a location', async ({ request }) => {
  const { payload, body } = await createLocation(request);

  expect(body).toMatchObject(payload);
  expect(body.createdAt).toEqual(expect.any(String));
  expect(body.status).toBe('PENDING');
  expect(body.latitude).toBeNull();
  expect(body.longitude).toBeNull();
});

test('GET /api/v1/locations returns the created location', async ({ request }) => {
  const { body: created } = await createLocation(request);

  await expect
    .poll(
      async () => {
        const locations = await listAllLocations(request);
        return locations.some((location) => location.id === created.id);
      },
      {
        message: `Expected location ${created.id} to appear in GET ${LOCATIONS_PATH}`,
        timeout: 10_000,
      }
    )
    .toBe(true);
});

test('GET /api/v1/locations/:id returns the created location', async ({ request }) => {
  const { payload, body: created } = await createLocation(request);

  const response = await request.get(`${LOCATIONS_PATH}/${created.id}`);

  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    id: created.id,
    ...payload,
  });
});
