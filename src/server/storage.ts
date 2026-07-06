import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

let client: S3Client | null = null;
function r2(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: required("R2_ACCESS_KEY_ID"),
        secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return client;
}
const bucket = () => required("R2_BUCKET");

export async function presignUpload(key: string, contentType: string, expiresIn = 600): Promise<string> {
  return getSignedUrl(
    r2(),
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
    { expiresIn },
  );
}

export async function presignDownload(key: string, expiresIn = 900): Promise<string> {
  return getSignedUrl(r2(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn });
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await r2().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!res.Body) throw new Error("EMPTY_OBJECT");
  return Buffer.from(await res.Body.transformToByteArray());
}

export async function putObjectBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
  await r2().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
}

export async function deleteObjects(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await r2().send(new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
    }));
  }
}
