import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
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

export const handler: APIGatewayProxyHandler = async (event) => {
  const email = getEmailFromEvent(event);
  if (!email) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  const result = await dynamo.send(
    new GetItemCommand({
      TableName: CANDIDATES_TABLE,
      Key: {
        email: { S: email },
      },
    })
  );

  if (!result.Item) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Candidate not found' }),
    };
  }

  const candidate = unmarshall(result.Item);
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(candidate),
  };
};
