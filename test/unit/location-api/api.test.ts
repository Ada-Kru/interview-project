import type { Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import {
  ExecuteStatementCommand,
  RDSDataClient,
  type ColumnMetadata,
  type Field,
} from '@aws-sdk/client-rds-data';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { handler } from '../../../src/lambda-functions/location-api/api';
import { makeApiEvent } from '../helpers/api-event';

const rdsMock = mockClient(RDSDataClient);
const sqsMock = mockClient(SQSClient);

const context = {} as Context;

type LocationRow = {
  id: number;
  name: string;
  city: string;
  state: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  geodataStatus: string;
  createdAt: string;
};

const LOCATION_COLUMN_NAMES = [
  'id',
  'name',
  'city',
  'state',
  'country',
  'latitude',
  'longitude',
  'geodata_status',
  'created_at',
];

const seattleLocation: LocationRow = {
  id: 1,
  name: 'Seattle Center',
  city: 'Seattle',
  state: 'WA',
  country: 'United States',
  latitude: null,
  longitude: null,
  geodataStatus: 'PENDING',
  createdAt: '2026-01-02T03:04:05.000Z',
};

const locationResult = (rows: LocationRow[]) => ({
  columnMetadata: LOCATION_COLUMN_NAMES.map(
    (name) => ({ name }),
  ) as ColumnMetadata[],
  records: rows.map(
    (row) =>
      [
        { longValue: row.id },
        { stringValue: row.name },
        { stringValue: row.city },
        { stringValue: row.state },
        { stringValue: row.country },
        row.latitude === null
          ? { isNull: true }
          : { doubleValue: row.latitude },
        row.longitude === null
          ? { isNull: true }
          : { doubleValue: row.longitude },
        { stringValue: row.geodataStatus },
        { stringValue: row.createdAt },
      ] as Field[],
  ),
});

const countResult = (total: number) => ({
  columnMetadata: [{ name: 'total' }] as ColumnMetadata[],
  records: [[{ longValue: total }]] as Field[][],
});

beforeEach(() => {
  rdsMock.reset();
  sqsMock.reset();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/v1/locations/:id', () => {
  it('returns 404 when the location does not exist', async () => {
    rdsMock.on(ExecuteStatementCommand).resolves(locationResult([]));

    const result = await handler(
      makeApiEvent({
        path: '/api/v1/locations/999',
        resource: '/api/v1/locations/{id}',
        pathParameters: { id: '999' },
      }),
      context,
    );

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Location not found' });
    expect(rdsMock.commandCalls(ExecuteStatementCommand)).toHaveLength(1);
  });

  it('returns 500 when the database read fails', async () => {
    rdsMock.on(ExecuteStatementCommand).rejects(new Error('boom'));

    const result = await handler(
      makeApiEvent({
        path: '/api/v1/locations/1',
        resource: '/api/v1/locations/{id}',
        pathParameters: { id: '1' },
      }),
      context,
    );

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Failed to fetch location',
    });
  });
});

describe('GET /api/v1/locations', () => {
  it('returns a page of locations and the total count', async () => {
    rdsMock.on(ExecuteStatementCommand).callsFake((input) =>
      Promise.resolve(
        input.sql.includes('COUNT(*)')
          ? countResult(1)
          : locationResult([seattleLocation]),
      ),
    );

    const result = await handler(
      makeApiEvent({
        queryStringParameters: { page: '1', pageSize: '10' },
      }),
      context,
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      items: [
        {
          id: 1,
          name: 'Seattle Center',
          city: 'Seattle',
          state: 'WA',
          country: 'United States',
          latitude: null,
          longitude: null,
          createdAt: '2026-01-02T03:04:05.000Z',
        },
      ],
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
  });

  it('returns 422 for invalid pagination without querying', async () => {
    const result = await handler(
      makeApiEvent({
        queryStringParameters: { page: 'abc' },
      }),
      context,
    );

    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body)).toMatchObject({
      statusCode: 422,
      error: 'RequestValidationError',
    });
    expect(rdsMock.commandCalls(ExecuteStatementCommand)).toHaveLength(0);
  });
});

describe('POST /api/v1/locations', () => {
  it('creates a location and enqueues geocoding', async () => {
    rdsMock.on(ExecuteStatementCommand).callsFake((input) =>
      Promise.resolve(
        input.sql.includes('lower(btrim(name))')
          ? locationResult([])
          : locationResult([seattleLocation]),
      ),
    );
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-1' });

    const result = await handler(
      makeApiEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          name: 'Seattle Center',
          city: 'Seattle',
          state: 'WA',
          country: 'United States',
        }),
      }),
      context,
    );

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toEqual(seattleLocation);

    expect(rdsMock.commandCalls(ExecuteStatementCommand)).toHaveLength(2);
    expect(
      rdsMock.commandCalls(ExecuteStatementCommand).filter(
        (call) => call.args?.[0]?.input?.sql?.includes('INSERT INTO locations'),
      ),
    ).toHaveLength(1);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
  });

  it('rejects an invalid payload without writing or enqueueing', async () => {
    const result = await handler(
      makeApiEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ name: 'ab' }),
      }),
      context,
    );

    expect(result.statusCode).toBe(422);
    expect(rdsMock.commandCalls(ExecuteStatementCommand)).toHaveLength(0);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  const validPayload = {
    name: 'Seattle Center',
    city: 'Seattle',
    state: 'WA',
    country: 'United States',
  };

  it('rejects a duplicate location with the same name, city, state, and country', async () => {
    rdsMock.on(ExecuteStatementCommand).callsFake((input) =>
      Promise.resolve(
        input.sql.includes('lower(btrim(name))')
          ? locationResult([{
              ...seattleLocation,
              id: 42,
              name: 'seattle center',
              city: 'seattle',
              state: 'wa',
              country: 'united states',
            }])
          : locationResult([seattleLocation]),
      ),
    );

    const result = await handler(
      makeApiEvent({
        httpMethod: 'POST',
        body: JSON.stringify(validPayload),
      }),
      context,
    );

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toContain('42');
    expect(
      rdsMock.commandCalls(ExecuteStatementCommand).filter(
        (call) => call.args?.[0]?.input?.sql?.includes('INSERT INTO locations'),
      ),
    ).toHaveLength(0);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it('allows the same name in a different city', async () => {
    rdsMock.on(ExecuteStatementCommand).callsFake((input) =>
      Promise.resolve(
        input.sql.includes('lower(btrim(name))')
          ? locationResult([])
          : locationResult([seattleLocation]),
      ),
    );
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-1' });

    const result = await handler(
      makeApiEvent({
        httpMethod: 'POST',
        body: JSON.stringify(validPayload),
      }),
      context,
    );

    expect(result.statusCode).toBe(201);
    expect(
      rdsMock.commandCalls(ExecuteStatementCommand).filter(
        (call) => call.args?.[0]?.input?.sql?.includes('INSERT INTO locations'),
      ),
    ).toHaveLength(1);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
  });
});

const storedLocation: LocationRow = {
  id: 1,
  name: 'Seattle Center',
  city: 'Seattle',
  state: 'WA',
  country: 'United States',
  latitude: 47.6062,
  longitude: -122.3321,
  createdAt: '2026-01-01T00:00:00.000Z',
  geodataStatus: 'MATCHED',
};

const patchLocation = (id: number, body: unknown) =>
  makeApiEvent({
    httpMethod: 'PATCH',
    path: `/api/v1/locations/${id}`,
    resource: '/api/v1/locations/{id}',
    pathParameters: { id: String(id) },
    body: JSON.stringify(body),
  });

describe('PATCH /api/v1/locations/:id duplicate detection', () => {
  it('rejects a patch that duplicates another location', async () => {
    rdsMock.on(ExecuteStatementCommand)
      .resolvesOnce(locationResult([storedLocation]))
      .resolvesOnce(locationResult([{
        ...storedLocation,
        id: 2,
        name: 'portland branch',
        city: 'portland',
        state: 'or',
        country: 'united states',
      }]));

    const result = await handler(
      patchLocation(1, {
        name: 'Portland Branch',
        city: 'Portland',
        state: 'OR',
      }),
      context,
    );

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toContain('2');
    expect(
      rdsMock.commandCalls(ExecuteStatementCommand).filter(
        (call) => call.args?.[0]?.input?.sql?.includes('UPDATE locations'),
      ),
    ).toHaveLength(0);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it('allows changing only the casing of its own name', async () => {
    rdsMock.on(ExecuteStatementCommand)
      .resolvesOnce(locationResult([storedLocation]))
      .resolvesOnce(locationResult([{
        ...storedLocation,
        name: 'SEATTLE CENTER',
      }]));

    const result = await handler(
      patchLocation(1, { name: 'SEATTLE CENTER' }),
      context,
    );

    expect(result.statusCode).toBe(200);
    expect(
      rdsMock.commandCalls(ExecuteStatementCommand).filter(
        (call) => call.args?.[0]?.input?.sql?.includes('lower(btrim(name))'),
      ),
    ).toHaveLength(0);
    expect(
      rdsMock.commandCalls(ExecuteStatementCommand).filter(
        (call) => call.args?.[0]?.input?.sql?.includes('UPDATE locations'),
      ),
    ).toHaveLength(1);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });
});
