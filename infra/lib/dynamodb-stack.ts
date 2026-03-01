import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface DynamoDBStackProps extends cdk.NestedStackProps {}

/**
 * DynamoDB tables: users (post-confirmation), hospitals (tenants), candidates (email as PK), jobs (org + jobId).
 */
export class DynamoDBStack extends cdk.NestedStack {
  public readonly usersTable: dynamodb.Table;
  public readonly hospitalsTable: dynamodb.Table;
  public readonly candidatesTable: dynamodb.Table;
  public readonly jobsTable: dynamodb.Table;
  public readonly embeddingProfilesTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: DynamoDBStackProps) {
    super(scope, id, props);

    this.hospitalsTable = new dynamodb.Table(this, 'HospitalsTable', {
      tableName: 'topnurse-hospitals',
      partitionKey: {
        name: 'hospitalId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: 'topnurse-users',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'byRole',
      partitionKey: { name: 'role', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'byOrganization',
      partitionKey: { name: 'organizationId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    this.candidatesTable = new dynamodb.Table(this, 'CandidatesTable', {
      tableName: 'topnurse-candidates',
      partitionKey: {
        name: 'email',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
    });

    this.jobsTable = new dynamodb.Table(this, 'JobsTable', {
      tableName: 'topnurse-jobs',
      partitionKey: {
        name: 'organizationId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'jobId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
    });

    /** Embedding profiles for Option C matching: one vector per candidate and per job. */
    this.embeddingProfilesTable = new dynamodb.Table(this, 'EmbeddingProfilesTable', {
      tableName: 'topnurse-embedding-profiles',
      partitionKey: {
        name: 'scope',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'entityId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}
