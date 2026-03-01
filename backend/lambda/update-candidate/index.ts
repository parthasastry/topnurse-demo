import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { APIGatewayProxyHandler } from 'aws-lambda';

const dynamo = new DynamoDBClient({});
const CANDIDATES_TABLE = process.env.CANDIDATES_TABLE_NAME!;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

/** String profile fields (aligned with TopNurse Repo: contact, summary). */
const STRING_KEYS = new Set([
  'displayName',
  'phone',
  'bio',
  'address',
  'location',
  'summary',
]);
/** Array of strings (e.g. skills). */
const STRING_ARRAY_KEYS = new Set(['skills']);
/** Array of objects (experience, education, licenses). */
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

  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    if (STRING_KEYS.has(key) && typeof value === 'string') {
      updates[key] = value;
    } else if (STRING_ARRAY_KEYS.has(key) && isStringArray(value)) {
      updates[key] = value;
    } else if (OBJECT_ARRAY_KEYS.has(key) && isObjectArray(value)) {
      updates[key] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    const existing = await dynamo.send(
      new GetItemCommand({
        TableName: CANDIDATES_TABLE,
        Key: { email: { S: email } },
      })
    );
    if (!existing.Item) {
      const now = new Date().toISOString();
      const claims = getClaims(event);
      const userId = claims?.sub ?? undefined;
      const newItem = {
        email,
        ...(userId && { userId }),
        createdAt: now,
        updatedAt: now,
      };
      await dynamo.send(
        new PutItemCommand({
          TableName: CANDIDATES_TABLE,
          Item: marshall(newItem, { removeUndefinedValues: true }),
        })
      );
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify(newItem),
      };
    }
    const candidate = unmarshall(existing.Item);
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(candidate),
    };
  }

  const now = new Date().toISOString();
  const setParts: string[] = ['updatedAt = :updatedAt'];
  const exprNames: Record<string, string> = {};
  const exprValues: Record<string, unknown> = { ':updatedAt': now };
  let aliasIndex = 0;
  const keyAlias: Record<string, string> = {};

  for (const [key, value] of Object.entries(updates)) {
    const nameAlias = keyAlias[key] ?? (keyAlias[key] = `#n${aliasIndex++}`);
    exprNames[nameAlias] = key;
    const valueKey = `:v${aliasIndex - 1}`;
    exprValues[valueKey] = value;
    setParts.push(`${nameAlias} = ${valueKey}`);
  }

  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: CANDIDATES_TABLE,
        Key: marshall({ email }),
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: marshall(exprValues, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_exists(email)',
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      const claims = getClaims(event);
      const userId = claims?.sub ?? undefined;
      const newItem = {
        email,
        ...(userId && { userId }),
        createdAt: now,
        updatedAt: now,
        ...updates,
      };
      await dynamo.send(
        new PutItemCommand({
          TableName: CANDIDATES_TABLE,
          Item: marshall(newItem, { removeUndefinedValues: true }),
        })
      );
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify(newItem),
      };
    }
    throw err;
  }

  const getResult = await dynamo.send(
    new GetItemCommand({
      TableName: CANDIDATES_TABLE,
      Key: { email: { S: email } },
    })
  );
  const candidate = getResult.Item ? unmarshall(getResult.Item) : { email, ...updates, updatedAt: now };

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(candidate),
  };
};
