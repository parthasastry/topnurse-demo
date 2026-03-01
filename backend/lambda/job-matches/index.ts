import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchGetCommand,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandler } from 'aws-lambda';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const JOBS_TABLE = process.env.JOBS_TABLE_NAME!;
const CANDIDATES_TABLE = process.env.CANDIDATES_TABLE_NAME!;
const EMBEDDING_PROFILES_TABLE = process.env.EMBEDDING_PROFILES_TABLE_NAME!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const SHORTLIST_SIZE = 30;
const DEFAULT_LIMIT = 5;
const OPENAI_TIMEOUT_MS = 45_000;

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

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

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

interface EmbeddingItem {
  scope: string;
  entityId: string;
  entityType: string;
  embedding: number[];
  profileText?: string;
  skills?: string[];
  location?: string;
  displayName?: string;
  experienceYears?: number;
  minYearsExperience?: number;
  updatedAt?: string;
}

/** GET /jobs/{jobId}/matches — Option C: embedding shortlist + LLM rationale. Recruiter only. */
export const handler: APIGatewayProxyHandler = async (event) => {
  const role = getRole(event);
  if (role !== 'recruiter') {
    return json(403, { error: 'Only recruiters can view job matches' });
  }
  const organizationId = getOrganizationId(event);
  if (!organizationId) {
    return json(400, { error: 'Organization not found' });
  }

  const jobId = event.pathParameters?.jobId;
  if (!jobId) return json(400, { error: 'jobId is required' });

  const limitParam = event.queryStringParameters?.limit;
  const limit = Math.min(
    DEFAULT_LIMIT,
    Math.max(1, parseInt(limitParam ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );

  try {
    // 1) Load job and verify org
    const jobRes = await docClient.send(
      new GetCommand({
        TableName: JOBS_TABLE,
        Key: { organizationId, jobId },
      })
    );
    const job = jobRes.Item as Record<string, unknown> | undefined;
    if (!job) return json(404, { error: 'Job not found' });

    // 2) Get job embedding
    const jobEmbedRes = await docClient.send(
      new GetCommand({
        TableName: EMBEDDING_PROFILES_TABLE,
        Key: { scope: organizationId, entityId: `JOB#${jobId}` },
      })
    );
    const jobEmbed = jobEmbedRes.Item as EmbeddingItem | undefined;
    if (!jobEmbed?.embedding) {
      return json(503, {
        error: 'Job embedding not ready. Save the job again and try in a moment.',
      });
    }

    // 3) Get all candidate embeddings
    const candidateEmbedRes = await docClient.send(
      new QueryCommand({
        TableName: EMBEDDING_PROFILES_TABLE,
        KeyConditionExpression: '#scope = :scope',
        ExpressionAttributeNames: { '#scope': 'scope' },
        ExpressionAttributeValues: { ':scope': 'CANDIDATES' },
      })
    );
    const candidateEmbeds = (candidateEmbedRes.Items ?? []) as EmbeddingItem[];
    if (candidateEmbeds.length === 0) {
      const jobDesc = typeof job.description === 'string' ? job.description : '';
      const brief = jobDesc.length > 300 ? jobDesc.slice(0, 297) + '…' : jobDesc;
      return json(200, {
        matches: [],
        jobTitle: job.title,
        jobLocation: job.location ?? undefined,
        jobDescription: brief || undefined,
        jobDepartment: job.department ?? undefined,
      });
    }

    // 4) Cosine similarity shortlist
    const jobVec = jobEmbed.embedding;
    const withScore = candidateEmbeds.map((c) => ({
      ...c,
      similarity: cosineSimilarity(jobVec, c.embedding),
    }));
    withScore.sort((a, b) => b.similarity - a.similarity);
    const shortlist = withScore.slice(0, SHORTLIST_SIZE);

    // 5) LLM: rank + rationale
    const matches = await rankWithLLM(
      job as Record<string, unknown>,
      shortlist.map((s) => ({
        email: s.entityId,
        profileText: (s.profileText ?? '').slice(0, 400),
        skills: s.skills ?? [],
        location: s.location ?? '',
      }))
    );

    // 6) Enrich with displayName from embedding; fallback to candidates table for current name
    const shortlistEmails = [...new Set(shortlist.map((s) => s.entityId))];
    const candidateProfiles = await docClient.send(
      new BatchGetCommand({
        RequestItems: {
          [CANDIDATES_TABLE]: {
            Keys: shortlistEmails.map((email) => ({ email })),
          },
        },
      })
    );
    const profilesByEmail = new Map<string, { displayName?: string }>();
    for (const item of candidateProfiles.Responses?.[CANDIDATES_TABLE] ?? []) {
      const email = (item as { email?: string }).email;
      if (email) {
        profilesByEmail.set(email, {
          displayName: (item as { displayName?: string }).displayName ?? '',
        });
      }
    }

    const shortlistByEmail = new Map(
      shortlist.map((s) => [
        s.entityId,
        { skills: s.skills ?? [], location: (s.location ?? '') as string, displayName: (s.displayName ?? '') as string },
      ])
    );
    const enriched = matches.slice(0, limit).map((m) => {
      const fromEmbedding = shortlistByEmail.get(m.email)?.displayName ?? '';
      const fromProfile = profilesByEmail.get(m.email)?.displayName ?? '';
      const displayName = (fromProfile && fromProfile.trim()) || (fromEmbedding && fromEmbedding.trim()) || '';
      return {
        ...m,
        skills: shortlistByEmail.get(m.email)?.skills ?? [],
        location: shortlistByEmail.get(m.email)?.location ?? '',
        displayName,
      };
    });

    const jobDescription = typeof job.description === 'string' ? job.description : '';
    const briefDescription = jobDescription.length > 300 ? jobDescription.slice(0, 297) + '…' : jobDescription;

    return json(200, {
      matches: enriched,
      jobTitle: job.title,
      jobLocation: job.location ?? undefined,
      jobDescription: briefDescription || undefined,
      jobDepartment: job.department ?? undefined,
    });
  } catch (e) {
    console.error('job-matches error:', e);
    const message = e instanceof Error ? e.message : 'Failed to get matches';
    return json(500, { error: message });
  }
};

interface CandidateSummary {
  email: string;
  profileText: string;
  skills: string[];
  location: string;
}

interface RankedMatch {
  email: string;
  rank: number;
  rationale: string;
}

async function rankWithLLM(
  job: Record<string, unknown>,
  candidates: CandidateSummary[]
): Promise<RankedMatch[]> {
  if (candidates.length === 0) return [];
  if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

  const jobBlock = [
    `Job: ${job.title ?? 'Position'}`,
    job.description ? `Description: ${String(job.description).slice(0, 500)}` : '',
    (job.skills as string[])?.length ? `Required skills: ${(job.skills as string[]).join(', ')}` : '',
    job.location ? `Location: ${job.location}` : '',
    typeof job.minYearsExperience === 'number' ? `Min experience: ${job.minYearsExperience} years` : '',
    job.remote ? 'Remote or hybrid OK.' : '',
  ]
    .filter(Boolean)
    .join('\n');

  const candidateBlocks = candidates
    .map(
      (c, i) =>
        `[${i}] Email: ${c.email}\nProfile: ${c.profileText}\nSkills: ${(c.skills ?? []).join(', ')}\nLocation: ${c.location ?? 'Not specified'}`
    )
    .join('\n\n');

  const prompt = `You are a nurse recruiter. Given the job below and the candidate profiles, rank the candidates from best to worst fit (1 = best). For each candidate provide a 1-2 sentence rationale explaining why they fit or what is missing.

Return ONLY a valid JSON array, no markdown or extra text. Each element: { "email": "candidate@example.com", "rank": 1, "rationale": "One sentence." }
Use the exact email from each [N] block. Preserve all emails and assign ranks 1 to ${candidates.length}.

Job:
${jobBlock}

Candidates:
${candidateBlocks}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === 'AbortError') {
      throw new Error('Matching timed out. Try again.');
    }
    throw e;
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? '';
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error('No JSON array in LLM response:', content.slice(0, 500));
    return candidates.map((c, i) => ({
      email: c.email,
      rank: i + 1,
      rationale: 'Ranking unavailable.',
    }));
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{ email?: string; rank?: number; rationale?: string }>;
    const byEmail = new Map<string, RankedMatch>();
    for (const item of parsed) {
      const email = typeof item.email === 'string' ? item.email : '';
      if (email) {
        byEmail.set(email, {
          email,
          rank: typeof item.rank === 'number' ? item.rank : byEmail.size + 1,
          rationale: typeof item.rationale === 'string' ? item.rationale : '',
        });
      }
    }
    // Preserve order by rank; add any missing from shortlist
    const ordered: RankedMatch[] = [];
    const seen = new Set<string>();
    for (const c of candidates) {
      const m = byEmail.get(c.email);
      if (m && !seen.has(c.email)) {
        seen.add(c.email);
        ordered.push(m);
      }
    }
    for (const [email, m] of byEmail) {
      if (!seen.has(email)) ordered.push(m);
    }
    ordered.sort((a, b) => a.rank - b.rank);
    return ordered;
  } catch {
    return candidates.map((c, i) => ({
      email: c.email,
      rank: i + 1,
      rationale: 'Could not parse ranking.',
    }));
  }
}
