import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as path from 'path';
import { Construct } from 'constructs';

export interface LambdaStackProps extends cdk.NestedStackProps {
  readonly usersTable: dynamodb.ITable;
  readonly hospitalsTable: dynamodb.ITable;
  readonly candidatesTable: dynamodb.ITable;
  readonly jobsTable: dynamodb.ITable;
  readonly embeddingProfilesTable: dynamodb.ITable;
  readonly resumesBucket: s3.IBucket;
}

/**
 * Lambda functions (e.g. PostConfirmation trigger, list-hospitals API).
 * Entry points live under backend/lambda (repo root).
 */
export class LambdaStack extends cdk.NestedStack {
  public readonly postConfirmationFn: lambdaNode.NodejsFunction;
  public readonly listHospitalsFn: lambdaNode.NodejsFunction;
  public readonly listCandidatesFn: lambdaNode.NodejsFunction;
  public readonly getCandidateFn: lambdaNode.NodejsFunction;
  public readonly getCandidateByEmailFn: lambdaNode.NodejsFunction;
  public readonly saveCandidateFn: lambdaNode.NodejsFunction;
  public readonly getResumeUploadUrlFn: lambdaNode.NodejsFunction;
  public readonly recordResumeFn: lambdaNode.NodejsFunction;
  public readonly parseResumeFn: lambdaNode.NodejsFunction;
  public readonly jobsFn: lambdaNode.NodejsFunction;
  public readonly jobFromDescriptionFn: lambdaNode.NodejsFunction;
  public readonly embeddingGeneratorFn: lambdaNode.NodejsFunction;
  public readonly embeddingBackfillFn: lambdaNode.NodejsFunction;
  public readonly jobMatchesFn: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    this.postConfirmationFn = new lambdaNode.NodejsFunction(this, 'PostConfirmation', {
      functionName: 'topnurse-post-confirmation',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'backend', 'lambda', 'post-confirmation', 'index.ts'),
      handler: 'handler',
      environment: {
        USERS_TABLE_NAME: props.usersTable.tableName,
        CANDIDATES_TABLE_NAME: props.candidatesTable.tableName,
      },
      bundling: {
        forceDockerBundling: false,
      },
    });
    props.usersTable.grantWriteData(this.postConfirmationFn);
    props.candidatesTable.grantWriteData(this.postConfirmationFn);

    this.listHospitalsFn = new lambdaNode.NodejsFunction(this, 'ListHospitals', {
      functionName: 'topnurse-list-hospitals',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'backend', 'lambda', 'list-hospitals', 'index.ts'),
      handler: 'handler',
      environment: {
        HOSPITALS_TABLE_NAME: props.hospitalsTable.tableName,
      },
      bundling: {
        forceDockerBundling: false,
      },
    });
    props.hospitalsTable.grantReadData(this.listHospitalsFn);

    this.listCandidatesFn = new lambdaNode.NodejsFunction(this, 'ListCandidates', {
      functionName: 'topnurse-list-candidates',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'backend', 'lambda', 'list-candidates', 'index.ts'),
      handler: 'handler',
      environment: {
        CANDIDATES_TABLE_NAME: props.candidatesTable.tableName,
      },
      bundling: {
        forceDockerBundling: false,
      },
    });
    props.candidatesTable.grantReadData(this.listCandidatesFn);

    this.getCandidateFn = new lambdaNode.NodejsFunction(this, 'GetCandidate', {
      functionName: 'topnurse-get-candidate',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'backend', 'lambda', 'get-candidate', 'index.ts'),
      handler: 'handler',
      environment: {
        CANDIDATES_TABLE_NAME: props.candidatesTable.tableName,
      },
      bundling: {
        forceDockerBundling: false,
      },
    });
    props.candidatesTable.grantReadData(this.getCandidateFn);

    this.getCandidateByEmailFn = new lambdaNode.NodejsFunction(this, 'GetCandidateByEmail', {
      functionName: 'topnurse-get-candidate-by-email',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'backend', 'lambda', 'get-candidate-by-email', 'index.ts'),
      handler: 'handler',
      environment: {
        CANDIDATES_TABLE_NAME: props.candidatesTable.tableName,
      },
      bundling: {
        forceDockerBundling: false,
      },
    });
    props.candidatesTable.grantReadData(this.getCandidateByEmailFn);

    this.saveCandidateFn = new lambdaNode.NodejsFunction(this, 'SaveCandidate', {
      functionName: 'topnurse-save-candidate',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'backend', 'lambda', 'save-candidate', 'index.ts'),
      handler: 'handler',
      environment: {
        CANDIDATES_TABLE_NAME: props.candidatesTable.tableName,
      },
      bundling: {
        forceDockerBundling: false,
      },
    });
    props.candidatesTable.grantReadWriteData(this.saveCandidateFn);

    this.getResumeUploadUrlFn = new lambdaNode.NodejsFunction(this, 'GetResumeUploadUrl', {
      functionName: 'topnurse-get-resume-upload-url',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'backend', 'lambda', 'get-resume-upload-url', 'index.ts'),
      handler: 'handler',
      environment: {
        RESUMES_BUCKET_NAME: props.resumesBucket.bucketName,
      },
      bundling: {
        forceDockerBundling: false,
      },
    });
    props.resumesBucket.grantPut(this.getResumeUploadUrlFn);

    this.recordResumeFn = new lambdaNode.NodejsFunction(this, 'RecordResume', {
      functionName: 'topnurse-record-resume',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'backend', 'lambda', 'record-resume', 'index.ts'),
      handler: 'handler',
      environment: {
        CANDIDATES_TABLE_NAME: props.candidatesTable.tableName,
      },
      bundling: {
        forceDockerBundling: false,
      },
    });
    props.candidatesTable.grantReadWriteData(this.recordResumeFn);

    this.parseResumeFn = new lambdaNode.NodejsFunction(this, 'ParseResume', {
      functionName: 'topnurse-parse-resume',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'backend', 'lambda', 'parse-resume', 'index.ts'),
      handler: 'handler',
      environment: {
        CANDIDATES_TABLE_NAME: props.candidatesTable.tableName,
        RESUMES_BUCKET_NAME: props.resumesBucket.bucketName,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
        NODE_OPTIONS: '--no-deprecation',
      },
      bundling: {
        forceDockerBundling: false,
      },
      timeout: cdk.Duration.seconds(60),
    });
    props.candidatesTable.grantReadData(this.parseResumeFn);
    props.resumesBucket.grantRead(this.parseResumeFn);

    this.jobsFn = new lambdaNode.NodejsFunction(this, 'Jobs', {
      functionName: 'topnurse-jobs',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'backend', 'lambda', 'jobs', 'index.ts'),
      handler: 'handler',
      environment: {
        JOBS_TABLE_NAME: props.jobsTable.tableName,
      },
      bundling: {
        forceDockerBundling: false,
      },
    });
    props.jobsTable.grantReadWriteData(this.jobsFn);

    this.jobFromDescriptionFn = new lambdaNode.NodejsFunction(this, 'JobFromDescription', {
      functionName: 'topnurse-job-from-description',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'backend', 'lambda', 'job-from-description', 'index.ts'),
      handler: 'handler',
      environment: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
      },
      bundling: {
        forceDockerBundling: false,
      },
      timeout: cdk.Duration.seconds(20),
    });

    this.embeddingGeneratorFn = new lambdaNode.NodejsFunction(this, 'EmbeddingGenerator', {
      functionName: 'topnurse-embedding-generator',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'backend', 'lambda', 'embedding-generator', 'index.ts'),
      handler: 'handler',
      environment: {
        EMBEDDING_PROFILES_TABLE_NAME: props.embeddingProfilesTable.tableName,
        CANDIDATES_TABLE_NAME: props.candidatesTable.tableName,
        JOBS_TABLE_NAME: props.jobsTable.tableName,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
      },
      bundling: {
        forceDockerBundling: false,
      },
      timeout: cdk.Duration.seconds(60),
    });
    props.embeddingProfilesTable.grantReadWriteData(this.embeddingGeneratorFn);
    props.candidatesTable.grantReadData(this.embeddingGeneratorFn);
    props.jobsTable.grantReadData(this.embeddingGeneratorFn);
    this.embeddingGeneratorFn.addEventSource(
      new lambdaEventSources.DynamoEventSource(props.candidatesTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
      })
    );
    this.embeddingGeneratorFn.addEventSource(
      new lambdaEventSources.DynamoEventSource(props.jobsTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
      })
    );

    this.embeddingBackfillFn = new lambdaNode.NodejsFunction(this, 'EmbeddingBackfill', {
      functionName: 'topnurse-embedding-backfill',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'backend', 'lambda', 'embedding-backfill', 'index.ts'),
      handler: 'handler',
      environment: {
        CANDIDATES_TABLE_NAME: props.candidatesTable.tableName,
        JOBS_TABLE_NAME: props.jobsTable.tableName,
        EMBEDDING_GENERATOR_FN: this.embeddingGeneratorFn.functionName,
      },
      bundling: {
        forceDockerBundling: false,
      },
      timeout: cdk.Duration.minutes(10),
    });
    props.candidatesTable.grantReadData(this.embeddingBackfillFn);
    props.jobsTable.grantReadData(this.embeddingBackfillFn);
    this.embeddingGeneratorFn.grantInvoke(this.embeddingBackfillFn);

    this.jobMatchesFn = new lambdaNode.NodejsFunction(this, 'JobMatches', {
      functionName: 'topnurse-job-matches',
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'backend', 'lambda', 'job-matches', 'index.ts'),
      handler: 'handler',
      environment: {
        JOBS_TABLE_NAME: props.jobsTable.tableName,
        CANDIDATES_TABLE_NAME: props.candidatesTable.tableName,
        EMBEDDING_PROFILES_TABLE_NAME: props.embeddingProfilesTable.tableName,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
      },
      bundling: {
        forceDockerBundling: false,
      },
      timeout: cdk.Duration.seconds(50),
    });
    props.jobsTable.grantReadData(this.jobMatchesFn);
    props.candidatesTable.grantReadData(this.jobMatchesFn);
    props.embeddingProfilesTable.grantReadData(this.jobMatchesFn);
  }
}
