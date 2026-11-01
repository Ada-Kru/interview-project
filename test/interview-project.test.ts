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

  test('creates the locations table', () => {
    template.resourceCountIs('AWS::DynamoDB::GlobalTable', 1);
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'Locations',
    });
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
