import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDBStreamHandler, DynamoDBRecord } from 'aws-lambda';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const EMBEDDING_PROFILES_TABLE = process.env.EMBEDDING_PROFILES_TABLE_NAME!;
const CANDIDATES_TABLE = process.env.CANDIDATES_TABLE_NAME!;
const JOBS_TABLE = process.env.JOBS_TABLE_NAME!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CANDIDATES_TABLE_ARN_SUFFIX = 'topnurse-candidates';
const JOBS_TABLE_ARN_SUFFIX = 'topnurse-jobs';

type EntityType = 'CANDIDATE' | 'JOB';

function getTableName(record: DynamoDBRecord): string | null {
  const arn = record.eventSourceARN ?? '';
  const match = arn.match(/table\/([^/]+)/);
  return match ? match[1] : null;
}

/** Direct-invoke payload for backfill: generate one embedding from DB. */
export interface GeneratePayload {
  action: 'generate';
  entityType: 'CANDIDATE' | 'JOB';
  entityId: string;
  organizationId?: string;
}

async function generateFromStore(payload: GeneratePayload): Promise<{ ok: boolean; error?: string }> {
  const { entityType, entityId, organizationId } = payload;
  try {
    if (entityType === 'CANDIDATE') {
      const res = await docClient.send(
        new GetCommand({
          TableName: CANDIDATES_TABLE,
          Key: { email: entityId },
        })
      );
      const data = res.Item as Record<string, unknown> | undefined;
      if (!data) return { ok: false, error: 'Candidate not found' };
      const profileText = createProfileText('CANDIDATE', data);
      const embedding = await callOpenAIEmbedding(profileText);
      await storeEmbedding('CANDIDATE', 'CANDIDATES', entityId, embedding, profileText, data);
      return { ok: true };
    }
    if (entityType === 'JOB' && organizationId) {
      const jobId = entityId;
      const res = await docClient.send(
        new GetCommand({
          TableName: JOBS_TABLE,
          Key: { organizationId, jobId },
        })
      );
      const data = res.Item as Record<string, unknown> | undefined;
      if (!data) return { ok: false, error: 'Job not found' };
      const profileText = createProfileText('JOB', data);
      const embedding = await callOpenAIEmbedding(profileText);
      await storeEmbedding('JOB', organizationId, `JOB#${jobId}`, embedding, profileText, data);
      return { ok: true };
    }
    return { ok: false, error: 'Invalid payload' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** Derive years of experience from experience[] if present. */
function deriveYearsExperience(experience: Array<{ from_date?: { year?: string }; to_date?: { year?: string } }> | undefined): number {
  if (!Array.isArray(experience) || experience.length === 0) return 0;
  let totalMonths = 0;
  for (const exp of experience) {
    const fromYear = exp.from_date?.year ? parseInt(exp.from_date.year, 10) : null;
    const toYear = exp.to_date?.year ? parseInt(exp.to_date.year, 10) : null;
    if (fromYear && toYear && !Number.isNaN(fromYear) && !Number.isNaN(toYear)) {
      totalMonths += Math.max(0, (toYear - fromYear) * 12);
    }
  }
  return Math.round(totalMonths / 12) || 0;
}

function createProfileText(entityType: EntityType, data: Record<string, unknown>): string {
  if (entityType === 'CANDIDATE') {
    const name = (data.displayName as string) ?? (data.email as string) ?? 'Candidate';
    const skills = (data.skills as string[]) ?? [];
    const location = (data.location as string) ?? '';
    const summary = (data.summary as string) ?? '';
    const exp = data.experience as Array<Record<string, unknown>> | undefined;
    const years = deriveYearsExperience(exp as Array<{ from_date?: { year?: string }; to_date?: { year?: string } }> | undefined);
    const licenses = (data.licenses_and_certifications as Array<{ name?: string }>) ?? [];
    const licenseNames = licenses.map((l) => l.name).filter(Boolean).join(', ');
    return [
      `${name} is a nursing professional.`,
      years > 0 ? `Experience: ${years} years.` : '',
      skills.length ? `Skills and certifications: ${skills.join(', ')}.` : '',
      licenseNames ? `Licenses/certs: ${licenseNames}.` : '',
      location ? `Location: ${location}.` : '',
      summary ? `Summary: ${String(summary).slice(0, 300)}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  // JOB
  const title = (data.title as string) ?? 'Position';
  const description = (data.description as string) ?? '';
  const skills = (data.skills as string[]) ?? [];
  const location = (data.location as string) ?? '';
  const department = (data.department as string) ?? '';
  const employmentType = (data.employmentType as string) ?? '';
  const minYears = typeof data.minYearsExperience === 'number' ? data.minYearsExperience : 0;
  const remote = !!data.remote;
  return [
    `Job: ${title}.`,
    description ? `Description: ${String(description).slice(0, 400)}.` : '',
    skills.length ? `Required skills: ${skills.join(', ')}.` : '',
    location ? `Location: ${location}.` : '',
    department ? `Department: ${department}.` : '',
    employmentType ? `Employment type: ${employmentType}.` : '',
    minYears > 0 ? `Minimum experience: ${minYears} years.` : '',
    remote ? 'Remote or hybrid OK.' : 'On-site.',
  ]
    .filter(Boolean)
    .join(' ');
}

async function callOpenAIEmbedding(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000),
      encoding_format: 'float',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embeddings error: ${res.status} ${err}`);
  }
  const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  const embedding = data.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error('Invalid embedding response');
  return embedding;
}

async function storeEmbedding(
  entityType: EntityType,
  scope: string,
  entityId: string,
  embedding: number[],
  profileText: string,
  data: Record<string, unknown>
): Promise<void> {
  const skills = (data.skills as string[]) ?? [];
  const location = (data.location as string) ?? '';
  const now = new Date().toISOString();
  const item: Record<string, unknown> = {
    scope,
    entityId,
    entityType,
    embedding,
    profileText,
    skills,
    location,
    updatedAt: now,
  };
  if (entityType === 'CANDIDATE') {
    item.displayName = (data.displayName as string) ?? (data.email as string) ?? '';
    const exp = data.experience as Array<Record<string, unknown>> | undefined;
    item.experienceYears = deriveYearsExperience(exp as Array<{ from_date?: { year?: string }; to_date?: { year?: string } }> | undefined);
  } else {
    item.minYearsExperience = typeof data.minYearsExperience === 'number' ? data.minYearsExperience : undefined;
    item.remote = !!data.remote;
    item.department = (data.department as string) || undefined;
  }
  await docClient.send(
    new PutCommand({
      TableName: EMBEDDING_PROFILES_TABLE,
      Item: item,
    })
  );
}

async function deleteEmbedding(scope: string, entityId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: EMBEDDING_PROFILES_TABLE,
      Key: { scope, entityId },
    })
  );
}

async function processCandidateRecord(record: DynamoDBRecord): Promise<void> {
  const eventName = record.eventName;
  const keys = record.dynamodb?.Keys;
  if (!keys) return;
  const keyMap = unmarshall(keys) as Record<string, string>;
  const email = keyMap.email;
  if (!email) return;

  const scope = 'CANDIDATES';
  const entityId = email;

  if (eventName === 'REMOVE') {
    await deleteEmbedding(scope, entityId);
    return;
  }

  const newImage = record.dynamodb?.NewImage;
  if (!newImage) return;
  const data = unmarshall(newImage) as Record<string, unknown>;
  const profileText = createProfileText('CANDIDATE', data);
  const embedding = await callOpenAIEmbedding(profileText);
  await storeEmbedding('CANDIDATE', scope, entityId, embedding, profileText, data);
}

async function processJobRecord(record: DynamoDBRecord): Promise<void> {
  const eventName = record.eventName;
  const keys = record.dynamodb?.Keys;
  if (!keys) return;
  const keyMap = unmarshall(keys) as Record<string, string>;
  const organizationId = keyMap.organizationId;
  const jobId = keyMap.jobId;
  if (!organizationId || !jobId) return;

  const scope = organizationId;
  const entityId = `JOB#${jobId}`;

  if (eventName === 'REMOVE') {
    await deleteEmbedding(scope, entityId);
    return;
  }

  const newImage = record.dynamodb?.NewImage;
  if (!newImage) return;
  const data = unmarshall(newImage) as Record<string, unknown>;
  const profileText = createProfileText('JOB', data);
  const embedding = await callOpenAIEmbedding(profileText);
  await storeEmbedding('JOB', scope, entityId, embedding, profileText, data);
}

export const handler: DynamoDBStreamHandler = async (event) => {
  // Direct invocation for backfill: { action: 'generate', entityType, entityId, organizationId? }
  const asGenerate = event as unknown as GeneratePayload;
  if (asGenerate?.action === 'generate' && asGenerate?.entityType && asGenerate?.entityId) {
    const result = await generateFromStore(asGenerate);
    return result;
  }

  // DynamoDB stream
  const results: { recordId?: string; error?: string }[] = [];
  const records = (event as { Records?: DynamoDBRecord[] }).Records ?? [];
  for (const record of records) {
    const tableName = getTableName(record);
    try {
      if (tableName === CANDIDATES_TABLE_ARN_SUFFIX) {
        await processCandidateRecord(record);
      } else if (tableName === JOBS_TABLE_ARN_SUFFIX) {
        await processJobRecord(record);
      }
      results.push({ recordId: record.eventID });
    } catch (err) {
      console.error('Embedding generator error:', err);
      results.push({ recordId: record.eventID, error: (err as Error).message });
    }
  }
  return { processed: results.length, results };
};
