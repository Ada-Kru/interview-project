import * as cdk from 'aws-cdk-lib/core';
import * as apiGateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';


const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME = 'LocationsTable';

export class InterviewProjectStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new dynamodb.TableV2(
      this,
      LOCATIONS_TABLE_NAME,
      {
        partitionKey: {
          name: 'id',
          type: dynamodb.AttributeType.STRING,
        },
      },
    );

    const locationsApiHandler = new NodejsFunction(
      this,
      'LocationsApiHandler',
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, '../src/lambda-functions/location-api/api.ts'),
        handler: 'index.handler',
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
