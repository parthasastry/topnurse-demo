import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { APIGatewayProxyHandler } from 'aws-lambda';

const dynamo = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamo);
const lambda = new LambdaClient({});

const CANDIDATES_TABLE = process.env.CANDIDATES_TABLE_NAME!;
const JOBS_TABLE = process.env.JOBS_TABLE_NAME!;
const EMBEDDING_GENERATOR_FN = process.env.EMBEDDING_GENERATOR_FN!;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const DELAY_MS = 150;

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function getRole(event: Parameters<APIGatewayProxyHandler>[0]): string | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  return claims?.['custom:role'] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run backfill: scan candidates and jobs, invoke embedding-generator for each. */
async function runBackfill(): Promise<{
  success: boolean;
  candidatesProcessed: number;
  jobsProcessed: number;
  errorCount: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let candidatesProcessed = 0;
  let jobsProcessed = 0;

  try {
    // Scan all candidates
    let candidateExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await docClient.send(
        new ScanCommand({
          TableName: CANDIDATES_TABLE,
          ExclusiveStartKey: candidateExclusiveStartKey,
          Limit: 50,
        })
      );
      const items = (res.Items ?? []) as Array<{ email: string }>;
      for (const item of items) {
        const email = item.email;
        if (!email) continue;
        const payload = JSON.stringify({
          action: 'generate',
          entityType: 'CANDIDATE',
          entityId: email,
        });
        const invokeRes = await lambda.send(
          new InvokeCommand({
            FunctionName: EMBEDDING_GENERATOR_FN,
            InvocationType: 'RequestResponse',
            Payload: new TextEncoder().encode(payload),
          })
        );
        if (invokeRes.FunctionError) {
          errors.push(`Candidate ${email}: ${invokeRes.FunctionError}`);
        } else if (invokeRes.Payload) {
          const result = JSON.parse(new TextDecoder().decode(invokeRes.Payload)) as { ok?: boolean; error?: string };
          if (result.ok) candidatesProcessed++;
          else if (result.error) errors.push(`Candidate ${email}: ${result.error}`);
        }
        await sleep(DELAY_MS);
      }
      candidateExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (candidateExclusiveStartKey);

    // Scan all jobs (all partitions)
    let jobExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await docClient.send(
        new ScanCommand({
          TableName: JOBS_TABLE,
          ExclusiveStartKey: jobExclusiveStartKey,
          Limit: 50,
        })
      );
      const items = (res.Items ?? []) as Array<{ organizationId: string; jobId: string }>;
      for (const item of items) {
        const { organizationId, jobId } = item;
        if (!organizationId || !jobId) continue;
        const payload = JSON.stringify({
          action: 'generate',
          entityType: 'JOB',
          entityId: jobId,
          organizationId,
        });
        const invokeRes = await lambda.send(
          new InvokeCommand({
            FunctionName: EMBEDDING_GENERATOR_FN,
            InvocationType: 'RequestResponse',
            Payload: new TextEncoder().encode(payload),
          })
        );
        if (invokeRes.FunctionError) {
          errors.push(`Job ${organizationId}/${jobId}: ${invokeRes.FunctionError}`);
        } else if (invokeRes.Payload) {
          const result = JSON.parse(new TextDecoder().decode(invokeRes.Payload)) as { ok?: boolean; error?: string };
          if (result.ok) jobsProcessed++;
          else if (result.error) errors.push(`Job ${jobId}: ${result.error}`);
        }
        await sleep(DELAY_MS);
      }
      jobExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (jobExclusiveStartKey);

    return {
      success: true,
      candidatesProcessed,
      jobsProcessed,
      errorCount: errors.length,
      errors: errors.slice(0, 20),
    };
  } catch (e) {
    console.error('Embedding backfill error:', e);
    return {
      success: false,
      candidatesProcessed,
      jobsProcessed,
      errorCount: errors.length,
      errors: [...errors.slice(0, 10), e instanceof Error ? e.message : 'Backfill failed'],
    };
  }
}

/** POST /admin/embedding-backfill (API) or direct invoke from AWS Console / CLI. */
export const handler: APIGatewayProxyHandler = async (event) => {
  const isApiGateway = typeof event.httpMethod === 'string';
  if (isApiGateway) {
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }
    const role = getRole(event);
    if (role !== 'recruiter') {
      return json(403, { error: 'Only recruiters can run the embedding backfill' });
    }
  }

  const result = await runBackfill();
  if (isApiGateway) {
    return result.success
      ? json(200, result)
      : json(500, { ...result, error: 'Backfill completed with errors' });
  }
  return result;
};
