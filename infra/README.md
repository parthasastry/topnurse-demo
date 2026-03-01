# TopNurse V2 — Infrastructure (CDK)

Cognito, DynamoDB (users + hospitals), PostConfirmation Lambda, and API Gateway (stub). Patterned after wealth-ai-llc: one common stack that composes separate stacks per domain.

## Stack layout (`infra/lib/`)

| Stack | File | Contents |
|-------|------|----------|
| **TopNurseStack** | `topnurse-stack.ts` | Common stack; instantiates all nested stacks and exposes outputs. |
| **DynamoDBStack** | `dynamodb-stack.ts` | Users table, Hospitals table (NestedStack). |
| **LambdaStack** | `lambda-stack.ts` | PostConfirmation Lambda; entry under `backend/lambda/` (NestedStack). |
| **CognitoStack** | `cognito-stack.ts` | User Pool + App Client; uses PostConfirmation from LambdaStack (NestedStack). |
| **ApiGatewayStack** | `api-gateway-stack.ts` | Stub for later REST API + Cognito authorizer (NestedStack). |

Lambda source lives at **repo root**: `backend/lambda/post-confirmation/`.

## Stack contents

- **Cognito User Pool**: Email sign-in, custom attributes `custom:role` and `custom:organizationId`.
- **Cognito App Client**: SRP and USER_PASSWORD auth flows.
- **DynamoDB – Users** (`topnurse-users`): One row per user, created by PostConfirmation trigger.
  - `userId` (PK) — Cognito `sub`
  - `email`, `role` (candidate | recruiter | admin), `organizationId` (recruiters only), `createdAt`, `updatedAt`, `cognitoUsername`
  - GSI `byRole`: list by role (partitionKey: `role`, sortKey: `createdAt`)
  - GSI `byOrganization`: list recruiters by hospital (partitionKey: `organizationId`, sortKey: `createdAt`; sparse)
- **DynamoDB – Hospitals** (`topnurse-hospitals`): Tenant/hospital records.
  - `hospitalId` (PK)
  - Add attributes (name, etc.) as needed in app code.
- **Lambda – PostConfirmation**: On sign-up confirmation, writes user record to `topnurse-users` (Wealth-ai-llc–style pattern).

## Environment and stack name (wealth-ai-llc pattern)

The stack name is driven by `.env` so you get one stack per environment:

- **`.env`** — Must set `TOPNURSE_APP_ENV=staging` or `TOPNURSE_APP_ENV=production`. Optional: `STAGE` (fallback). Loaded first.
- **`.env.staging`** / **`.env.production`** — Optional; loaded after `.env` with `override: true` so you can set `CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION`, etc. per stage.

Resulting CloudFormation stack name: **`TopNurseStack-staging`** or **`TopNurseStack-production`**. Description includes the stage, e.g. `TopNurse V2 (staging) - ...`.

## Prerequisites

- Node 18+
- AWS CLI configured
- `npm install` in `infra/` (includes `esbuild` for local Lambda bundling; no Docker required for synth)

## Commands

Always use the **project’s** CDK CLI (from `infra/node_modules`) to avoid schema version mismatch. From repo root or from `infra/`:

```bash
# From repo root
npm run infra:synth   # Synthesize CloudFormation
npm run infra:diff    # Diff against deployed stack
npm run infra:deploy  # Deploy stack

# Or from infra/
cd infra && npm install && npx cdk synth
```

Avoid running a globally installed `cdk`; use `npx cdk` or `npm run synth` so the CLI matches `aws-cdk-lib`.

## Roles and attributes

- **Candidate**: `custom:role` = `candidate` (or omit; defaults to candidate). No `custom:organizationId`.
- **Recruiter**: `custom:role` = `recruiter`, `custom:organizationId` = `<hospitalId>` from `topnurse-hospitals`.
- **Admin**: `custom:role` = `admin`. No `custom:organizationId`.

Recruiters are typically created by an admin (e.g. `AdminCreateUser`) with these attributes set; self-sign-up defaults to candidate.
