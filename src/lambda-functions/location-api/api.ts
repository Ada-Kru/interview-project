import { Router } from '@aws-lambda-powertools/event-handler/http';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLocationSchema } from './schemas';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LocationCreateData } from './interfaces';
import { z } from 'zod';


const router = new Router();
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME;

router.get('/api/v1/locations', async () => {

  return [{ id: 'TEST' }];
});

router.post('/api/v1/locations', async ({ req }) => {

  const data = (await req.json()) as LocationCreateData;
  if (!data || typeof data !== 'object') {
    return {
      statusCode: 400,
      body: { error: `Invalid JSON payload received: ${data}` },
    }
  }

  const newLocation = {
    id: crypto.randomUUID(),
    name: data.name,
    city: data.city,
    state: data.state,
    country: data.country,
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


export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  return router.resolve(event, context);
};
