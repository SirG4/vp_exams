import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import sharp from 'sharp';

export const BATCH_LIMITS = Object.freeze({
  imageMaxBytes: 5 * 1024 * 1024,
  manifestMaxBytes: 5 * 1024 * 1024,
  maxFiles: 100,
  maxRows: 100,
  roomNumberMax: 64,
  roomLabelMax: 200,
});

const HEADERS = ['institution', 'date', 'session', 'roomNumber', 'roomLabel', 'imageFilename'];
const VALID_INSTITUTIONS = new Set(['VIT', 'VP', 'VSIT']);
const VALID_SESSIONS = new Set(['morning', 'afternoon']);

export function filenameKey(name) {
  return String(name || '').trim().toLowerCase();
}

export function safeExtension(contentType, filename) {
  const declared = filename.toLowerCase().split('.').pop();
  if (contentType === 'image/jpeg' && ['jpg', 'jpeg'].includes(declared)) return declared === 'jpeg' ? '.jpeg' : '.jpg';
  if (contentType === 'image/png' && declared === 'png') return '.png';
  return null;
}

function realDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export async function inspectImage(bytes, filename) {
  if (!filename || Buffer.byteLength(bytes) === 0) return { error: 'Image is empty or missing.' };
  if (Buffer.byteLength(bytes) > BATCH_LIMITS.imageMaxBytes) return { error: `Image '${filename}' exceeds 5 MB.` };
  const extension = filename.toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (!['jpg', 'jpeg', 'png'].includes(extension)) return { error: `Image '${filename}' has an unsupported extension.` };
  try {
    const metadata = await sharp(bytes).metadata();
    if (!['jpeg', 'png'].includes(metadata.format)) return { error: `Image '${filename}' is not a JPEG or PNG.` };
    if (!metadata.width || !metadata.height) return { error: `Image '${filename}' has invalid dimensions.` };
    await sharp(bytes).toBuffer();
    const contentType = metadata.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const ext = safeExtension(contentType, filename);
    if (!ext) return { error: `Image '${filename}' has a mismatched extension and image signature.` };
    return {
      contentType,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: Buffer.byteLength(bytes),
      extension: ext,
    };
  } catch {
    return { error: `Image '${filename}' is corrupt or cannot be decoded.` };
  }
}

export async function parseAndValidateBatch(formData) {
  const errors = [];
  const manifest = formData.get('manifest');
  if (!manifest || typeof manifest.arrayBuffer !== 'function') {
    return { errors: [{ reason: 'Manifest file is required.' }], preview: null };
  }
  const manifestName = manifest.name || 'manifest.xlsx';
  if (!/\.xlsx$/i.test(manifestName)) errors.push({ reason: 'Workbook must be an .xlsx file.' });

  const selected = formData.getAll('images').filter((item) => item && typeof item.arrayBuffer === 'function');
  if (selected.length > BATCH_LIMITS.maxFiles) errors.push({ reason: `Selected image count exceeds ${BATCH_LIMITS.maxFiles}.` });

  const manifestBytes = Buffer.from(await manifest.arrayBuffer());
  if (manifestBytes.length > BATCH_LIMITS.manifestMaxBytes) errors.push({ reason: 'Workbook exceeds 5 MB.' });

  const imageMap = new Map();
  for (const file of selected) {
    const name = file.name || '';
    const lower = filenameKey(name);
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..') || name.includes('/') || name.includes('\\')) {
      errors.push({ filename: name, reason: 'Image filename must be a basename using letters, digits, dot, underscore, or hyphen.' });
      continue;
    }
    if (imageMap.has(lower)) {
      errors.push({ filename: name, reason: 'Duplicate filenames differing only by case are invalid.' });
      continue;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const inspected = await inspectImage(bytes, name);
    if (inspected.error) errors.push({ filename: name, reason: inspected.error });
    else imageMap.set(lower, { name, bytes, ...inspected });
  }

  let workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(manifestBytes);
  } catch {
    errors.push({ reason: 'Workbook is malformed or is not a recognizable .xlsx file.' });
  }

  const rows = [];
  if (workbook) {
    const sheet = workbook.getWorksheet('Exam Batch');
    if (!sheet) {
      errors.push({ sheet: 'Exam Batch', reason: 'Required sheet is missing.' });
    } else {
      const actualHeaders = HEADERS.map((_, index) => String(sheet.getRow(1).getCell(index + 1).value || '').trim());
      if (actualHeaders.join('|') !== HEADERS.join('|')) {
        errors.push({ sheet: 'Exam Batch', row: 1, reason: `Header row must be exactly: ${HEADERS.join(', ')}.` });
      }
      const roomNumbers = new Set();
      const usedImages = new Set();
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (rowNumber - 1 > BATCH_LIMITS.maxRows) {
          errors.push({ sheet: 'Exam Batch', row: rowNumber, reason: `Manifest exceeds ${BATCH_LIMITS.maxRows} rows.` });
          return;
        }
        const values = HEADERS.map((_, index) => {
          const value = row.getCell(index + 1).value;
          return typeof value === 'string' ? value.trim() : value;
        });
        const [institution, date, session, roomNumber, roomLabel, imageFilename] = values.map((value) => String(value ?? '').trim());
        if (!institution && !date && !session && !roomNumber && !roomLabel && !imageFilename) return;
        if (!VALID_INSTITUTIONS.has(institution)) errors.push({ sheet: 'Exam Batch', row: rowNumber, reason: `Row ${rowNumber}: institution must be VIT, VP, or VSIT.` });
        if (!realDate(date)) errors.push({ sheet: 'Exam Batch', row: rowNumber, reason: `Row ${rowNumber}: date must be a real date in YYYY-MM-DD format.` });
        if (!VALID_SESSIONS.has(session)) errors.push({ sheet: 'Exam Batch', row: rowNumber, reason: `Row ${rowNumber}: session must be morning or afternoon.` });
        if (!roomNumber || roomNumber.length > BATCH_LIMITS.roomNumberMax || /[\/\\]/.test(roomNumber)) {
          errors.push({ sheet: 'Exam Batch', row: rowNumber, reason: `Row ${rowNumber}: roomNumber is invalid.` });
        } else if (roomNumbers.has(roomNumber)) {
          errors.push({ sheet: 'Exam Batch', row: rowNumber, reason: `Row ${rowNumber}: roomNumber '${roomNumber}' is duplicated.` });
        }
        roomNumbers.add(roomNumber);
        if (!roomLabel || roomLabel.length > BATCH_LIMITS.roomLabelMax || /[\u0000-\u001F\u007F]/.test(roomLabel)) {
          errors.push({ sheet: 'Exam Batch', row: rowNumber, reason: `Row ${rowNumber}: roomLabel is invalid.` });
        }
        if (!/^[A-Za-z0-9._-]+$/.test(imageFilename) || imageFilename.includes('..')) {
          errors.push({ sheet: 'Exam Batch', row: rowNumber, reason: `Row ${rowNumber}: imageFilename '${imageFilename}' is invalid.` });
        } else {
          const key = filenameKey(imageFilename);
          if (!imageMap.has(key)) {
            errors.push({ sheet: 'Exam Batch', row: rowNumber, filename: imageFilename, reason: `Row ${rowNumber}: selected image '${imageFilename}' is missing.` });
          } else if (usedImages.has(key)) {
            errors.push({ sheet: 'Exam Batch', row: rowNumber, filename: imageFilename, reason: `Row ${rowNumber}: image '${imageFilename}' is reused by another room.` });
          }
          usedImages.add(key);
        }
        if (institution && date && session && roomNumber && roomLabel && imageFilename) {
          rows.push({ institution, date, session, roomNumber, roomLabel, imageFilename });
        }
      });
      if (rows.length === 0) errors.push({ sheet: 'Exam Batch', reason: 'Manifest has no room rows.' });
      for (const file of imageMap.values()) {
        if (!usedImages.has(filenameKey(file.name))) {
          errors.push({ filename: file.name, reason: `Selected image '${file.name}' is not referenced by the manifest.` });
        }
      }
      const identities = new Set(rows.map((row) => `${row.institution}|${row.date}|${row.session}`));
      if (identities.size > 1) errors.push({ sheet: 'Exam Batch', reason: 'One batch must contain exactly one institution/date/session combination.' });
    }
  }

  if (errors.length) return { errors, preview: null };
  return {
    errors: [],
    preview: {
      institution: rows[0].institution,
      date: rows[0].date,
      session: rows[0].session,
      rooms: rows.map((row) => ({ roomNumber: row.roomNumber, roomLabel: row.roomLabel, imageFilename: row.imageFilename })),
    },
    rows,
    imageMap,
  };
}
