import { Router } from '@aws-lambda-powertools/event-handler/http';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { buildUpdateParams } from '../../helpers/dynamoDbUpdate';
import { createLocationSchema, updateLocationSchema } from './schemas';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import {
  LocationCoordinatesStatus,
  LocationCreateData,
  LocationUpdateData
} from './definitions';


const router = new Router();
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME;

router.get('/api/v1/locations', async () => {

  try {
    const allLocations = await docClient.send(
      new ScanCommand({ TableName: LOCATIONS_TABLE_NAME })
    );

    return {
      statusCode: 201,
      body: allLocations.Items ?? [],
    };
  }
  catch (err) {
    console.error('Error fetching locations: ', err);
    return {
      statusCode: 500,
      body: { error: 'Failed to fetch locations' },
    };
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
      statusCode: 201,
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

router.post('/api/v1/locations', async ({ req }) => {

  const data = (await req.json()) as LocationCreateData;

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
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: LOCATIONS_TABLE_NAME,
        Item: newLocation,
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


router.patch('/api/v1/locations/:id', async ({ req, params }) => {

  const { id } = params;
  const body = (await req.json()) as LocationUpdateData

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

    const patchResult = await docClient.send(
      new UpdateCommand({
        TableName: LOCATIONS_TABLE_NAME,
        Key: { id },
        ...buildUpdateParams(body),
        ReturnValues: 'ALL_NEW'
      })
    );

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
