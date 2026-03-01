import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { APIGatewayProxyHandler } from 'aws-lambda';

const s3 = new S3Client({});
const BUCKET = process.env.RESUMES_BUCKET_NAME!;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx']);
const MAX_FILENAME_LENGTH = 200;

function getEmailFromEvent(event: Parameters<APIGatewayProxyHandler>[0]): string | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, string> | undefined;
  if (!claims) return null;
  return claims.email ?? claims['cognito:username'] ?? null;
}

function getExtension(filename: string): string | null {
  const lower = filename.toLowerCase().trim();
  const lastDot = lower.lastIndexOf('.');
  if (lastDot === -1 || lastDot === lower.length - 1) return null;
  const ext = lower.slice(lastDot + 1);
  return ALLOWED_EXTENSIONS.has(ext) ? ext : null;
}

/** Sanitize for S3 key: keep only safe chars (alphanumeric, hyphen, underscore, dot). */
function sanitizeKeyPart(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, MAX_FILENAME_LENGTH);
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

  let body: { filename?: string } = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  const ext = filename ? getExtension(filename) : 'pdf';
  if (!ext) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'Invalid or missing file extension. Allowed: .pdf, .docx',
      }),
    };
  }

  const safeEmail = sanitizeKeyPart(email);
  /** Single key per candidate so each upload overwrites the previous (true replace). */
  const key = `candidates/${safeEmail}/resume`;

  const contentType =
    ext === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const expiresIn = 900;
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn });

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      uploadUrl,
      key,
      contentType,
      expiresIn,
    }),
  };
};
