import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface CognitoStackProps extends cdk.NestedStackProps {
  readonly postConfirmationFn: lambda.IFunction;
}

/**
 * Cognito User Pool and App Client.
 * PostConfirmation trigger creates user record in DynamoDB (see LambdaStack).
 */
export class CognitoStack extends cdk.NestedStack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'topnurse-user-pool',
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
        username: false,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      customAttributes: {
        role: new cognito.StringAttribute({ minLen: 1, maxLen: 32, mutable: true }),
        organizationId: new cognito.StringAttribute({ minLen: 0, maxLen: 128, mutable: true }),
      },
      lambdaTriggers: {
        postConfirmation: props.postConfirmationFn,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.userPoolClient = this.userPool.addClient('TopNurseAppClient', {
      userPoolClientName: 'topnurse-app-client',
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: false,
      },
      generateSecret: false,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });
  }
}
