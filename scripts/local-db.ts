import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CreateDBClusterCommand,
  CreateDBInstanceCommand,
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  RDSClient,
} from '@aws-sdk/client-rds';
import {
  CreateSecretCommand,
  DescribeSecretCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

const CLUSTER_ID = 'locations-demo';
const WRITER_ID = 'locations-demo-writer';
const SECRET_NAME = 'locations-demo-db';
const DATABASE_NAME = 'locations_api';
const DATABASE_USER = 'app';
const DATABASE_PASSWORD = 'password';

const WAIT_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;

const endpoint =
  process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const region =
  process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';

const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  ...(process.env.AWS_SESSION_TOKEN
    ? { sessionToken: process.env.AWS_SESSION_TOKEN }
    : {}),
};

const rds = new RDSClient({ endpoint, region, credentials });
const secrets = new SecretsManagerClient({ endpoint, region, credentials });

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const ensureCluster = async (): Promise<string> => {
  try {
    const result = await rds.send(
      new DescribeDBClustersCommand({ DBClusterIdentifier: CLUSTER_ID }),
    );
    const cluster = result.DBClusters?.[0];

    if (cluster?.DBClusterArn) {
      return cluster.DBClusterArn;
    }
  } catch {
    // Create it below.
  }

  const result = await rds.send(
    new CreateDBClusterCommand({
      DBClusterIdentifier: CLUSTER_ID,
      Engine: 'aurora-postgresql',
      EngineVersion: '16.13',
      EngineMode: 'provisioned',
      MasterUsername: DATABASE_USER,
      MasterUserPassword: DATABASE_PASSWORD,
      DatabaseName: DATABASE_NAME,
      EnableHttpEndpoint: true,
    }),
  );

  const arn = result.DBCluster?.DBClusterArn;

  if (!arn) {
    throw new Error('RDS did not return a cluster ARN');
  }

  return arn;
};

const waitForWriter = async (): Promise<void> => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await rds.send(
      new DescribeDBInstancesCommand({ DBInstanceIdentifier: WRITER_ID }),
    );
    const status = result.DBInstances?.[0]?.DBInstanceStatus;

    if (status === 'available') {
      return;
    }

    if (status === 'failed') {
      throw new Error('Local Aurora writer failed to start');
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error('Timed out waiting for the local Aurora writer');
};

const ensureWriter = async (): Promise<void> => {
  try {
    const result = await rds.send(
      new DescribeDBInstancesCommand({ DBInstanceIdentifier: WRITER_ID }),
    );

    if (result.DBInstances?.length) {
      await waitForWriter();
      return;
    }
  } catch {
    // Create it below.
  }

  await rds.send(
    new CreateDBInstanceCommand({
      DBInstanceIdentifier: WRITER_ID,
      DBClusterIdentifier: CLUSTER_ID,
      Engine: 'aurora-postgresql',
      DBInstanceClass: 'db.t3.medium',
    }),
  );

  await waitForWriter();
};

const ensureSecret = async (): Promise<string> => {
  try {
    const result = await secrets.send(
      new DescribeSecretCommand({ SecretId: SECRET_NAME }),
    );

    if (result.ARN) {
      return result.ARN;
    }
  } catch {
    // Create it below.
  }

  const result = await secrets.send(
    new CreateSecretCommand({
      Name: SECRET_NAME,
      SecretString: JSON.stringify({
        username: DATABASE_USER,
        password: DATABASE_PASSWORD,
      }),
    }),
  );

  if (!result.ARN) {
    throw new Error('Secrets Manager did not return a secret ARN');
  }

  return result.ARN;
};

const main = async (): Promise<void> => {
  const clusterArn = await ensureCluster();
  await ensureWriter();
  const secretArn = await ensureSecret();

  const env = [
    `DATABASE_ARN=${clusterArn}`,
    `DATABASE_SECRET_ARN=${secretArn}`,
    `LOCATIONS_DB_NAME=${DATABASE_NAME}`,
  ].join('\n');

  const envFileIndex = process.argv.indexOf('--write-env');
  const envFile =
    envFileIndex >= 0 ? process.argv[envFileIndex + 1] : undefined;

  if (envFile) {
    await mkdir(path.dirname(envFile), { recursive: true });
    await writeFile(envFile, `${env}\n`, 'utf8');
  }

  console.log(env);
};

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
