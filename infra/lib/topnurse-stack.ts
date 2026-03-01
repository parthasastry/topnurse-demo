import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DynamoDBStack } from './dynamodb-stack';
import { StorageStack } from './storage-stack';
import { LambdaStack } from './lambda-stack';
import { CognitoStack } from './cognito-stack';
import { ApiGatewayStack } from './api-gateway-stack';

export interface TopNurseStackProps extends cdk.StackProps {
  /** Environment name (e.g. staging, production). Used for resource naming (e.g. S3 bucket). */
  readonly envName?: string;
}

/**
 * Common stack that composes all TopNurse infra (wealth-ai-llc style).
 * Order: DynamoDB, Storage (S3) → Lambda (needs tables + bucket) → Cognito → API Gateway.
 */
export class TopNurseStack extends cdk.Stack {
  public readonly dynamoDBStack: DynamoDBStack;
  public readonly storageStack: StorageStack;
  public readonly lambdaStack: LambdaStack;
  public readonly cognitoStack: CognitoStack;
  public readonly apiGatewayStack: ApiGatewayStack;

  constructor(scope: Construct, id: string, props?: TopNurseStackProps) {
    super(scope, id, props);

    const envName = props?.envName ?? (this.stackName ? this.stackName.replace(/^TopNurseStack-/, '') : 'staging');

    this.dynamoDBStack = new DynamoDBStack(this, 'DynamoDBStack');
    this.storageStack = new StorageStack(this, 'StorageStack', { envName });

    this.lambdaStack = new LambdaStack(this, 'LambdaStack', {
      usersTable: this.dynamoDBStack.usersTable,
      hospitalsTable: this.dynamoDBStack.hospitalsTable,
      candidatesTable: this.dynamoDBStack.candidatesTable,
      jobsTable: this.dynamoDBStack.jobsTable,
      embeddingProfilesTable: this.dynamoDBStack.embeddingProfilesTable,
      resumesBucket: this.storageStack.resumesBucket,
    });
    this.cognitoStack = new CognitoStack(this, 'CognitoStack', {
      postConfirmationFn: this.lambdaStack.postConfirmationFn,
    });
    this.apiGatewayStack = new ApiGatewayStack(this, 'ApiGatewayStack', {
      listHospitalsFn: this.lambdaStack.listHospitalsFn,
      listCandidatesFn: this.lambdaStack.listCandidatesFn,
      getCandidateFn: this.lambdaStack.getCandidateFn,
      getCandidateByEmailFn: this.lambdaStack.getCandidateByEmailFn,
      saveCandidateFn: this.lambdaStack.saveCandidateFn,
      getResumeUploadUrlFn: this.lambdaStack.getResumeUploadUrlFn,
      recordResumeFn: this.lambdaStack.recordResumeFn,
      parseResumeFn: this.lambdaStack.parseResumeFn,
      jobsFn: this.lambdaStack.jobsFn,
      jobFromDescriptionFn: this.lambdaStack.jobFromDescriptionFn,
      jobMatchesFn: this.lambdaStack.jobMatchesFn,
      embeddingBackfillFn: this.lambdaStack.embeddingBackfillFn,
      userPool: this.cognitoStack.userPool,
    });

    // Outputs at main stack level
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.cognitoStack.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: 'TopNurseUserPoolId',
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.cognitoStack.userPoolClient.userPoolClientId,
      description: 'Cognito App Client ID',
      exportName: 'TopNurseUserPoolClientId',
    });
    new cdk.CfnOutput(this, 'UsersTableName', {
      value: this.dynamoDBStack.usersTable.tableName,
      description: 'DynamoDB Users table',
      exportName: 'TopNurseUsersTableName',
    });
    new cdk.CfnOutput(this, 'HospitalsTableName', {
      value: this.dynamoDBStack.hospitalsTable.tableName,
      description: 'DynamoDB Hospitals table',
      exportName: 'TopNurseHospitalsTableName',
    });
    new cdk.CfnOutput(this, 'CandidatesTableName', {
      value: this.dynamoDBStack.candidatesTable.tableName,
      description: 'DynamoDB Candidates table (PK: email)',
      exportName: 'TopNurseCandidatesTableName',
    });
    new cdk.CfnOutput(this, 'JobsTableName', {
      value: this.dynamoDBStack.jobsTable.tableName,
      description: 'DynamoDB Jobs table (PK: organizationId, SK: jobId)',
      exportName: 'TopNurseJobsTableName',
    });
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.apiGatewayStack.api.url,
      description: 'API Gateway base URL (e.g. for VITE_API_URL)',
      exportName: 'TopNurseApiUrl',
    });
    new cdk.CfnOutput(this, 'ResumesBucketName', {
      value: this.storageStack.resumesBucket.bucketName,
      description: 'S3 bucket for candidate resume uploads',
      exportName: 'TopNurseResumesBucketName',
    });
  }
}
