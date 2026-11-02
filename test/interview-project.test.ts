import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { InterviewProjectStack } from '../lib/interview-project-stack';

describe('InterviewProjectStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new InterviewProjectStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  test('creates the Postgres database cluster', () => {
    template.resourceCountIs('AWS::RDS::DBCluster', 1);
    template.hasResourceProperties('AWS::RDS::DBCluster', {
      Engine: 'aurora-postgresql',
      DatabaseName: 'locations_api',
      EnableHttpEndpoint: true,
    });
    template.resourceCountIs('AWS::RDS::DBInstance', 1);
    template.resourceCountIs('AWS::DynamoDB::GlobalTable', 0);
  });

  test('creates the geodata queue with a five-minute visibility timeout', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 300,
    });
  });

  test('creates both lambda functions', () => {
    template.resourceCountIs('AWS::Lambda::Function', 2);
  });
});
