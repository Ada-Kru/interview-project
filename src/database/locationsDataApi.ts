import {
  ExecuteStatementCommand,
  RDSDataClient,
  type ColumnMetadata,
  type Field,
  type SqlParameter,
} from '@aws-sdk/client-rds-data';

export type DataApiRow = Record<string, unknown>;

const endpoint = process.env.AWS_ENDPOINT_URL_RDS_DATA ??
                 process.env.AWS_ENDPOINT_URL;

const client = new RDSDataClient((endpoint) ? { endpoint } : {});

const getEnvVarOrThrowError = (name: string): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const fieldValue = (field: Field | undefined): unknown => {
  if (!field || field.isNull) {
    return null;
  }

  const fieldVals = [
    'stringValue',
    'longValue',
    'doubleValue',
    'booleanValue',
    'blobValue',
    'arrayValue'
  ];

  return field.arrayValue ??
         field.blobValue ??
         field.booleanValue ??
         field.doubleValue ??
         field.longValue ??
         field.stringValue ??
         null;
};

const mapRecords = (
  columnMetadata: ColumnMetadata[] = [],
  records: Field[][] = [],
): DataApiRow[] => {
  const columnNames = columnMetadata.map(
    (column) => column.name ?? column.label ?? '',
  );

  return records.map((record) => {
    const row: DataApiRow = {};

    record.forEach((field, index) => {
      row[columnNames[index]] = fieldValue(field);
    });

    return row;
  });
};

export async function executeStatement(
  sql: string,
  parameters: SqlParameter[] = [],
): Promise<DataApiRow[]> {
  const resourceArn = getEnvVarOrThrowError('DATABASE_ARN');
  const secretArn = getEnvVarOrThrowError('DATABASE_SECRET_ARN');
  const database = getEnvVarOrThrowError('LOCATIONS_DB_NAME');

  const result = await client.send(
    new ExecuteStatementCommand({
      resourceArn,
      secretArn,
      database,
      sql,
      parameters,
      includeResultMetadata: true,
    }),
  );

  return mapRecords(result.columnMetadata, result.records);
}
