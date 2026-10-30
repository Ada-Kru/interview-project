import { buildUpdateParams } from '../../helpers/dynamoDbUpdate';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Location, LocationCoordinatesStatus } from './definitions/types';
import { SQSBatchResponse, SQSEvent, SQSBatchItemFailure } from 'aws-lambda';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME;
const USER_AGENT = 'Interview Project (https://github.com/Ada-Kru/interview-project)';
const MAX_RECEIVE_COUNT = Number(process.env.FETCH_GEODATA_MAX_RECEIVE_COUNT ?? 5);

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchItemFailure[] = [];
  for (const record of event.Records) {
    const { id } = JSON.parse(record.body) as { id: string };
    const loc = (await docClient.send(
      new GetCommand({
        TableName: LOCATIONS_TABLE_NAME,
        Key: { id }
      })
    )).Item as Location | undefined;

    if (!loc) {
      throw new Error(`Location with id ${id} not found`);
    }

    try {
      const searchParams = new URLSearchParams({
        city: loc.city,
        state: loc.state,
        country: loc.country,
        format: 'json',
      });
      const geoServiceUrl = `https://nominatim.openstreetmap.org/search?${searchParams}`;
      const geoResponse = await fetch(
        geoServiceUrl, {
          signal: AbortSignal.timeout(12000),
          headers: {
            'Accept': 'application/json',
            'User-Agent': USER_AGENT,
          }
        }
      );

      if (geoResponse.status >= 300) {
        throw new Error(`OSM API Error ${geoResponse.status}`);
      }

      const results =
        (await geoResponse.json()) as { lat: string, lon: string }[];

      if (!results.length) {
        await docClient.send(
          new UpdateCommand({
            TableName: LOCATIONS_TABLE_NAME,
            Key: { id: loc.id },
            ...buildUpdateParams({
              latitude: null,
              longitude: null,
              status: LocationCoordinatesStatus.NOT_FOUND
            }),
          })
        );
        continue;
      }

      const { lat, lon } = results[0];

      if (!lat || !lon) {
        throw new Error(`Invalid latitude and/or longitude ${lat} ${lon}`);
      }

      await docClient.send(
        new UpdateCommand({
          TableName: LOCATIONS_TABLE_NAME,
          Key: { id: loc.id },
          ...buildUpdateParams({
            latitude: parseFloat(lat),
            longitude: parseFloat(lon),
            status: LocationCoordinatesStatus.MATCHED
          }),
        })
      );
    } catch (err) {
      console.error('Geocode failed', record.messageId, err);

      // Last delivery attempt before SQS moves the message to the dead letter queue.
      if (Number(record.attributes.ApproximateReceiveCount) >= MAX_RECEIVE_COUNT) {
        try {
          await docClient.send(
            new UpdateCommand({
              TableName: LOCATIONS_TABLE_NAME,
              Key: { id: loc.id },
              ...buildUpdateParams({
                latitude: null,
                longitude: null,
                status: LocationCoordinatesStatus.ERROR
              }),
            })
          );
        } catch (updateErr) {
          console.error('Failed to set ERROR status', record.messageId, updateErr);
        }
      }

      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};