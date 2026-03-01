import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface StorageStackProps extends cdk.NestedStackProps {
  /** Environment name (e.g. staging, production). Used for bucket name: {envName}-topnurse-resumes. */
  readonly envName: string;
}

/**
 * S3 buckets: candidate resumes (presigned upload, then parse).
 */
export class StorageStack extends cdk.NestedStack {
  public readonly resumesBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const bucketName = `${props.envName}-topnurse-resumes`;

    this.resumesBucket = new s3.Bucket(this, 'ResumesBucket', {
      bucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['http://localhost:5173', 'http://localhost:3000', 'https://localhost:5173', 'https://localhost:3000'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
        },
      ],
    });
  }
}
