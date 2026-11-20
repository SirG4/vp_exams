# Exam Batch Contract

This contract governs admin uploads for one exam institution/date/session. It defines the Step 1 batch format before database, authentication, Azure, or publishing implementation.

## Delivery format

- Upload exactly one Excel manifest and one or more image files.
- The manifest must be an `.xlsx` workbook.
- The workbook must contain a sheet named `Exam Batch` and exactly these column headers in row 1:

  `institution | date | session | roomNumber | roomLabel | imageFilename`

- The order of the columns must match the template.
- A template is available at `public/templates/exam-batch-template.xlsx` and will later be downloadable from the admin dashboard.
- Upload one session only. Every manifest row must resolve to the same institution, date, and session.
- A batch containing multiple institution/date/session combinations is invalid and publishes nothing.

## Manifest fields

| Field | Required | Rules |
|---|---|---|
| `institution` | Yes | Exactly `VIT`, `VP`, or `VSIT`, case-sensitive. |
| `date` | Yes | Real calendar date in `YYYY-MM-DD` format. |
| `session` | Yes | Trimmed lowercase; only `morning` or `afternoon` is currently accepted. No other values are allowed. |
| `roomNumber` | Yes | 1–64 ASCII characters. Trimmed; no `/` or `\`; duplicate values in the same batch are invalid. |
| `roomLabel` | Yes | 1–200 characters. It is preserved for the viewer and must not contain control characters. |
| `imageFilename` | Yes | A basename, not a path. ASCII letters, digits, `.`, `_`, and `-` only. Length 1–255 characters. Matching against selected image names is case-insensitive for both the basename and `.jpg`/`.jpeg`/`.png` extension. |

## Image rules

- Supported types: JPEG and PNG.
- The accepted extensions are `.jpg`, `.jpeg`, and `.png`.
- Validation uses actual image signatures, dimensions, and decodeability, not extension alone.
- Maximum individual image size: 5 MB.
- Maximum batch: 100 selected image files and 100 manifest room rows.
- Maximum workbook size: 5 MB.
- The combined upload must fit within the application and Caddy limits; the Caddy limit must not be lower than this contract.
- Every manifest row must reference a selected image.
- Every selected image must be referenced by exactly one manifest row.
- Two room rows may not reuse the same image filename.
- Duplicate filenames differing only by case are invalid.
- Duplicate room numbers in the same institution/date/session are invalid.
- Nested directories, absolute paths, paths containing `..`, spaces, Unicode, and unusual filename characters are invalid.
- Corrupt, spoofed, zero-size, or undecodable files are invalid.

## Replacement behavior

- Publishing an institution/date/session that does not exist creates that session.
- Publishing an exact existing institution/date/session is a replacement.
- Replacement requires an explicit confirmation in the admin UI and an explicit server request flag.
- Replacement changes the complete room set for the session. Existing rooms omitted from the new manifest are removed from the published session.
- Validation or upload failure must leave the prior published session unchanged.
- A valid retry must be idempotent and must not create duplicate rooms or publish stale partial metadata.

## Atomic validation and reporting

- The server must not publish a batch until every workbook row and every image passes validation.
- Any invalid workbook, row, filename, or image rejects the entire batch.
- Errors must identify at least:

  - manifest sheet or row number;
  - room number or image filename;
  - and a specific reason.

- Examples:

  - `Row 12: institution must be one of VIT, VP, VSIT.`
  - `Row 19: date must be a real date in YYYY-MM-DD format.`
  - `Row 23: roomNumber 'V203' is duplicated in this batch.`
  - `Image 'W001.JPG': file is missing from the selected images.`
  - `Image 'plan.png': image signature is not PNG and cannot be decoded.`
  - `Selected image 'extra.jpg': image is not referenced by any manifest row.`

## Required test matrix

- Valid small batch.
- Batch with multiple date/session combinations: reject the whole batch.
- Batch with multiple institutions: reject the whole batch.
- Missing image.
- Selected image not referenced by the manifest.
- Duplicate room/session row.
- Duplicate image reuse.
- Invalid date, session, institution, room number, or room label.
- Malformed or unrecognized workbook.
- Filename with spaces or unusual characters.
- Filename with a path or `..` component.
- Wrong extension but valid image signature.
- Valid extension with spoofed or corrupt content.
- Unsupported image format.
- Image over 5 MB.
- More than 100 images or 100 rows.
- Retry of an identical successful batch.
- Concurrent publish attempts against the same session.
- Failure after partial staging upload and failure before metadata commit.
- Each invalid batch must be reviewed before publishing and must cause no database or blob publication changes.

## Items still needing confirmation

1. This contract proposes JPEG and PNG. The user approved both JPEG and PNG and JPEG only was also selected; the final format list needs a single confirmation.
2. The user chose case-insensitive filename matching. The implementation must decide whether `V203.JPG` and `V203.jpg` in one selected-file set count as duplicates; proposed behavior is to reject them.
3. The user chose `morning` and `afternoon`. Existing VIT data uses `morning`; VIT/VP/VSIT migration may contain missing or additional historical session values. Step 1 should not rewrite migration values until the historical data is inventoried in Step 2.
4. The 100-row limit and 5 MB image limit are confirmed, but no total request limit was specified.
5. The room-number character format is broader than the existing assets; a maximum length of 64 was proposed and needs confirmation.
6. The 200-character room-label limit and workbook 5 MB limit are proposals because no limits were specified.
7. The existing public folder contains JPEG assets only. PNG support is not required by current migration evidence.
