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
  ScanCommand,
  type ScanCommandOutput,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { Location, LocationGeodataStatus } from './definitions/types';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';


const router = new Router();
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const sqsClient = new SQSClient({});
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME;
const LOCATIONS_GEODATA_QUEUE_URL = process.env.LOCATIONS_GEODATA_QUEUE_URL;
const LOCATION_FIELDS_TRIGGER_GEOCODE = [
  'city',
  'state',
  'country'
] as const satisfies ReadonlyArray<keyof Location>;

const normalizeLocationPart = (part: string) => {
  return part.trim().toLocaleLowerCase('en-US');
}

const createLocationHash = (loc: Record<string, string> | Location) => {
  return [
    loc.name,
    loc.city,
    loc.state,
    loc.country
  ].map(normalizeLocationPart).join('_-_-');
};

const getExistingLocation = async (
  loc: Record<string, string> | Location
): Promise<Location | undefined> => {

  const locHash = createLocationHash(loc);
  let startKey: Record<string, any> | undefined | null = null;

  while (startKey !== undefined) {
    const page: ScanCommandOutput = await docClient.send(
      new ScanCommand({
        TableName: LOCATIONS_TABLE_NAME,
        ProjectionExpression: '#id, #name, #city, #state, #country',
        ExpressionAttributeNames: {
          '#id': 'id',
          '#name': 'name',
          '#city': 'city',
          '#state': 'state',
          '#country': 'country',
        },
         ExclusiveStartKey: startKey ?? undefined,
      })
    );

    const pageItems = (page.Items ?? []) as Location[];
    const existingLocation = pageItems.find(
      (l) => createLocationHash(l as Location) === locHash
    );

    if (existingLocation) {
      return existingLocation;
    }

    startKey = page.LastEvaluatedKey;
  }

  return undefined;
};

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
      IndexName: "IdxSortByCreatedAt",
      KeyConditionExpression: "gsiPartition = :gsiPk",
      ExpressionAttributeValues: {
        ":gsiPk": "ALL_ITEMS"
      },
      Limit: limit,
      ScanIndexForward: false
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
    console.error({
      message: 'Error fetching locations',
      data: { error: err }
    });
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
    console.error({
      message: 'Error fetching location',
      data: { error: err }
    });
    return {
      statusCode: 500,
      body: { error: 'Failed to fetch location' },
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
    geodataStatus: LocationGeodataStatus.PENDING,
    createdAt: new Date().toISOString(),
    gsiPartition: 'ALL_ITEMS',
  };

  try {
    // Note that this does not check for capitalization or abbreviated
    // city/state/country names at this time
    const existingLoc = await getExistingLocation(data as Location);
    if (existingLoc) {
      return {
        statusCode: 409,
        body: {
          error:
            `A branch with the same name already exists in this city. ` +
            `Id: ${existingLoc.id}`,
        },
      };
    };

    await docClient.send(
      new PutCommand({
        TableName: LOCATIONS_TABLE_NAME,
        Item: newLocation,
      })
    );
  }
  catch (err) {
    console.error({
      message: 'Error writing to database',
      data: { error: err }
    });
     return {
      statusCode: 500,
      body: { error: 'Failed to create location' },
     };
  }

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

    const updatedLoc = {
      name: body.name ?? matchedLocation.name,
      city: body.city ?? matchedLocation.city,
      state: body.state ?? matchedLocation.state,
      country: body.country ?? matchedLocation.country,
    };

    const placeChanged =
      createLocationHash(updatedLoc) !== createLocationHash(matchedLocation);

    if (placeChanged) {
      const existingLoc = await getExistingLocation(updatedLoc);
      if (existingLoc) {
        return {
          statusCode: 409,
          body: {
            error:
              `A branch with the same name already exists in this city. ` +
              `Id: ${existingLoc.id}`,
          },
        };
      }
    }

    const locationChanged = LOCATION_FIELDS_TRIGGER_GEOCODE.some(
      (field) =>
        body[field] !== undefined &&
        (
          normalizeLocationPart(body[field]) !==
          normalizeLocationPart(matchedLocation[field] ?? '')
        )
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
                geodataStatus: LocationGeodataStatus.PENDING,
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
      statusCode: 200,
      body: patchResult.Attributes,
    };
  }
  catch (err) {
    console.error({
      message: 'Error patching location',
      data: { error: err }
    });
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
