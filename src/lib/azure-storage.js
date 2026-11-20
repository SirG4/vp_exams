import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

const AZURITE_CONNECTION_STRING = 'UseDevelopmentStorage=true';

let cachedClient;
let cachedContainerName;

export function resolveAzureConfig(env = process.env) {
  let connectionString = env.AZURE_STORAGE_CONNECTION_STRING;
  let accountUrl = env.AZURE_STORAGE_ACCOUNT_URL;

  if (!accountUrl && /^https?:\/\//i.test(connectionString || '')) {
    accountUrl = connectionString;
    connectionString = undefined;
  }

  const containerName = env.AZURE_STORAGE_CONTAINER || env.AZURE_STORAGE_CONTAINER_NAME;

  if (!containerName) {
    throw new Error('Azure Blob configuration is incomplete: AZURE_STORAGE_CONTAINER is required.');
  }

  return { connectionString, accountUrl, containerName };
}

export function getBlobContainerClient(env = process.env) {
  const config = resolveAzureConfig(env);
  if (cachedContainerName === config.containerName && cachedClient) return cachedClient;

  let serviceClient;
  if (config.connectionString) {
    serviceClient = BlobServiceClient.fromConnectionString(config.connectionString);
  } else if (config.accountUrl) {
    serviceClient = new BlobServiceClient(config.accountUrl, new DefaultAzureCredential());
  } else if (env.AZURITE_ACCOUNT_NAME && env.AZURITE_ACCOUNT_KEY) {
    throw new Error('Azurite credentials must be supplied with AZURE_STORAGE_CONNECTION_STRING; key variables are intentionally not logged.');
  } else {
    throw new Error('Azure Blob configuration is incomplete: set AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_URL.');
  }

  const client = serviceClient.getContainerClient(config.containerName);
  cachedClient = client;
  cachedContainerName = config.containerName;
  return client;
}

export async function ensurePrivateContainer(env = process.env) {
  const container = getBlobContainerClient(env);
  await container.createIfNotExists();
  return container;
}

export async function uploadBlob(blobKey, bytes, contentType = 'application/octet-stream', env = process.env) {
  const container = await ensurePrivateContainer(env);
  const blob = container.getBlockBlobClient(blobKey);
  const response = await blob.uploadData(bytes, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  return { blobKey, etag: response.etag, contentType };
}

export async function downloadBlob(blobKey, env = process.env) {
  const container = getBlobContainerClient(env);
  const blob = container.getBlobClient(blobKey);
  try {
    const download = await blob.download(0);
    const chunks = [];
    for await (const chunk of download.readableStreamBody) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return {
      bytes: Buffer.concat(chunks),
      contentType: download.contentType || 'application/octet-stream',
      etag: download.etag,
    };
  } catch (error) {
    if (error?.statusCode === 404 || error?.code === 'BlobNotFound') {
      return null;
    }
    throw error;
  }
}

export async function deleteBlob(blobKey, env = process.env) {
  const container = getBlobContainerClient(env);
  await container.getBlobClient(blobKey).deleteIfExists();
}

export async function resetAzureClientForTests() {
  cachedClient = undefined;
  cachedContainerName = undefined;
}

export { AZURITE_CONNECTION_STRING };
