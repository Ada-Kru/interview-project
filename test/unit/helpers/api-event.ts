import type { APIGatewayProxyEvent } from 'aws-lambda';

/**
 * Builds an API Gateway REST (v1) proxy event for unit tests.
 *
 * The Powertools Router rejects events with missing optional fields, so the
 * `null` values below are intentional and must not be replaced with
 * `undefined`.
 */
export function makeApiEvent(
  overrides: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/api/v1/locations',
    resource: '/api/v1/locations',
    headers: {
      'Content-Type': 'application/json',
      Host: 'localhost',
    },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      domainName: 'localhost',
    } as APIGatewayProxyEvent['requestContext'],
    isBase64Encoded: false,
    body: null,
    ...overrides,
  };
}
