import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface ApiGatewayStackProps extends cdk.NestedStackProps {
  readonly listHospitalsFn: lambda.IFunction;
  readonly listCandidatesFn: lambda.IFunction;
  readonly getCandidateFn: lambda.IFunction;
  readonly getCandidateByEmailFn: lambda.IFunction;
  readonly saveCandidateFn: lambda.IFunction;
  readonly getResumeUploadUrlFn: lambda.IFunction;
  readonly recordResumeFn: lambda.IFunction;
  readonly parseResumeFn: lambda.IFunction;
  readonly jobsFn: lambda.IFunction;
  readonly jobFromDescriptionFn: lambda.IFunction;
  readonly jobMatchesFn: lambda.IFunction;
  readonly embeddingBackfillFn: lambda.IFunction;
  readonly userPool: cognito.IUserPool;
}

/** Allowed origins for CORS. Add new frontend URLs (e.g. Amplify, custom domain) here. */
const CORS_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://staging.d24pnbrx4ltkk.amplifyapp.com',
  'https://staging-topnurse-demo.pssastry.com',
];

/**
 * API Gateway (REST). GET /hospitals, GET|PUT /candidates/me, resume upload (Cognito auth). CORS enabled.
 */
export class ApiGatewayStack extends cdk.NestedStack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiGatewayStackProps) {
    super(scope, id, props);

    this.api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'topnurse-api',
      defaultCorsPreflightOptions: {
        allowOrigins: CORS_ALLOWED_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // CORS on gateway error responses (e.g. 504 timeout) so browser doesn't report CORS instead of real error
    const corsHeaders = { 'Access-Control-Allow-Origin': "'*'" };
    new apigateway.GatewayResponse(this, 'Gateway5XX', {
      restApi: this.api,
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: corsHeaders,
    });
    new apigateway.GatewayResponse(this, 'Gateway4XX', {
      restApi: this.api,
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: corsHeaders,
    });
    new apigateway.GatewayResponse(this, 'IntegrationTimeout', {
      restApi: this.api,
      type: apigateway.ResponseType.INTEGRATION_TIMEOUT,
      responseHeaders: corsHeaders,
    });

    const hospitals = this.api.root.addResource('hospitals');
    const listHospitalsIntegration = new apigateway.LambdaIntegration(props.listHospitalsFn);
    hospitals.addMethod('GET', listHospitalsIntegration);

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
      identitySource: 'method.request.header.Authorization',
    });

    const candidates = this.api.root.addResource('candidates');
    const listCandidatesIntegration = new apigateway.LambdaIntegration(props.listCandidatesFn);
    candidates.addMethod('GET', listCandidatesIntegration, { authorizer });

    const candidatesMe = candidates.addResource('me');
    const getCandidateIntegration = new apigateway.LambdaIntegration(props.getCandidateFn);
    const saveCandidateIntegration = new apigateway.LambdaIntegration(props.saveCandidateFn);
    candidatesMe.addMethod('GET', getCandidateIntegration, { authorizer });
    candidatesMe.addMethod('PUT', saveCandidateIntegration, { authorizer });

    const candidatesByEmail = candidates.addResource('{email}');
    const getCandidateByEmailIntegration = new apigateway.LambdaIntegration(props.getCandidateByEmailFn);
    candidatesByEmail.addMethod('GET', getCandidateByEmailIntegration, { authorizer });

    const resume = candidatesMe.addResource('resume');
    const getResumeUploadUrlIntegration = new apigateway.LambdaIntegration(props.getResumeUploadUrlFn);
    const recordResumeIntegration = new apigateway.LambdaIntegration(props.recordResumeFn);
    const parseResumeIntegration = new apigateway.LambdaIntegration(props.parseResumeFn, {
      timeout: cdk.Duration.seconds(28),
    });
    const resumeUploadUrl = resume.addResource('upload-url');
    resumeUploadUrl.addMethod('POST', getResumeUploadUrlIntegration, { authorizer });
    resume.addMethod('POST', recordResumeIntegration, { authorizer });
    const resumeParse = resume.addResource('parse');
    resumeParse.addMethod('POST', parseResumeIntegration, { authorizer });

    const jobs = this.api.root.addResource('jobs');
    const jobsIntegration = new apigateway.LambdaIntegration(props.jobsFn);
    jobs.addMethod('GET', jobsIntegration, { authorizer });
    jobs.addMethod('POST', jobsIntegration, { authorizer });
    const jobsFromDescription = jobs.addResource('from-description');
    const jobFromDescriptionIntegration = new apigateway.LambdaIntegration(props.jobFromDescriptionFn);
    jobsFromDescription.addMethod('POST', jobFromDescriptionIntegration, { authorizer });
    const jobId = jobs.addResource('{jobId}');
    jobId.addMethod('GET', jobsIntegration, { authorizer });
    jobId.addMethod('PUT', jobsIntegration, { authorizer });
    jobId.addMethod('DELETE', jobsIntegration, { authorizer });
    const jobMatchesIntegration = new apigateway.LambdaIntegration(props.jobMatchesFn, {
      timeout: cdk.Duration.seconds(28),
    });
    const matches = jobId.addResource('matches');
    matches.addMethod('GET', jobMatchesIntegration, { authorizer });

    const admin = this.api.root.addResource('admin');
    const embeddingBackfill = admin.addResource('embedding-backfill');
    const embeddingBackfillIntegration = new apigateway.LambdaIntegration(props.embeddingBackfillFn, {
      timeout: cdk.Duration.seconds(28),
    });
    embeddingBackfill.addMethod('POST', embeddingBackfillIntegration, { authorizer });
  }
}
