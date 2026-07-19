import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config.js';

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.R2_ACCESS_KEY_ID!,
        secretAccessKey: config.R2_SECRET_ACCESS_KEY!,
      },
      // Recent @aws-sdk/client-s3 versions default to adding a flexible checksum
      // header (x-amz-checksum-*) on every request. R2 is S3-compatible but doesn't
      // support that AWS-specific extension, so uploads/downloads fail against R2
      // unless this is explicitly turned off - a well-known AWS SDK v3 + R2
      // incompatibility, not an R2 credentials/bucket problem.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return _client;
}

const bucket = () => config.R2_BUCKET_NAME ?? '4client-files';

export const storage = {
  isConfigured(): boolean {
    return !!(config.R2_ACCOUNT_ID && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY);
  },

  async upload(key: string, buffer: Buffer, contentType = 'application/pdf'): Promise<string> {
    await getClient().send(new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    const base = config.R2_PUBLIC_URL ?? `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket()}`;
    return `${base}/${key}`;
  },

  async download(key: string): Promise<Buffer> {
    const res = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  },
};
