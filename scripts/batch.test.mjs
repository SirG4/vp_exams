import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import sharp from 'sharp';

import { BATCH_LIMITS, parseAndValidateBatch } from '../src/lib/batch.js';

async function manifest(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Exam Batch');
  sheet.addRow(['institution', 'date', 'session', 'roomNumber', 'roomLabel', 'imageFilename']);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function file(name, bytes) {
  return { name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

function formData(manifestBytes, images) {
  const manifest = { name: 'batch.xlsx', arrayBuffer: async () => manifestBytes.buffer.slice(manifestBytes.byteOffset, manifestBytes.byteOffset + manifestBytes.byteLength) };
  return {
    getAll(key) {
      if (key === 'images') return images;
      if (key === 'manifest') return [manifest];
      return [];
    },
    get(key) {
      if (key === 'manifest') return manifest;
      if (key === 'images') return images[0] || null;
      return null;
    },
  };
}

async function validBatch(rowCount = 1) {
  const rows = [];
  const images = [];
  for (let index = 1; index <= rowCount; index += 1) {
    const name = `V${String(index).padStart(3, '0')}.jpg`;
    rows.push(['VP', '2026-11-17', 'morning', `V${String(index).padStart(3, '0')}`, `Block V ${index}`, name]);
    images.push(file(name, await sharp({ create: { width: 32, height: 32, channels: 3, background: '#112233' } }).jpeg().toBuffer()));
  }
  return formData(await manifest(rows), images);
}

test('valid JPEG batch is accepted with a review preview', async () => {
  const result = await parseAndValidateBatch(await validBatch());
  assert.deepEqual(result.errors, []);
  assert.equal(result.preview.institution, 'VP');
  assert.equal(result.preview.rooms.length, 1);
});

test('PNG batch is accepted and image signature is validated', async () => {
  const data = await manifest([['VP', '2026-11-17', 'afternoon', 'V200', 'Block V', 'V200.PNG']]);
  const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#2255aa' } }).png().toBuffer();
  const result = await parseAndValidateBatch(formData(data, [file('V200.PNG', png)]));
  assert.deepEqual(result.errors, []);
  assert.equal(result.preview.session, 'afternoon');
});

test('multiple sessions, missing images, duplicates, and extra images reject the whole batch', async () => {
  const badRows = [
    ['VP', '2026-11-17', 'morning', 'V001', 'Room 1', 'V001.jpg'],
    ['VP', '2026-11-17', 'afternoon', 'V002', 'Room 2', 'V002.jpg'],
  ];
  const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#112233' } }).jpeg().toBuffer();
  const missing = await parseAndValidateBatch(formData(await manifest(badRows), [file('V001.jpg', jpeg)]));
  assert.ok(missing.errors.length > 0);

  const duplicateRows = [
    ['VP', '2026-11-17', 'morning', 'V001', 'Room 1', 'V001.jpg'],
    ['VP', '2026-11-17', 'morning', 'V001', 'Room 1 duplicate', 'V001.jpg'],
  ];
  const duplicate = await parseAndValidateBatch(formData(await manifest(duplicateRows), [file('V001.jpg', jpeg)]));
  assert.ok(duplicate.errors.some((error) => String(error.reason).includes('duplicated')));

  const extra = await parseAndValidateBatch(formData(await manifest([['VP', '2026-11-17', 'morning', 'V001', 'Room 1', 'V001.jpg']]), [file('V001.jpg', jpeg), file('EXTRA.jpg', jpeg)]));
  assert.ok(extra.errors.some((error) => String(error.reason).includes('not referenced')));
});

test('spoofed, corrupt, oversized, and excessive row data are rejected', async () => {
  const corrupt = await parseAndValidateBatch(formData(await manifest([['VP', '2026-11-17', 'morning', 'V001', 'Room', 'V001.jpg']]), [file('V001.jpg', Buffer.from('not an image'))]));
  assert.ok(corrupt.errors.some((error) => String(error.reason).includes('corrupt')));

  const huge = await parseAndValidateBatch(await validBatch(BATCH_LIMITS.maxRows + 1));
  assert.ok(huge.errors.some((error) => String(error.reason).includes('100')));

  const invalidDate = await parseAndValidateBatch(formData(await manifest([['VP', '2026-02-30', 'morning', 'V001', 'Room', 'V001.jpg']]), []));
  assert.ok(invalidDate.errors.some((error) => String(error.reason).includes('date')));
});

test('case-variant selected filenames are rejected as duplicates', async () => {
  const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#112233' } }).jpeg().toBuffer();
  const result = await parseAndValidateBatch(formData(await manifest([['VP', '2026-11-17', 'morning', 'V001', 'Room', 'V001.JPG']]), [file('V001.jpg', jpeg), file('V001.JPG', jpeg)]));
  assert.ok(result.errors.some((error) => String(error.reason).includes('Duplicate filenames')));
});
