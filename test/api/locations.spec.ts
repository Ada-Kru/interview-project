import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { clearLocationsTable } from './helpers/locations-db';

const LOCATIONS_PATH = 'api/v1/locations';

const GEODATA_TIMEOUT = 30_000;
const COORDINATE_TOLERANCE = 0.25;

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
  status?: 'PENDING' | 'MATCHED' | 'NOT_FOUND' | 'ERROR';
};

type Coordinates = {
  latitude: number;
  longitude: number;
};

const SEATTLE_COORDINATES: Coordinates = {
  latitude: 47.6062,
  longitude: -122.3321,
};

const PORTLAND_OREGON_COORDINATES: Coordinates = {
  latitude: 45.5202,
  longitude: -122.6742,
};

const EUGENE_OREGON_COORDINATES: Coordinates = {
  latitude: 44.0505,
  longitude: -123.0951,
};

const PORTLAND_MAINE_COORDINATES: Coordinates = {
  latitude: 43.6574,
  longitude: -70.2587,
};

const CORDOBA_ARGENTINA_COORDINATES: Coordinates = {
  latitude: -31.4167,
  longitude: -64.1834,
};

const CORDOBA_SPAIN_COORDINATES: Coordinates = {
  latitude: 37.8846,
  longitude: -4.776,
};

const TORONTO_COORDINATES: Coordinates = {
  latitude: 43.6535,
  longitude: -79.3839,
};

function buildLocation(overrides: Partial<LocationPayload> = {}): LocationPayload {
  return {
    name: `Playwright location ${randomUUID()}`,
    city: 'Seattle',
    state: 'WA',
    country: 'United States',
    ...overrides,
  };
}

async function createLocation(
  request: APIRequestContext,
  overrides: Partial<LocationPayload> = {}
): Promise<{ payload: LocationPayload; body: LocationRecord & Record<string, unknown> }> {
  const payload = buildLocation(overrides);
  const response = await request.post(LOCATIONS_PATH, { data: payload });

  expect(response.status()).toBe(201);
  const body = (await response.json()) as LocationRecord & Record<string, unknown>;
  expect(body).toMatchObject(payload);
  expect(body.id).toEqual(expect.any(String));

  return { payload, body };
}

async function getLocation(
  request: APIRequestContext,
  id: string
): Promise<LocationRecord> {
  const response = await request.get(`${LOCATIONS_PATH}/${id}`);

  expect(response.status()).toBe(200);
  return (await response.json()) as LocationRecord;
}

async function patchLocation(
  request: APIRequestContext,
  id: string,
  patch: Partial<LocationPayload>
): Promise<LocationRecord> {
  const response = await request.patch(`${LOCATIONS_PATH}/${id}`, { data: patch });

  expect(response.status()).toBe(201);
  return (await response.json()) as LocationRecord;
}

function isWithinTolerance(
  actual: number | null,
  expected: number
): boolean {
  return actual !== null && Math.abs(actual - expected) <= COORDINATE_TOLERANCE;
}

async function waitForGeocodedLocation(
  request: APIRequestContext,
  id: string,
  expected: Coordinates,
  label: string
): Promise<LocationRecord> {
  let latest: LocationRecord | undefined;

  await expect
    .poll(
      async () => {
        latest = await getLocation(request, id);

        return (
          latest.status === 'MATCHED' &&
          isWithinTolerance(latest.latitude, expected.latitude) &&
          isWithinTolerance(latest.longitude, expected.longitude)
        );
      },
      {
        message: `Expected location ${id} (${label}) to be geocoded near ${expected.latitude}, ${expected.longitude}`,
        timeout: GEODATA_TIMEOUT,
        intervals: [500, 1_000, 2_000],
      }
    )
    .toBe(true);

  return latest as LocationRecord;
}

function expectCoordinatesNear(
  location: LocationRecord,
  expected: Coordinates,
  label: string
): void {
  expect(location.latitude, `${label}: latitude`).not.toBeNull();
  expect(location.longitude, `${label}: longitude`).not.toBeNull();

  expect(
    Math.abs((location.latitude as number) - expected.latitude),
    `${label}: latitude should be near ${expected.latitude}`
  ).toBeLessThanOrEqual(COORDINATE_TOLERANCE);

  expect(
    Math.abs((location.longitude as number) - expected.longitude),
    `${label}: longitude should be near ${expected.longitude}`
  ).toBeLessThanOrEqual(COORDINATE_TOLERANCE);
}

function expectCoordinatesChanged(
  updated: LocationRecord,
  original: LocationRecord,
  label: string
): void {
  expect(updated.latitude, `${label}: latitude`).not.toBeNull();
  expect(updated.longitude, `${label}: longitude`).not.toBeNull();

  expect(updated.latitude, `${label}: latitude should change`).not.toBe(
    original.latitude
  );
  expect(updated.longitude, `${label}: longitude should change`).not.toBe(
    original.longitude
  );
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

test.describe('OpenStreetMap geocoding', () => {
  test.describe.configure({ timeout: 90_000 });

  test('POST /api/v1/locations populates latitude and longitude from OpenStreetMap', async ({
    request,
  }) => {
    const { body: created } = await createLocation(request);

    const geocoded = await waitForGeocodedLocation(
      request,
      created.id,
      SEATTLE_COORDINATES,
      'Seattle, Washington, United States'
    );

    expect(geocoded).toMatchObject({
      id: created.id,
      city: 'Seattle',
      state: 'WA',
      country: 'United States',
      status: 'MATCHED',
    });
    expectCoordinatesNear(
      geocoded,
      SEATTLE_COORDINATES,
      'created Seattle location'
    );
  });

  test('PATCH /api/v1/locations/:id refreshes coordinates when only the city changes', async ({
    request,
  }) => {
    const { body: created } = await createLocation(request, {
      city: 'Portland',
      state: 'Oregon',
      country: 'United States',
    });

    const initial = await waitForGeocodedLocation(
      request,
      created.id,
      PORTLAND_OREGON_COORDINATES,
      'Portland, Oregon, United States'
    );

    const patched = await patchLocation(request, created.id, {
      city: 'Eugene',
    });
    expect(patched).toMatchObject({
      id: created.id,
      city: 'Eugene',
      state: 'Oregon',
      country: 'United States',
      status: 'PENDING',
      latitude: null,
      longitude: null,
    });

    const updated = await waitForGeocodedLocation(
      request,
      created.id,
      EUGENE_OREGON_COORDINATES,
      'Eugene, Oregon, United States'
    );

    expect(updated).toMatchObject({
      id: created.id,
      city: 'Eugene',
      state: 'Oregon',
      country: 'United States',
      status: 'MATCHED',
    });
    expectCoordinatesNear(
      updated,
      EUGENE_OREGON_COORDINATES,
      'updated Eugene location'
    );
    expectCoordinatesChanged(updated, initial, 'city-only update');
  });

  test('PATCH /api/v1/locations/:id refreshes coordinates when only the state changes', async ({
    request,
  }) => {
    const { body: created } = await createLocation(request, {
      city: 'Portland',
      state: 'Oregon',
      country: 'United States',
    });

    const initial = await waitForGeocodedLocation(
      request,
      created.id,
      PORTLAND_OREGON_COORDINATES,
      'Portland, Oregon, United States'
    );

    const patched = await patchLocation(request, created.id, {
      state: 'Maine',
    });
    expect(patched).toMatchObject({
      id: created.id,
      city: 'Portland',
      state: 'Maine',
      country: 'United States',
      status: 'PENDING',
      latitude: null,
      longitude: null,
    });

    const updated = await waitForGeocodedLocation(
      request,
      created.id,
      PORTLAND_MAINE_COORDINATES,
      'Portland, Maine, United States'
    );

    expect(updated).toMatchObject({
      id: created.id,
      city: 'Portland',
      state: 'Maine',
      country: 'United States',
      status: 'MATCHED',
    });
    expectCoordinatesNear(
      updated,
      PORTLAND_MAINE_COORDINATES,
      'updated Portland, Maine location'
    );
    expectCoordinatesChanged(updated, initial, 'state-only update');
  });

  test('PATCH /api/v1/locations/:id refreshes coordinates when only the country changes', async ({
    request,
  }) => {
    const { body: created } = await createLocation(request, {
      city: 'Cordoba',
      state: 'Cordoba',
      country: 'Argentina',
    });

    const initial = await waitForGeocodedLocation(
      request,
      created.id,
      CORDOBA_ARGENTINA_COORDINATES,
      'Cordoba, Cordoba, Argentina'
    );

    const patched = await patchLocation(request, created.id, {
      country: 'Spain',
    });
    expect(patched).toMatchObject({
      id: created.id,
      city: 'Cordoba',
      state: 'Cordoba',
      country: 'Spain',
      status: 'PENDING',
      latitude: null,
      longitude: null,
    });

    const updated = await waitForGeocodedLocation(
      request,
      created.id,
      CORDOBA_SPAIN_COORDINATES,
      'Cordoba, Cordoba, Spain'
    );

    expect(updated).toMatchObject({
      id: created.id,
      city: 'Cordoba',
      state: 'Cordoba',
      country: 'Spain',
      status: 'MATCHED',
    });
    expectCoordinatesNear(
      updated,
      CORDOBA_SPAIN_COORDINATES,
      'updated Cordoba, Spain location'
    );
    expectCoordinatesChanged(updated, initial, 'country-only update');
  });

  test('PATCH /api/v1/locations/:id refreshes coordinates when city, state, and country all change', async ({
    request,
  }) => {
    const { body: created } = await createLocation(request);

    const initial = await waitForGeocodedLocation(
      request,
      created.id,
      SEATTLE_COORDINATES,
      'Seattle, Washington, United States'
    );

    const patched = await patchLocation(request, created.id, {
      city: 'Toronto',
      state: 'Ontario',
      country: 'Canada',
    });
    expect(patched).toMatchObject({
      id: created.id,
      city: 'Toronto',
      state: 'Ontario',
      country: 'Canada',
      status: 'PENDING',
      latitude: null,
      longitude: null,
    });

    const updated = await waitForGeocodedLocation(
      request,
      created.id,
      TORONTO_COORDINATES,
      'Toronto, Ontario, Canada'
    );

    expect(updated).toMatchObject({
      id: created.id,
      city: 'Toronto',
      state: 'Ontario',
      country: 'Canada',
      status: 'MATCHED',
    });
    expectCoordinatesNear(
      updated,
      TORONTO_COORDINATES,
      'updated Toronto location'
    );
    expectCoordinatesChanged(updated, initial, 'city/state/country update');
  });

  test('PATCH /api/v1/locations/:id persists new casing without refreshing coordinates', async ({
    request,
  }) => {
    const { body: created } = await createLocation(request, {
      city: 'Portland',
      state: 'Oregon',
      country: 'United States',
    });

    const initial = await waitForGeocodedLocation(
      request,
      created.id,
      PORTLAND_OREGON_COORDINATES,
      'Portland, Oregon, United States'
    );

    const patched = await patchLocation(request, created.id, {
      city: 'PORTLAND',
    });

    expect(patched).toMatchObject({
      id: created.id,
      city: 'PORTLAND',
      state: 'Oregon',
      country: 'United States',
      status: 'MATCHED',
      latitude: initial.latitude,
      longitude: initial.longitude,
    });

    const fetched = await getLocation(request, created.id);
    expect(fetched).toMatchObject({
      city: 'PORTLAND',
      status: 'MATCHED',
      latitude: initial.latitude,
      longitude: initial.longitude,
    });
  });

  test('PATCH /api/v1/locations/:id trims whitespace and does not refresh coordinates', async ({
    request,
  }) => {
    const { body: created } = await createLocation(request, {
      city: 'Portland',
      state: 'Oregon',
      country: 'United States',
    });

    const initial = await waitForGeocodedLocation(
      request,
      created.id,
      PORTLAND_OREGON_COORDINATES,
      'Portland, Oregon, United States'
    );

    const patched = await patchLocation(request, created.id, {
      city: '  Portland  ',
    });

    expect(patched).toMatchObject({
      id: created.id,
      city: 'Portland',
      state: 'Oregon',
      country: 'United States',
      status: 'MATCHED',
      latitude: initial.latitude,
      longitude: initial.longitude,
    });
  });
});
