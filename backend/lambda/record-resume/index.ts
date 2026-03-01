import {
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

function getEmailFromEvent(event: Parameters<APIGatewayProxyHandler>[0]): string | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  if (!claims) return null;
  return claims.email ?? claims['cognito:username'] ?? null;
}

/** Same as get-resume-upload-url: safe for S3 key (alphanumeric, hyphen, underscore, dot). */
function sanitizeKeyPart(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

/** Key must be under candidates/{safeEmail}/ so caller can only register their own upload. Uses same sanitization as get-resume-upload-url. */
function keyBelongsToEmail(key: string, email: string): boolean {
  const safeEmail = sanitizeKeyPart(email);
  const prefix = `candidates/${safeEmail}/`;
  return key === prefix || key.startsWith(prefix);
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

  let body: { key?: string } = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!key) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing key' }),
    };
  }

  if (!keyBelongsToEmail(key, email)) {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  const now = new Date().toISOString();

  const existing = await dynamo.send(
    new GetItemCommand({
      TableName: CANDIDATES_TABLE,
      Key: { email: { S: email } },
    })
  );

  if (existing.Item) {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: CANDIDATES_TABLE,
        Key: marshall({ email }),
        UpdateExpression: 'SET resumeKey = :k, resumeUploadedAt = :t',
        ExpressionAttributeValues: marshall({
          ':k': key,
          ':t': now,
        }),
      })
    );
  } else {
    await dynamo.send(
      new PutItemCommand({
        TableName: CANDIDATES_TABLE,
        Item: marshall(
          {
            email,
            resumeKey: key,
            resumeUploadedAt: now,
            createdAt: now,
            updatedAt: now,
          },
          { removeUndefinedValues: true }
        ),
      })
    );
  }

  const getResult = await dynamo.send(
    new GetItemCommand({
      TableName: CANDIDATES_TABLE,
      Key: { email: { S: email } },
    })
  );
  const candidate = getResult.Item ? unmarshall(getResult.Item) : null;

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      key,
      resumeUploadedAt: now,
      candidate,
    }),
  };
};
