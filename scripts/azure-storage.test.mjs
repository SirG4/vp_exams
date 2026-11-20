import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deleteBlob,
  downloadBlob,
  ensurePrivateContainer,
  resetAzureClientForTests,
  uploadBlob,
} from '../src/lib/azure-storage.js';

const env = {
  AZURE_STORAGE_CONNECTION_STRING: 'UseDevelopmentStorage=true',
  AZURE_STORAGE_CONTAINER: 'vp-exams-test',
};

test('Azurite private container supports upload, download, missing blob, and deletion', async () => {
  await resetAzureClientForTests();
  const container = await ensurePrivateContainer(env);
  const bytes = Buffer.from('private exam image test');
  await uploadBlob('test/room-1.txt', bytes, 'text/plain', env);

  const downloaded = await downloadBlob('test/room-1.txt', env);
  assert.equal(downloaded.contentType, 'text/plain');
  assert.deepEqual(downloaded.bytes, bytes);
  assert.equal(await downloadBlob('test/missing.txt', env), null);

  await deleteBlob('test/room-1.txt', env);
  assert.equal(await downloadBlob('test/room-1.txt', env), null);

  const props = await container.getProperties();
  assert.ok(props);
  assert.notEqual(props.publicAccess, 'blob');
  assert.notEqual(props.publicAccess, 'container');

  await container.deleteIfExists();
});
