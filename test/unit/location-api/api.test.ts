import type { Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { handler } from '../../../src/lambda-functions/location-api/api';
import { makeApiEvent } from '../helpers/api-event';

const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

const context = {} as Context;

beforeEach(() => {
  ddbMock.reset();
  sqsMock.reset();
  ddbMock.on(ScanCommand).resolves({ Items: [] });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/v1/locations/:id', () => {
  it('returns 404 when the location does not exist', async () => {
    ddbMock.on(GetCommand).resolves({});

    const result = await handler(
      makeApiEvent({
        path: '/api/v1/locations/missing',
        resource: '/api/v1/locations/{id}',
        pathParameters: { id: 'missing' },
      }),
      context,
    );

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Location not found' });
  });

  it('returns 500 when the database read fails', async () => {
    ddbMock.on(GetCommand).rejects(new Error('boom'));

    const result = await handler(
      makeApiEvent({
        path: '/api/v1/locations/missing',
        resource: '/api/v1/locations/{id}',
        pathParameters: { id: 'missing' },
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
  it('returns 400 for an undecodable pagination token without querying', async () => {
    const result = await handler(
      makeApiEvent({
        queryStringParameters: {
          nextToken: Buffer.from('not json').toString('base64'),
        },
      }),
      context,
    );

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Invalid "next" pagination token',
    });
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });
});

describe('POST /api/v1/locations', () => {
  it('creates a location and enqueues geocoding', async () => {
    ddbMock.on(PutCommand).resolves({});
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
    expect(JSON.parse(result.body)).toMatchObject({
      name: 'Seattle Center',
      city: 'Seattle',
      state: 'WA',
      country: 'United States',
      latitude: null,
      longitude: null,
      geodataStatus: 'PENDING',
    });

    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
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
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });
});
