#!/usr/bin/env node
import 'source-map-support/register';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { config } from 'dotenv';
import { TopNurseStack } from '../lib/topnurse-stack';

// Load .env from infra directory (wealth-ai-llc pattern)
const infraRoot = path.resolve(__dirname, '..');
config({ path: path.join(infraRoot, '.env') });

const stage = (process.env.TOPNURSE_APP_ENV || process.env.STAGE || 'staging').toLowerCase();
if (!['staging', 'production'].includes(stage)) {
  throw new Error(`Invalid TOPNURSE_APP_ENV/STAGE: ${stage}. Use staging or production.`);
}

// Optional: stage-specific overrides (e.g. .env.staging, .env.production)
config({ path: path.join(infraRoot, `.env.${stage}`), override: true });

const app = new cdk.App();

const stackName = `TopNurseStack-${stage}`;
new TopNurseStack(app, stackName, {
  envName: stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-west-1',
  },
  description: `TopNurse V2 (${stage}) - Cognito, Users, Hospitals, PostConfirmation`,
  stackName,
});
