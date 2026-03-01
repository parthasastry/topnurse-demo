import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { APIGatewayProxyHandler } from 'aws-lambda';

const dynamo = new DynamoDBClient({});
const CANDIDATES_TABLE = process.env.CANDIDATES_TABLE_NAME!;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function getRoleFromEvent(event: Parameters<APIGatewayProxyHandler>[0]): string | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  if (!claims) return null;
  return (claims['custom:role'] as string) ?? null;
}

/** Parse limit, lastEvaluatedKey, and search from query params. */
function parseQueryParams(event: Parameters<APIGatewayProxyHandler>[0]): {
  limit: number;
  exclusiveStartKey: Record<string, unknown> | undefined;
  search: string | null;
} {
  const q = event.queryStringParameters ?? {};
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(q.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  let exclusiveStartKey: Record<string, unknown> | undefined;
  const lek = q.lastEvaluatedKey;
  if (lek && typeof lek === 'string') {
    try {
      exclusiveStartKey = JSON.parse(decodeURIComponent(lek)) as Record<string, unknown>;
    } catch {
      // ignore invalid token
    }
  }
  const search = typeof q.search === 'string' ? q.search.trim() || null : null;
  return { limit, exclusiveStartKey, search };
}

/** Match candidate by name (displayName), location, or skills (case-insensitive). */
function matchesSearch(candidate: Record<string, unknown>, searchLower: string): boolean {
  const name = (candidate.displayName as string) ?? (candidate.email as string) ?? '';
  if (name.toLowerCase().includes(searchLower)) return true;
  const location = (candidate.location as string) ?? '';
  if (location.toLowerCase().includes(searchLower)) return true;
  const skills = candidate.skills as string[] | undefined;
  if (Array.isArray(skills) && skills.some((s) => String(s).toLowerCase().includes(searchLower))) return true;
  return false;
}

/** GET /candidates — List candidates with optional search (name, location, skills) and pagination. Recruiter role required. */
export const handler: APIGatewayProxyHandler = async (event) => {
  const role = getRoleFromEvent(event);
  if (role !== 'recruiter') {
    return {
      statusCode: 403,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Only recruiters can list candidates' }),
    };
  }

  const { limit, exclusiveStartKey, search } = parseQueryParams(event);
  const searchLower = search ? search.toLowerCase() : null;

  if (!searchLower) {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: CANDIDATES_TABLE,
        Limit: limit,
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey as Record<string, { S?: string; N?: string }> }),
      })
    );
    const candidates = (result.Items ?? []).map((item) => unmarshall(item));
    const lastKey = result.LastEvaluatedKey ?? null;
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        candidates,
        lastEvaluatedKey: lastKey ? encodeURIComponent(JSON.stringify(lastKey)) : null,
        hasMore: !!lastKey,
      }),
    };
  }

  const SCAN_PAGE = 100;
  const collected: Record<string, unknown>[] = [];
  let nextKey: Record<string, unknown> | undefined = exclusiveStartKey;

  while (collected.length < limit) {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: CANDIDATES_TABLE,
        Limit: SCAN_PAGE,
        ...(nextKey && { ExclusiveStartKey: nextKey as Record<string, { S?: string; N?: string }> }),
      })
    );
    const items = (result.Items ?? []).map((item) => unmarshall(item));
    for (const candidate of items) {
      if (matchesSearch(candidate as Record<string, unknown>, searchLower)) {
        collected.push(candidate as Record<string, unknown>);
        if (collected.length >= limit) break;
      }
    }
    nextKey = result.LastEvaluatedKey ?? undefined;
    if (!nextKey || items.length === 0) break;
  }

  const lastKey = nextKey ?? null;
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      candidates: collected,
      lastEvaluatedKey: lastKey ? encodeURIComponent(JSON.stringify(lastKey)) : null,
      hasMore: !!lastKey,
    }),
  };
};
