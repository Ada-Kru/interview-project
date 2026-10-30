import { DynamoDBClient, type WriteRequest } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

const endpoint =
  process.env.DYNAMODB_ENDPOINT ??
  process.env.LOCALSTACK_ENDPOINT_URL ??
  'http://localhost:4566';
const region =
  process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
const tableName = process.env.LOCATIONS_TABLE_NAME ?? 'Locations';

const client = new DynamoDBClient({
  endpoint,
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  },
});

const docClient = DynamoDBDocumentClient.from(client);

const BATCH_SIZE = 25;

/**
 * Deletes every item in the Locations table.
 *
 * Used before each API test so tests do not depend on data left behind by
 * earlier runs. The table itself (and the deployed stack) stays intact.
 */
export async function clearLocationsTable(): Promise<void> {
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const page = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: '#id',
        ExpressionAttributeNames: { '#id': 'id' },
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    const keys = (page.Items ?? []).map((item) => ({ id: item.id }));
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      await deleteBatch(
        keys.slice(i, i + BATCH_SIZE).map((Key) => ({ DeleteRequest: { Key } }))
      );
    }

    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
}

async function deleteBatch(requests: WriteRequest[]): Promise<void> {
  let pending = requests;

  for (let attempt = 0; attempt < 5 && pending.length > 0; attempt++) {
    const result = await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: pending,
        },
      })
    );

    pending = result.UnprocessedItems?.[tableName] ?? [];
  }

  if (pending.length > 0) {
    throw new Error(
      `Failed to delete ${pending.length} item(s) from ${tableName}`
    );
  }
}
