import { Router } from '@aws-lambda-powertools/event-handler/http';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { buildUpdateParams } from '../../helpers/dynamoDbUpdate';
import {
  createLocationSchema,
  listLocationsResponseSchema,
  listLocationsSchema,
  updateLocationSchema
} from './definitions/schemas';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  type QueryCommandInput,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { LocationCoordinatesStatus } from './definitions/types';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';


const router = new Router();
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const sqsClient = new SQSClient({});
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME;
const LOCATIONS_GEODATA_QUEUE_URL = process.env.LOCATIONS_GEODATA_QUEUE_URL;

const normalizePlacePart = (value: string) =>
  value.trim().normalize('NFKC').toLocaleLowerCase('en-US');

router.get('/api/v1/locations', async ({ valid }) => {

  const { limit, nextToken } = valid.req.query;

  let exclusiveStartKey = undefined;
  if (nextToken) {
    try {
      exclusiveStartKey = JSON.parse(
        Buffer.from(nextToken, 'base64').toString('utf-8')
      );
    } catch (err) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid "next" pagination token' }),
      };
    }
  }

  try {
    const commandParams: QueryCommandInput = {
      TableName: LOCATIONS_TABLE_NAME,
      IndexName: "IdxSortById",
      KeyConditionExpression: "gsiPartition = :gsiPk",
      ExpressionAttributeValues: {
        ":gsiPk": "ALL_ITEMS"
      },
      Limit: limit,
      ScanIndexForward: true
    };

    if (exclusiveStartKey) {
      commandParams.ExclusiveStartKey = exclusiveStartKey;
    }

    const allLocations = await docClient.send(
      new QueryCommand(commandParams)
    );

    let newNextToken = null;
    if (allLocations.LastEvaluatedKey) {
      newNextToken = Buffer.from(
        JSON.stringify(allLocations.LastEvaluatedKey)
      ).toString('base64');
    }

    const validatedResponseBody = listLocationsResponseSchema.parse({
      items: allLocations.Items ?? [],
      nextToken: newNextToken
    });

    return {
      statusCode: 200,
      body: validatedResponseBody,
    };
  }
  catch (err) {
    console.error('Error fetching locations: ', err);
    return {
      statusCode: 500,
      body: { error: 'Failed to fetch locations' },
    };
  }
}, {
  validation: {
    req: {
      query: listLocationsSchema
    }
  }
});


router.get('/api/v1/locations/:id', async ({ params }) => {

  const { id } = params;

  try {
    const matchedLocation = (await docClient.send(
      new GetCommand({
        TableName: LOCATIONS_TABLE_NAME,
        Key: { id }
      })
    )).Item;

    if (!matchedLocation) {
      return {
        statusCode: 404,
        body: { error: 'Location not found' },
      };
    }

    return {
      statusCode: 200,
      body: matchedLocation
    };
  }
  catch (err) {
    console.error('Error creating location: ', err);
    return {
      statusCode: 500,
      body: { error: 'Failed to create location' },
    };
  }
});

router.post('/api/v1/locations', async ({ valid }) => {

  const data = valid.req.body;

  const newLocation = {
    id: crypto.randomUUID(),
    name: data.name,
    city: data.city,
    state: data.state,
    country: data.country,
    latitude: null,
    longitude: null,
    status: LocationCoordinatesStatus.PENDING,
    createdAt: new Date().toISOString(),
    gsiPartition: 'ALL_ITEMS',
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: LOCATIONS_TABLE_NAME,
        Item: newLocation,
      })
    );

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: LOCATIONS_GEODATA_QUEUE_URL,
        MessageBody: JSON.stringify({ id: newLocation.id }),
      })
    );

    return {
      statusCode: 201,
      body: newLocation
    };
  }
  catch (err) {
    console.error('Error writing to database: ', err);
     return {
      statusCode: 500,
      body: { error: 'Failed to create location' },
     };
  }
}, {
  validation: {
    req: {
      body: createLocationSchema
    }
  }
});


router.patch('/api/v1/locations/:id', async ({ valid, params }) => {

  const { id } = params;
  const body = valid.req.body;

  try {
    const matchedLocation = (await docClient.send(
      new GetCommand({
        TableName: LOCATIONS_TABLE_NAME,
        Key: { id }
      })
    )).Item;

    if (!matchedLocation) {
      return {
        statusCode: 404,
        body: { error: 'Location not found' },
      };
    }

    const locationChanged = (['city', 'state', 'country'] as const).some(
      (field) =>
        body[field] !== undefined &&
        normalizePlacePart(body[field]) !== normalizePlacePart(matchedLocation[field] ?? '')
    );

    const patchResult = await docClient.send(
      new UpdateCommand({
        TableName: LOCATIONS_TABLE_NAME,
        Key: { id },
        ...buildUpdateParams(
          locationChanged
            ? {
                ...body,
                latitude: null,
                longitude: null,
                status: LocationCoordinatesStatus.PENDING,
              }
            : body
        ),
        ReturnValues: 'ALL_NEW'
      })
    );

    if (locationChanged) {
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: LOCATIONS_GEODATA_QUEUE_URL,
          MessageBody: JSON.stringify({ id }),
        })
      );
    }

    return {
      statusCode: 201,
      body: patchResult.Attributes,
    };
  }
  catch (err) {
    console.error('Error patching location: ', err);
     return {
      statusCode: 500,
      body: { error: 'Failed to update location' },
     };
  }
}, {
  validation: {
    req: {
      body: updateLocationSchema
    }
  }
});


export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  return router.resolve(event, context);
};
