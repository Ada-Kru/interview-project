import * as cdk from 'aws-cdk-lib/core';
import * as apiGateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Duration } from 'aws-cdk-lib/core';


const FETCH_GEODATA_MAX_RECEIVE_COUNT = 5;
const LOCATIONS_DB_NAME = 'locations_api';

export class InterviewProjectStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props?: cdk.StackProps & { local?: boolean }
  ) {
    super(scope, id, props);

    const databaseVpc = new ec2.Vpc(this, 'DatabaseVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Database',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    const database = new rds.DatabaseCluster(this, 'LocationsDatabase', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_13,
      }),
      writer: props?.local
        ? rds.ClusterInstance.provisioned('Writer', {
            instanceType: ec2.InstanceType.of(
              ec2.InstanceClass.T3,
              ec2.InstanceSize.MEDIUM,
            ),
          })
        : rds.ClusterInstance.serverlessV2('Writer'),
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
      DATABASE_ARN: database.clusterArn,
      DATABASE_SECRET_ARN: database.secret?.secretArn!,
      LOCATIONS_DB_NAME,
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

    database.grantDataApiAccess(locationsApiHandler);
    fetchGeodataQueue.grantSendMessages(locationsApiHandler);
    database.grantDataApiAccess(fetchGeodataHandler);

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
      value: database.clusterArn,
      description: 'Aurora cluster ARN',
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: passedEnvVars.DATABASE_SECRET_ARN,
      description: 'Secrets Manager ARN',
    });

    new cdk.CfnOutput(this, 'LocationsDbName', {
      value: LOCATIONS_DB_NAME,
      description: 'Locations database name',
    });
  }
}
