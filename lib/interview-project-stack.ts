import * as cdk from 'aws-cdk-lib/core';
import * as apiGateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Duration } from 'aws-cdk-lib/core';


const FETCH_GEODATA_MAX_RECEIVE_COUNT = 5;
const LOCATIONS_DB_NAME = 'locations_api';

const getEnvVarOrThrowError = (name: string): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

export class InterviewProjectStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props?: cdk.StackProps & { local?: boolean }
  ) {
    super(scope, id, props);

    let database: rds.DatabaseCluster | undefined;
    let databaseClusterArn: string;
    let databaseSecretArn: string;
    let databaseName: string;

    if (props?.local) {
      databaseClusterArn = getEnvVarOrThrowError('DATABASE_ARN');
      databaseSecretArn = getEnvVarOrThrowError('DATABASE_SECRET_ARN');
      databaseName = process.env.LOCATIONS_DB_NAME ?? LOCATIONS_DB_NAME;
    }
    else {
      const databaseVpc = new ec2.Vpc(this, 'DatabaseVpc', {
        maxAzs: 2,
        natGateways: 0,
        restrictDefaultSecurityGroup: false,
        subnetConfiguration: [
          {
            name: 'Database',
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            cidrMask: 24,
          },
        ],
      });

      database = new rds.DatabaseCluster(this, 'LocationsDatabase', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_16_13,
        }),
        writer: rds.ClusterInstance.serverlessV2('Writer'),
        serverlessV2MinCapacity: 0.5,
        serverlessV2MaxCapacity: 2,
        enableDataApi: true,
        defaultDatabaseName: LOCATIONS_DB_NAME,
        credentials: rds.Credentials.fromGeneratedSecret('app'),
        vpc: databaseVpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        deletionProtection: false,
      });

      databaseClusterArn = database.clusterArn;
      databaseSecretArn = database.secret!.secretArn;
      databaseName = LOCATIONS_DB_NAME;
    }

    const fetchGeodataDLQ = new sqs.Queue(
      this,
      'FetchGeodataDLQ',
      { retentionPeriod: Duration.days(14) }
    );

    const fetchGeodataQueue = new sqs.Queue(
      this,
      'FetchGeodataQueue',
      {
        visibilityTimeout: Duration.minutes(5),
        deadLetterQueue: {
          queue: fetchGeodataDLQ,
          maxReceiveCount: FETCH_GEODATA_MAX_RECEIVE_COUNT
        }
      }
    );

    const passedEnvVars = {
      DATABASE_ARN: databaseClusterArn,
      DATABASE_SECRET_ARN: databaseSecretArn,
      LOCATIONS_DB_NAME: databaseName,
    };

    const fetchGeodataHandler = new NodejsFunction(
      this,
      'FetchGeodataHandler',
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(
          __dirname,
          '../src/lambda-functions/location-api/fetch-geodata.ts'
        ),
        environment: {
          ...passedEnvVars,
          FETCH_GEODATA_MAX_RECEIVE_COUNT: String(
            FETCH_GEODATA_MAX_RECEIVE_COUNT
          ),
        },
        handler: 'index.handler',
        timeout: Duration.seconds(30),
        reservedConcurrentExecutions: 1,
        bundling: {
          minify: true,
          sourceMap: true,
          bundleAwsSDK: true,
        },
      }
    );

    fetchGeodataHandler.addEventSource(
      new SqsEventSource(
        fetchGeodataQueue,
        {
          batchSize: 1,
          reportBatchItemFailures: true,
          maxConcurrency: 2
        }
      )
    );

    const locationsApiHandler = new NodejsFunction(
      this,
      'LocationsApiHandler',
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(
          __dirname,
          '../src/lambda-functions/location-api/api.ts'
        ),
        environment: {
          ...passedEnvVars,
          LOCATIONS_GEODATA_QUEUE_URL: fetchGeodataQueue.queueUrl
        },
        handler: 'index.handler',
        timeout: Duration.seconds(30),
        bundling: {
          minify: true,
          sourceMap: true,
          bundleAwsSDK: true,
        },
      },
    );

    if (database) {
      database.grantDataApiAccess(locationsApiHandler);
      database.grantDataApiAccess(fetchGeodataHandler);
    }
    else {
      const dataApiActions = [
        'rds-data:ExecuteStatement',
        'rds-data:BatchExecuteStatement',
        'rds-data:BeginTransaction',
        'rds-data:CommitTransaction',
        'rds-data:RollbackTransaction',
      ];

      for (const handler of [locationsApiHandler, fetchGeodataHandler]) {
        handler.addToRolePolicy(new iam.PolicyStatement({
          actions: dataApiActions,
          resources: [databaseClusterArn],
        }));
        handler.addToRolePolicy(new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [databaseSecretArn],
        }));
      }
    }

    fetchGeodataQueue.grantSendMessages(locationsApiHandler);

    const locationsApi = new apiGateway.LambdaRestApi(
      this,
      'LocationsProxyApi',
      {
        handler: locationsApiHandler,
        proxy: true,
      },
    );

    new cdk.CfnOutput(this, 'DemoApiId', {
      value: locationsApi.restApiId,
      description: 'REST API ID used by the Docker demo gateway',
    });

    new cdk.CfnOutput(this, 'DemoApiStage', {
      value: locationsApi.deploymentStage.stageName,
      description: 'API Gateway stage used by the Docker demo gateway',
    });

    new cdk.CfnOutput(this, 'DatabaseClusterArn', {
      value: databaseClusterArn,
      description: 'Aurora cluster ARN',
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: databaseSecretArn,
      description: 'Secrets Manager ARN',
    });

    new cdk.CfnOutput(this, 'LocationsDbName', {
      value: databaseName,
      description: 'Locations database name',
    });
  }
}
