import { LocationGeodataStatus } from './definitions/types';
import {
  getLocation,
  updateLocationGeodata,
} from '../../database/locations';
import { SQSBatchResponse, SQSEvent, SQSBatchItemFailure } from 'aws-lambda';

const USER_AGENT = 'Interview Project (https://github.com/Ada-Kru/interview-project)';
const MAX_RECEIVE_COUNT = Number(process.env.FETCH_GEODATA_MAX_RECEIVE_COUNT ?? 5);

// OpenStreetMap allows 1 request per second
const OSM_REQUEST_INTERVAL_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseLocationId = (body: string): number | undefined => {
  try {
    const parsed = JSON.parse(body) as { id?: unknown };

    if (
      typeof parsed.id !== 'number' ||
      !Number.isSafeInteger(parsed.id) ||
      parsed.id <= 0
    ) {
      return undefined;
    }

    return parsed.id;
  } catch {
    return undefined;
  }
};

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchItemFailure[] = [];
  for (const record of event.Records) {
    const id = parseLocationId(record.body);

    if (id === undefined) {
      console.error({
        message: 'Invalid geodata message',
        data: { messageId: record.messageId, body: record.body },
      });
      continue;
    }

    const loc = await getLocation(id);

    if (!loc) {
      console.warn({
        message: 'Location not found in database, skipping message',
        data: { id, messageId: record.messageId },
      });
      continue;
    }

    try {
      const searchParams = new URLSearchParams({
        city: loc.city,
        state: loc.state,
        country: loc.country,
        format: 'json',
      });
      const geoServiceUrl = `https://nominatim.openstreetmap.org/search?${searchParams}`;
      let geoResponse: Response;
      try {
        geoResponse = await fetch(
          geoServiceUrl, {
            signal: AbortSignal.timeout(12000),
            headers: {
              'Accept': 'application/json',
              'User-Agent': USER_AGENT,
            }
          }
        );
      } finally {
        // enforce 1 request per second rate limit even on failures
        await sleep(OSM_REQUEST_INTERVAL_MS);
      }

      if (geoResponse.status >= 300) {
        throw new Error(`OSM API Error ${geoResponse.status}`);
      }

      const results =
        (await geoResponse.json()) as { lat: string, lon: string }[];

      if (!results.length) {
        await updateLocationGeodata(loc.id, {
          latitude: null,
          longitude: null,
          geodataStatus: LocationGeodataStatus.NOT_FOUND,
        });
        continue;
      }

      const { lat, lon } = results[0];

      if (!lat || !lon) {
        throw new Error(`Invalid latitude and/or longitude ${lat} ${lon}`);
      }

      await updateLocationGeodata(loc.id, {
        latitude: parseFloat(lat),
        longitude: parseFloat(lon),
        geodataStatus: LocationGeodataStatus.MATCHED,
      });
    } catch (err) {
      console.error({
        message: 'Geocode failed',
        data: { messageId: record.messageId, error: err }
      });

      // Last delivery attempt before SQS moves the message to the dead letter queue.
      if (Number(record.attributes.ApproximateReceiveCount) >= MAX_RECEIVE_COUNT) {
        try {
          await updateLocationGeodata(loc.id, {
            latitude: null,
            longitude: null,
            geodataStatus: LocationGeodataStatus.ERROR,
          });
        } catch (updateErr) {
          console.error({
            message: 'Failed to set ERROR status',
            data: { messageId: record.messageId, error: updateErr }
          });
        }
      }

      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};
