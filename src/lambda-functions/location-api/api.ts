import { Router } from '@aws-lambda-powertools/event-handler/http';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  createLocationSchema,
  listLocationsResponseSchema,
  listLocationsSchema,
  updateLocationSchema
} from './definitions/schemas';
import { Location, LocationGeodataStatus } from './definitions/types';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  createLocation,
  findLocationByPlace,
  getLocation,
  listLocations,
  updateLocation,
  type LocationUpdate,
} from '../../database/locations';


const router = new Router();
const sqsClient = new SQSClient({});
const LOCATIONS_GEODATA_QUEUE_URL = process.env.LOCATIONS_GEODATA_QUEUE_URL;
const LOCATION_FIELDS_TRIGGER_GEOCODE = [
  'city',
  'state',
  'country'
] as const satisfies ReadonlyArray<keyof Location>;

const parsePathIntId = (value: string): number | undefined => {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

const normalizePlacePart = (value: string) =>
  value.trim().normalize('NFKC').toLocaleLowerCase('en-US');

const createLocationHash = (
  location: Pick<Location, 'name' | 'city' | 'state' | 'country'>,
) => [
  location.name,
  location.city,
  location.state,
  location.country,
].map(normalizePlacePart).join('_-_-');

const duplicateLocationResponse = (existingLocation: Location) => ({
  statusCode: 409,
  body: {
    error:
      `A branch with the same name already exists in this city. ` +
      `Id: ${existingLocation.id}`,
  },
});

router.get('/api/v1/locations', async ({ valid }) => {

  const { page, pageSize } = valid.req.query;

  try {
    const { items, total } = await listLocations(page, pageSize);
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

    const validatedResponseBody = listLocationsResponseSchema.parse({
      items,
      page,
      pageSize,
      total,
      totalPages,
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

  const id = parsePathIntId(params.id);

  if (id === undefined) {
    return {
      statusCode: 404,
      body: { error: 'Location not found' },
    };
  }

  try {
    const matchedLocation = await getLocation(id);

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

  let newLocation: Location;
  try {
    const existingLocation = await findLocationByPlace(data);

    if (existingLocation) {
      return duplicateLocationResponse(existingLocation);
    }

    newLocation = await createLocation(data);
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

  const id = parsePathIntId(params.id);
  const body = valid.req.body;

  if (id === undefined) {
    return {
      statusCode: 404,
      body: { error: 'Location not found' },
    };
  }

  try {
    const matchedLocation = await getLocation(id);

    if (!matchedLocation) {
      return {
        statusCode: 404,
        body: { error: 'Location not found' },
      };
    }

    const updatedPlace = {
      name: body.name ?? matchedLocation.name,
      city: body.city ?? matchedLocation.city,
      state: body.state ?? matchedLocation.state,
      country: body.country ?? matchedLocation.country,
    };

    const placeChanged =
      createLocationHash(updatedPlace) !== createLocationHash(matchedLocation);

    if (placeChanged) {
      const existingLocation = await findLocationByPlace(updatedPlace, id);

      if (existingLocation) {
        return duplicateLocationResponse(existingLocation);
      }
    }

    const locationChanged = LOCATION_FIELDS_TRIGGER_GEOCODE.some(
      (field) =>
        body[field] !== undefined &&
        (
          normalizePlacePart(body[field]) !==
          normalizePlacePart(matchedLocation[field] ?? '')
        )
    );

    const patch: LocationUpdate = locationChanged
      ? {
          ...body,
          latitude: null,
          longitude: null,
          geodataStatus: LocationGeodataStatus.PENDING,
        }
      : body;

    const updatedLocation = await updateLocation(id, patch);

    if (!updatedLocation) {
      return {
        statusCode: 404,
        body: { error: 'Location not found' },
      };
    }

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
      body: updatedLocation,
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
