import { S3Client } from "@aws-sdk/client-s3";

export type ObjectStorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
};

export function objectStorageConfig(): ObjectStorageConfig | null {
  const bucket = process.env.BUCKET_NAME;
  if (!bucket) {
    return null;
  }

  return {
    bucket,
    region: process.env.AWS_REGION ?? "auto",
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    forcePathStyle: process.env.AWS_ENDPOINT_URL_S3 !== undefined,
  };
}

export function createObjectStorageClient(config: ObjectStorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
  });
}
