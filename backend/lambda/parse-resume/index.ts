import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import mammoth from 'mammoth';
import type { APIGatewayProxyHandler } from 'aws-lambda';

const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

const BUCKET = process.env.RESUMES_BUCKET_NAME!;
const CANDIDATES_TABLE = process.env.CANDIDATES_TABLE_NAME!;
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

/** Keep under API Gateway 29s limit: less text = faster OpenAI. Most resumes fit in 12k. */
const MAX_TEXT_LENGTH = 12_000;
const OPENAI_TIMEOUT_MS = 18_000;

function getEmailFromEvent(event: Parameters<APIGatewayProxyHandler>[0]): string | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  if (!claims) return null;
  return claims.email ?? claims['cognito:username'] ?? null;
}

/** Extract text from DOCX buffer (multi-tenant-ats pattern with mammoth). */
async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? '';
}

/**
 * Extract text from PDF buffer. Currently uses pdf-parse (Node).
 * If quality or reliability is an issue, fallback: use Python PDF parser (e.g. wealth-ai-llc
 * pdf-parser Lambda with pdfplumber/OCR) and invoke it from here, or replace this Lambda
 * with a step that calls the Python parser and then runs OpenAI on the returned text.
 */
async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return (data?.text as string) ?? '';
}

/** Detect content type from S3 object or Body. We have no extension on key, so use ContentType. */
function isPdf(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes('pdf');
}

/** Truncate for LLM token limit. */
function truncateForLlm(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_TEXT_LENGTH) return t;
  return t.slice(0, MAX_TEXT_LENGTH) + '\n\n[Truncated for length.]';
}

const EXTRACTION_PROMPT = `You are extracting structured profile data from a resume (nurse or healthcare professional). Return ONLY a single valid JSON object, no markdown or explanation.

Use this exact shape. Omit any field you cannot find; use empty string or empty array as appropriate. For dates use only month and year when possible (e.g. "June", "2020").

{
  "displayName": "string or null",
  "phone": "string or null",
  "summary": "string or null",
  "skills": ["string"],
  "experience": [
    {
      "organization": "string",
      "job_title": "string",
      "location": "string",
      "from_date": { "month": "string", "year": "string" },
      "to_date": { "month": "string", "year": "string" },
      "description": "string"
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field_of_study": "string or null",
      "from_date": { "month": "string", "year": "string" },
      "to_date": { "month": "string", "year": "string" },
      "description": "string or null",
      "honors": "string or null"
    }
  ],
  "licenses_and_certifications": [
    {
      "name": "string",
      "institution": "string or null",
      "from_date": { "month": "string", "year": "string" } or null,
      "to_date": { "month": "string", "year": "string" } or null
    }
  ]
}

Resume text:

`;

/** Call OpenAI to extract JSON (multi-tenant-ats pattern). Uses gpt-3.5-turbo for speed. */
async function extractWithOpenAI(rawText: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set');
    throw new Error('OpenAI API key not configured');
  }

  const truncated = truncateForLlm(rawText);
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
        temperature: 0,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as Error).name === 'AbortError') {
      throw new Error('AI extraction timed out. Try a shorter resume or try again.');
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

export const handler: APIGatewayProxyHandler = async (event) => {
  const email = getEmailFromEvent(event);
  if (!email) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  const candidateRes = await dynamo.send(
    new GetItemCommand({
      TableName: CANDIDATES_TABLE,
      Key: { email: { S: email } },
    })
  );
  const candidate = candidateRes.Item ? unmarshall(candidateRes.Item) as Record<string, unknown> : null;
  const resumeKey = candidate?.resumeKey as string | undefined;
  if (!resumeKey || typeof resumeKey !== 'string') {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'No resume uploaded. Upload a resume first.' }),
    };
  }

  let body: Buffer;
  let contentType: string | undefined;
  try {
    const getRes = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: resumeKey,
      })
    );
    const stream = getRes.Body;
    if (!stream) throw new Error('Empty body');
    body = Buffer.from(await stream.transformToByteArray());
    contentType = getRes.ContentType ?? undefined;
  } catch (e) {
    console.error('S3 GetObject failed:', e);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to read resume file.' }),
    };
  }

  let rawText: string;
  try {
    if (isPdf(contentType)) {
      rawText = await extractTextFromPdf(body);
    } else {
      rawText = await extractTextFromDocx(body);
    }
  } catch (e) {
    console.error('Text extraction failed:', e);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Could not extract text from this file. Try a different format.' }),
    };
  }

  if (!rawText || !rawText.trim()) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'No text could be extracted from the resume.' }),
    };
  }

  let suggested: Record<string, unknown>;
  try {
    suggested = await extractWithOpenAI(rawText);
  } catch (e) {
    console.error('OpenAI extraction failed:', e);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'AI extraction failed. Please fill the form manually.' }),
    };
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      rawText: rawText.slice(0, 20_000),
      suggested,
    }),
  };
};
