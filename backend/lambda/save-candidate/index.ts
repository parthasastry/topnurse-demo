import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { APIGatewayProxyHandler } from 'aws-lambda';

const dynamo = new DynamoDBClient({});
const CANDIDATES_TABLE = process.env.CANDIDATES_TABLE_NAME!;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const STRING_KEYS = new Set([
  'displayName',
  'phone',
  'bio',
  'address',
  'location',
  'summary',
]);
const STRING_ARRAY_KEYS = new Set(['skills']);
const OBJECT_ARRAY_KEYS = new Set([
  'experience',
  'education',
  'licenses_and_certifications',
]);

function getClaims(event: Parameters<APIGatewayProxyHandler>[0]): Record<string, string> | undefined {
  return event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
}

function getEmailFromEvent(event: Parameters<APIGatewayProxyHandler>[0]): string | null {
  const claims = getClaims(event);
  if (!claims) return null;
  return claims.email ?? claims['cognito:username'] ?? null;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isObjectArray(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x));
}

/**
 * PUT /candidates/me — Create or replace candidate profile.
 * If no record exists, we create. If it exists, we replace. Always returns 200 with the saved profile.
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const email = getEmailFromEvent(event);
  if (!email) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  let body: Record<string, unknown>;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    if (STRING_KEYS.has(key) && typeof value === 'string') {
      payload[key] = value;
    } else if (STRING_ARRAY_KEYS.has(key) && isStringArray(value)) {
      payload[key] = value;
    } else if (OBJECT_ARRAY_KEYS.has(key) && isObjectArray(value)) {
      payload[key] = value;
    }
  }

  const now = new Date().toISOString();
  const claims = getClaims(event);
  const userId = claims?.sub ?? undefined;

  const existing = await dynamo.send(
    new GetItemCommand({
      TableName: CANDIDATES_TABLE,
      Key: { email: { S: email } },
    })
  );

  const existingRecord = existing.Item ? (unmarshall(existing.Item) as Record<string, unknown>) : null;
  const createdAt = (existingRecord?.createdAt as string | undefined) ?? now;

  /** Preserve resume fields when saving profile so we don't overwrite them. */
  const resumeKey = existingRecord?.resumeKey as string | undefined;
  const resumeUploadedAt = existingRecord?.resumeUploadedAt as string | undefined;

  const item = {
    email,
    ...(userId && { userId }),
    createdAt,
    updatedAt: now,
    ...payload,
    ...(resumeKey !== undefined && { resumeKey }),
    ...(resumeUploadedAt !== undefined && { resumeUploadedAt }),
  };

  await dynamo.send(
    new PutItemCommand({
      TableName: CANDIDATES_TABLE,
      Item: marshall(item, { removeUndefinedValues: true }),
    })
  );

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(item),
  };
};
