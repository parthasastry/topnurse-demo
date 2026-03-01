import type { APIGatewayProxyHandler } from 'aws-lambda';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const MAX_DESCRIPTION_LENGTH = 2000;
const OPENAI_TIMEOUT_MS = 15_000;

const EMPLOYMENT_TYPES = ['full-time', 'part-time', 'per-diem', 'contract'] as const;
type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** Response shape for pre-filling the create-job form. */
export interface JobFromDescriptionSuggestion {
  title: string;
  description?: string;
  location?: string;
  department?: string;
  employmentType?: EmploymentType;
  minYearsExperience?: number;
  skills?: string[];
  remote?: boolean;
}

function getRole(event: Parameters<APIGatewayProxyHandler>[0]): string | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  if (!claims) return null;
  return (claims['custom:role'] as string) ?? null;
}

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

const EXTRACTION_PROMPT = `You are a recruiter assistant. Given a natural-language job description (often informal or bullet-style), extract structured fields for a nursing/healthcare job posting AND write a complete, professional job description.

Return ONLY a single valid JSON object, no markdown or explanation. Use this exact shape. Omit fields you cannot infer; use null for missing. For employmentType use exactly one of: "full-time", "part-time", "per-diem", "contract". For skills use an array of strings (e.g. certifications like BLS, ACLS, or skill names). For remote use true/false.

IMPORTANT for "description": Do not just copy the input. Write a full, ready-to-publish job description (2–4 paragraphs) that includes: a brief overview of the role and organization/unit, key responsibilities, required qualifications and experience, and preferred skills or certifications. Use clear paragraphs and professional tone. Base all content on the recruiter's input; do not invent details they did not mention.

{
  "title": "string (required; concise job title e.g. Registered Nurse – ICU)",
  "description": "string (required; full 2–4 paragraph job description as described above)",
  "location": "string or null (e.g. city, state or 'Remote')",
  "department": "string or null (e.g. ICU, ER, NICU, Med-Surg)",
  "employmentType": "full-time" | "part-time" | "per-diem" | "contract" | null,
  "minYearsExperience": number or null,
  "skills": ["string"] or null,
  "remote": true | false
}

Job description from recruiter:
`;

/** Call OpenAI to extract structured job fields from natural language. */
async function extractWithOpenAI(userDescription: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set');
    throw new Error('OpenAI API key not configured');
  }

  const truncated =
    userDescription.length > MAX_DESCRIPTION_LENGTH
      ? userDescription.slice(0, MAX_DESCRIPTION_LENGTH) + '\n\n[Truncated for length.]'
      : userDescription;
  const prompt = EXTRACTION_PROMPT + truncated;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === 'AbortError') {
      throw new Error('AI extraction timed out. Try a shorter description or try again.');
    }
    throw e;
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    const err = await res.text();
    console.error('OpenAI API error:', res.status, err);
    throw new Error(`OpenAI API error: ${res.status}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return {};
  try {
    return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Validate and sanitize LLM output into JobFromDescriptionSuggestion. */
function sanitize(raw: Record<string, unknown>): JobFromDescriptionSuggestion {
  const title =
    typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim()
      : 'Untitled position';
  const suggestion: JobFromDescriptionSuggestion = { title };

  if (typeof raw.description === 'string' && raw.description.trim()) {
    suggestion.description = raw.description.trim();
  }
  if (typeof raw.location === 'string' && raw.location.trim()) {
    suggestion.location = raw.location.trim();
  }
  if (typeof raw.department === 'string' && raw.department.trim()) {
    suggestion.department = raw.department.trim();
  }
  if (
    typeof raw.employmentType === 'string' &&
    EMPLOYMENT_TYPES.includes(raw.employmentType as EmploymentType)
  ) {
    suggestion.employmentType = raw.employmentType as EmploymentType;
  }
  if (typeof raw.minYearsExperience === 'number' && Number.isFinite(raw.minYearsExperience)) {
    suggestion.minYearsExperience = Math.max(0, Math.floor(raw.minYearsExperience));
  }
  if (Array.isArray(raw.skills)) {
    const skills = raw.skills
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
    if (skills.length) suggestion.skills = skills;
  }
  if (raw.remote === true || raw.remote === 'true') {
    suggestion.remote = true;
  } else if (raw.remote === false || raw.remote === 'false') {
    suggestion.remote = false;
  }

  return suggestion;
}

/**
 * POST /jobs/from-description
 * Body: { description: string }
 * Returns: { suggested: JobFromDescriptionSuggestion } for pre-filling the create-job form.
 * Recruiter only.
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const role = getRole(event);
  if (role !== 'recruiter') {
    return json(403, { error: 'Only recruiters can use the job-from-description copilot' });
  }

  let body: Record<string, unknown>;
  try {
    body = event.body ? (JSON.parse(event.body) as Record<string, unknown>) : {};
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) {
    return json(400, { error: 'description is required' });
  }

  try {
    const raw = await extractWithOpenAI(description);
    const suggested = sanitize(raw);
    return json(200, { suggested });
  } catch (e) {
    console.error('job-from-description error:', e);
    const message = e instanceof Error ? e.message : 'Failed to generate job from description';
    return json(500, { error: message });
  }
};
