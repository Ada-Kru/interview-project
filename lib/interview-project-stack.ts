import * as cdk from 'aws-cdk-lib/core';
import * as apiGateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Duration } from 'aws-cdk-lib/core';


const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME || 'Locations';

export class InterviewProjectStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const locationsTable = new dynamodb.TableV2(
      this,
      'LocationsTable',
      {
        tableName: LOCATIONS_TABLE_NAME,
        partitionKey: {
          name: 'id',
          type: dynamodb.AttributeType.STRING,
        },
      },
    );

    locationsTable.addGlobalSecondaryIndex({
      indexName: 'IdxSortById',
      partitionKey: { name: 'gsiPartition', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL, 
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
          maxReceiveCount: 5
        }
      }
    );

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
          LOCATIONS_TABLE_NAME: locationsTable.tableName,
        },
        handler: 'index.handler',
        timeout: Duration.seconds(30),
        bundling: {
          minify: true,
          sourceMap: true,
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
        entry: path.join(__dirname, '../src/lambda-functions/location-api/api.ts'),
        environment: {
          LOCATIONS_TABLE_NAME: locationsTable.tableName,
          LOCATIONS_GEODATA_QUEUE_URL: fetchGeodataQueue.queueUrl
        },
        handler: 'index.handler',
        timeout: Duration.seconds(30),
        bundling: {
          minify: true,
          sourceMap: true,
        },
      },
    );

    new apiGateway.LambdaRestApi(
      this,
      'LocationsProxyApi',
      {
        handler: locationsApiHandler,
        proxy: true,
      },
    );
  }
}
