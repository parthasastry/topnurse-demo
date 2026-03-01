import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandler } from 'aws-lambda';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const CANDIDATES_TABLE = process.env.CANDIDATES_TABLE_NAME!;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function getRole(event: Parameters<APIGatewayProxyHandler>[0]): string | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  return claims?.['custom:role'] ?? null;
}

/** GET /candidates/:email — Fetch one candidate by email. Recruiter only. */
export const handler: APIGatewayProxyHandler = async (event) => {
  if (getRole(event) !== 'recruiter') {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Only recruiters can view candidate profiles by email' }),
    };
  }

  const rawEmail = event.pathParameters?.email;
  if (!rawEmail || rawEmail === 'me') {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Valid email path parameter required' }),
    };
  }
  let email: string;
  try {
    email = decodeURIComponent(rawEmail);
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid email path parameter' }),
    };
  }

  const result = await docClient.send(
    new GetCommand({
      TableName: CANDIDATES_TABLE,
      Key: { email },
    })
  );

  if (!result.Item) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Candidate not found' }),
    };
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(result.Item),
  };
};
