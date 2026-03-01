import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type { APIGatewayProxyHandler } from 'aws-lambda';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const JOBS_TABLE = process.env.JOBS_TABLE_NAME!;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export type JobStatus = 'draft' | 'active' | 'fulfilled';

const JOB_STATUSES: JobStatus[] = ['draft', 'active', 'fulfilled'];

function getClaims(event: Parameters<APIGatewayProxyHandler>[0]): Record<string, string> | undefined {
  return event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
}

function getOrganizationId(event: Parameters<APIGatewayProxyHandler>[0]): string | null {
  const claims = getClaims(event);
  if (!claims) return null;
  return (claims['custom:organizationId'] as string) ?? null;
}

function getRole(event: Parameters<APIGatewayProxyHandler>[0]): string | null {
  const claims = getClaims(event);
  if (!claims) return null;
  return (claims['custom:role'] as string) ?? null;
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

function parseBody(event: Parameters<APIGatewayProxyHandler>[0]): Record<string, unknown> | null {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseStatus(v: unknown): JobStatus {
  if (v === 'draft' || v === 'active' || v === 'fulfilled') return v;
  return 'draft';
}

function parseString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t === '' ? undefined : t;
}

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const arr = value.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

/** List jobs for the recruiter's organization. Optional query: status=draft|active|fulfilled */
async function listJobs(organizationId: string, queryParams: Record<string, string | undefined>) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: JOBS_TABLE,
      KeyConditionExpression: 'organizationId = :orgId',
      ExpressionAttributeValues: { ':orgId': organizationId },
    })
  );
  let items = (result.Items ?? []) as Array<Record<string, unknown> & { status: JobStatus }>;
  const statusFilter = queryParams.status as JobStatus | undefined;
  if (statusFilter && JOB_STATUSES.includes(statusFilter)) {
    items = items.filter((j) => j.status === statusFilter);
  }
  return json(200, { jobs: items });
}

/** Build job item from body (create or full replace). Default status = draft. */
function buildJobFromBody(
  body: Record<string, unknown>,
  organizationId: string,
  jobId: string,
  createdAt: string,
  updatedAt: string,
  existing?: Record<string, unknown>
): Record<string, unknown> {
  const title = parseString(body.title) ?? parseString(existing?.title) ?? '';
  const status = parseStatus(body.status ?? existing?.status) ?? 'draft';
  const item: Record<string, unknown> = {
    organizationId,
    jobId,
    title,
    description: parseString(body.description) ?? existing?.description,
    status,
    location: parseString(body.location) ?? existing?.location,
    department: parseString(body.department) ?? existing?.department,
    employmentType: parseString(body.employmentType) ?? existing?.employmentType,
    minYearsExperience: parseNumber(body.minYearsExperience) ?? (existing?.minYearsExperience as number | undefined),
    skills: parseStringArray(body.skills) ?? (existing?.skills as string[] | undefined),
    remote: parseBoolean(body.remote) ?? (existing?.remote as boolean | undefined),
    sourceDescription: parseString(body.sourceDescription) ?? (existing?.sourceDescription as string | undefined),
    createdAt,
    updatedAt,
  };
  return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined));
}

/** Create a job. Body: title (required), description?, status? (default draft), location?, department?, employmentType?, minYearsExperience?, skills?, remote? */
async function createJob(organizationId: string, event: Parameters<APIGatewayProxyHandler>[0]) {
  const body = parseBody(event);
  if (body === null) return json(400, { error: 'Invalid JSON body' });
  const title = parseString(body.title);
  if (!title) return json(400, { error: 'title is required' });
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const status = parseStatus(body.status);
  const item = buildJobFromBody(body, organizationId, jobId, now, now, { title, status });
  await docClient.send(
    new PutCommand({
      TableName: JOBS_TABLE,
      Item: item,
    })
  );
  return json(201, item);
}

/** Get one job by organizationId and jobId */
async function getJob(organizationId: string, jobId: string) {
  const result = await docClient.send(
    new GetCommand({
      TableName: JOBS_TABLE,
      Key: { organizationId, jobId },
    })
  );
  if (!result.Item) return json(404, { error: 'Job not found' });
  return json(200, result.Item);
}

/** Update job. Body: any subset of job fields; status can be draft | active | fulfilled */
async function updateJob(organizationId: string, jobId: string, event: Parameters<APIGatewayProxyHandler>[0]) {
  const body = parseBody(event);
  if (body === null) return json(400, { error: 'Invalid JSON body' });

  const existingResult = await docClient.send(
    new GetCommand({
      TableName: JOBS_TABLE,
      Key: { organizationId, jobId },
    })
  );
  if (!existingResult.Item) return json(404, { error: 'Job not found' });
  const existing = existingResult.Item as Record<string, unknown>;

  const updates: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  const title = parseString(body.title);
  if (title !== undefined) {
    if (!title) return json(400, { error: 'title cannot be empty' });
    updates.push('#title = :title');
    names['#title'] = 'title';
    values[':title'] = title;
  }
  if (body.description !== undefined) {
    updates.push('#description = :description');
    names['#description'] = 'description';
    values[':description'] = parseString(body.description) ?? null;
  }
  if (body.status !== undefined && JOB_STATUSES.includes(parseStatus(body.status))) {
    updates.push('#status = :status');
    names['#status'] = 'status';
    values[':status'] = parseStatus(body.status);
  }
  if (body.location !== undefined) {
    updates.push('#location = :location');
    names['#location'] = 'location';
    values[':location'] = parseString(body.location) ?? null;
  }
  if (body.department !== undefined) {
    updates.push('#department = :department');
    names['#department'] = 'department';
    values[':department'] = parseString(body.department) ?? null;
  }
  if (body.employmentType !== undefined) {
    updates.push('#employmentType = :employmentType');
    names['#employmentType'] = 'employmentType';
    values[':employmentType'] = parseString(body.employmentType) ?? null;
  }
  if (body.minYearsExperience !== undefined) {
    updates.push('#minYearsExperience = :minYearsExperience');
    names['#minYearsExperience'] = 'minYearsExperience';
    values[':minYearsExperience'] = parseNumber(body.minYearsExperience) ?? null;
  }
  if (body.skills !== undefined) {
    updates.push('#skills = :skills');
    names['#skills'] = 'skills';
    values[':skills'] = parseStringArray(body.skills) ?? null;
  }
  if (body.remote !== undefined) {
    updates.push('#remote = :remote');
    names['#remote'] = 'remote';
    values[':remote'] = parseBoolean(body.remote) ?? null;
  }
  if (body.sourceDescription !== undefined) {
    updates.push('#sourceDescription = :sourceDescription');
    names['#sourceDescription'] = 'sourceDescription';
    values[':sourceDescription'] = parseString(body.sourceDescription) ?? null;
  }

  if (updates.length === 0) return json(400, { error: 'No updatable fields provided' });

  const now = new Date().toISOString();
  updates.push('#updatedAt = :updatedAt');
  names['#updatedAt'] = 'updatedAt';
  values[':updatedAt'] = now;

  const result = await docClient.send(
    new UpdateCommand({
      TableName: JOBS_TABLE,
      Key: { organizationId, jobId },
      UpdateExpression: 'SET ' + updates.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(organizationId) AND attribute_exists(jobId)',
      ReturnValues: 'ALL_NEW',
    })
  ).catch((e: { name?: string }) => {
    if (e.name === 'ConditionalCheckFailedException') throw { statusCode: 404 as const };
    throw e;
  });
  return json(200, result.Attributes);
}

/** Delete a job */
async function deleteJob(organizationId: string, jobId: string) {
  await docClient.send(
    new DeleteCommand({
      TableName: JOBS_TABLE,
      Key: { organizationId, jobId },
      ConditionExpression: 'attribute_exists(organizationId) AND attribute_exists(jobId)',
    })
  ).catch((e: { name?: string }) => {
    if (e.name === 'ConditionalCheckFailedException') throw { statusCode: 404 as const };
    throw e;
  });
  return json(200, { success: true });
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const role = getRole(event);
  if (role !== 'recruiter') {
    return json(403, { error: 'Only recruiters can manage jobs' });
  }
  const organizationId = getOrganizationId(event);
  if (!organizationId) {
    return json(400, { error: 'Organization not found. Recruiters must have an organization.' });
  }

  const jobId = event.pathParameters?.jobId;
  const httpMethod = event.httpMethod;
  const queryParams = event.queryStringParameters ?? {};

  try {
    if (!jobId) {
      if (httpMethod === 'GET') return await listJobs(organizationId, queryParams);
      if (httpMethod === 'POST') return await createJob(organizationId, event);
      return json(405, { error: 'Method not allowed' });
    }
    if (httpMethod === 'GET') return await getJob(organizationId, jobId);
    if (httpMethod === 'PUT') return await updateJob(organizationId, jobId, event);
    if (httpMethod === 'DELETE') return await deleteJob(organizationId, jobId);
    return json(405, { error: 'Method not allowed' });
  } catch (e: unknown) {
    const err = e as { statusCode?: number };
    if (err.statusCode === 404) return json(404, { error: 'Job not found' });
    console.error(e);
    return json(500, { error: 'Internal server error' });
  }
};
