import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import type { PostConfirmationTriggerHandler } from 'aws-lambda';

const dynamo = new DynamoDBClient({});
const USERS_TABLE = process.env.USERS_TABLE_NAME!;
const CANDIDATES_TABLE = process.env.CANDIDATES_TABLE_NAME;

const ALLOWED_ROLES = ['candidate', 'recruiter', 'admin'] as const;
type Role = (typeof ALLOWED_ROLES)[number];

function isValidRole(value: string | undefined): value is Role {
  return value != null && ALLOWED_ROLES.includes(value as Role);
}

/**
 * Cognito PostConfirmation trigger: create a user record in DynamoDB after sign-up confirmation.
 * Mirrors the "user table post confirmation" pattern (e.g. wealth-ai-llc).
 *
 * Expects Cognito custom attributes (set at sign-up or by admin):
 * - custom:role — one of candidate | recruiter | admin
 * - custom:organizationId — required for recruiter (hospitalId); ignored for candidate/admin
 */
export const handler: PostConfirmationTriggerHandler = async (event) => {
  const attrs = event.request.userAttributes;
  const userId = attrs.sub;
  const email = attrs.email ?? '';
  const roleRaw = attrs['custom:role'];
  const organizationId = attrs['custom:organizationId']?.trim() || undefined;

  const role: Role = isValidRole(roleRaw) ? roleRaw : 'candidate';

  if (role === 'recruiter' && !organizationId) {
    console.warn('PostConfirmation: recruiter has no custom:organization_id; storing without org.');
  }

  const now = new Date().toISOString();
  const item = {
    userId,
    email,
    role,
    ...(organizationId && { organizationId }),
    createdAt: now,
    updatedAt: now,
    cognitoUsername: event.userName,
  };

  await dynamo.send(
    new PutItemCommand({
      TableName: USERS_TABLE,
      Item: marshall(item, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(userId)',
    })
  );

  if (role === 'candidate' && CANDIDATES_TABLE && email) {
    const candidateItem = {
      email,
      userId,
      createdAt: now,
      updatedAt: now,
    };
    await dynamo.send(
      new PutItemCommand({
        TableName: CANDIDATES_TABLE,
        Item: marshall(candidateItem, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(email)',
      })
    );
  }

  return event;
};
