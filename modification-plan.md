**Goal and Scope**

Keep the existing institution → exam date/session → room viewer available without sign-in to users on the local network. Add an admin area that requires approved users to sign in before uploading or changing exam information. The Next.js server will communicate with Azure; browsers will not receive Azure credentials or direct, public blob URLs.

The current viewer imports static exam JSON and constructs image paths under `public/` in [src/app/page.js](src/app/page.js). The current records are in [src/data/vit-exams.json](src/data/vit-exams.json), [src/data/vp-exams.json](src/data/vp-exams.json), and [src/data/vsit-exams.json](src/data/vsit-exams.json). Treat migration of these records and existing image files as part of the change, not as a separate manual re-entry task.

**Implementation Status — 2026-11-19**

- The Azure Blob Storage connection is configured locally in `.env.local`. Do not add account names, connection strings, keys, SAS tokens, or passwords to this plan or source files.
- The server-side Azure Blob SDK and same-origin image route have been implemented.
- The private Azure storage account/container has been connected successfully.
- The existing SQLite metadata migration and Azure blob migration have been run successfully.
- All 20 existing legacy exam images were migrated to private Azure Blob Storage. Future reruns should be retry-safe and only upload changed or missing blobs.
- The live Azure container must remain private/no-public-access.
- `.env.local` is Git-ignored and is the source of Azure environment values for local development and migration commands.

**Decisions to Confirm First**

1. Which identity system and group will define admins? Entra ID is preferred if the college manages accounts there. Record who can approve or remove admin membership.
--> use middleware, create a super admin to manage users, and approve signups, and delete users and create multiple super admins
2. Is an upload one exam session, or can it contain several? Recommended: one CSV manifest can contain multiple institution/date/session groups, and each row maps one room to one image file.
--> create a downloadable excel file with proper headers to be followed t get the necessary information from the uploader, and allow uploading of one session at a time
3. Decide and document image formats, maximum image size, maximum files per batch, allowed session names, and whether an existing published session can be replaced. Reject unsupported input with a useful error rather than silently skipping it.
4. Confirm whether the host will be one server. SQLite is a simple choice for a single Next.js host; if the service will run on multiple hosts, choose a shared database before implementation.
-->it will be one server, use SQLlite
5. Decide the HTTPS approach: a certificate from a public CA using DNS-01 for a domain you control, or Caddy's internal CA with its root certificate trusted on each client device. Local DNS by itself does not make browsers trust a certificate.
--> Caddy's internal CA

**Step-by-Step Plan**

1. **Specify the batch contract.** Define a CSV template with columns such as `institution`, `date` (`YYYY-MM-DD`), `session`, `roomNumber`, `roomLabel`, and `imageFilename`. Upload the CSV with the referenced images, or use a ZIP containing the CSV and images. Document filename matching, duplicate handling, replacement behavior, and the limits selected above.

   **Tests to perform:** Validate a small valid batch; a batch containing more than one date/session; a missing image; an image not referenced by the CSV; duplicate room/session rows; invalid date/session/institution; malformed CSV; and a filename containing spaces or unusual characters. Each invalid case should identify the row/file and reason, and should not publish any part of the batch.

2. **Choose and build persistent metadata storage.** For one host, create a SQLite schema for institutions, exam sessions, rooms, image/blob references, publication state, and audit events. Store the database on a persistent path outside the application build/deployment directory. Add a versioned migration and import existing JSON data, preserving image filenames and session values. Do not write runtime updates back to the source JSON files.

   **Tests to perform:** Run migrations against an empty database; import each existing JSON dataset; compare record counts and representative dates, sessions, rooms, and image names with the source; run the importer twice and verify it does not duplicate records; restart the app and confirm records remain; test rollback/recovery from an interrupted migration using a disposable database.

3. **Set up Azure Blob Storage — completed.** Create a private container for seating images. Give the server identity only the required blob read/write permissions and keep its credentials in host-managed secrets/environment variables. Store a blob key and image metadata in SQLite, not a public URL. Use a test container for development and staging; keep production data separate.

   **Completed status:** Azure connection values are in `.env.local`, the private container is connected, and 20 legacy images were migrated successfully with `npm run db:migrate-blobs`. Live values must remain outside the repository.

   **Tests to perform:** Confirm anonymous Azure requests cannot read a test blob; upload and retrieve an image through the server; verify the browser response contains no Azure account key, client secret, or SAS token; check that a missing blob returns a controlled not-found response; and confirm the application reports an Azure outage without publishing incomplete metadata. Review application logs to ensure credentials and image contents are not logged.

4. **Add sign-in and role authorization.** Integrate the chosen identity provider and restrict admin access to the approved group. Enforce the admin role on every write/upload API and admin data API, not only in the page UI. Keep public read endpoints unauthenticated. Protect sessions with secure cookie settings and appropriate CSRF/origin protections.

   **Tests to perform:** In a private browser window, verify a viewer can browse without signing in. Test an approved admin, a signed-in non-admin, a signed-out user, an expired session, and a user removed from the admin group. Attempt direct requests to every write endpoint as each unauthorized user; expect rejection and verify that no database or blob changes occurred. Verify sign-out prevents further writes.

5. **Implement batch validation, upload, and publish APIs.** Separate validation/review from publishing. Validate authentication, authorization, manifest fields, file count, file size, actual image type/signature, and duplicate/conflicting records on the server. Upload into a staging prefix, then make the metadata visible in one database transaction only after all required blobs are confirmed. Clean up staged/orphaned blobs after failures and provide retry-safe behavior.

   **Tests to perform:** Use automated unit/integration tests for valid and invalid manifests, each configured limit, spoofed file extensions, corrupt image data, duplicate submissions, and concurrent batches targeting the same session. Simulate a failure partway through blob upload and immediately before metadata commit; verify the old published data remains visible and the failed batch is not partially visible. Retry the same successful batch and confirm it does not create duplicate rooms or corrupt existing images.

6. **Build the admin dashboard at `/admin`.** Provide sign-in state, institution/date/session selection, manifest and image selection, a validation preview, upload progress, per-file outcomes, and a final publish action. Show replacement conflicts clearly and require confirmation before replacing published data. Provide an audit trail for who published or replaced a batch and when.

   **Tests to perform:** In a real browser, verify the admin can select files, review detected room/date/session mappings, catch validation errors before upload, see progress and individual failures, cancel before publishing, and recover from a retryable failure. Verify non-admins cannot load admin data or trigger actions by entering the URL directly. Check that long filenames, many rooms, and narrow/mobile viewport sizes do not make the review or result unusable.

7. **Switch the public viewer to published server data.** Replace static JSON imports with data fetched from the server. Preserve the existing institution/date/session/room navigation and clock behavior. Serve image bytes through a same-origin route that looks up the blob key server-side; use appropriate content type, caching, and error responses. Do not expose draft or unpublished batches.

   **Tests to perform:** For each institution, verify the expected dates and sessions appear, a selected room shows the correct image, and an unavailable image produces a useful fallback. Confirm drafts do not appear before publish and replacements appear after publish. Verify public data/image reads work signed out, while attempts to access admin-only data remain blocked. Compare migrated records and images against the old portal before removing the static assets.

8. **Configure Caddy and the LAN host.** Run Next.js in production mode behind Caddy; configure local DNS for `vexams.mycollege.edu.in`, the upstream address, HTTPS, and request/body-size limits consistent with the upload policy. Restrict inbound host/firewall access to the intended LAN and do not configure router port forwarding. Confirm the host can make outbound HTTPS requests to the identity provider and Azure.

   **Tests to perform:** From a LAN client, resolve the hostname, open the site over HTTPS, and verify there are no certificate warnings. Test from each supported client/browser. From a non-LAN connection, confirm the service is unreachable. Confirm the upload size limit works through Caddy as well as the application, and that restarting Caddy and Next.js restores service. Verify the configured Entra redirect URI (if used) matches the exact HTTPS hostname and callback path.

9. **Harden configuration and add repeatable test commands.** Remove the wildcard API CORS headers in [next.config.mjs](next.config.mjs) unless a specific cross-origin client is required; the browser portal should use same-origin requests. Keep secrets out of the repository and client bundle. The existing project scripts include `npm run lint` and `npm run build`; add a test runner for unit/integration tests and an end-to-end browser test suite (for example, Vitest and Playwright) as implementation begins. Use a local Azure-compatible test service where useful, then run a small smoke test against a separate Azure test container.

   **Tests to perform:** Run `npm run lint`, the automated unit/integration suite, the browser end-to-end suite, and `npm run build` on a clean checkout. Search the built client output and browser network responses for Azure credentials/SAS tokens. Review CORS behavior, security headers, error responses, and logs. Record the test results and any environment-specific manual steps.

10. **Test persistence, backup, and recovery before launch.** Define backups for the SQLite database and confirm the Azure storage retention/soft-delete policy appropriate for the institution. Document restore steps and who is responsible for them.

   **Tests to perform:** Publish a test batch, back up the database, restart the host, and verify the viewer still works. Restore the database backup to a separate test location and verify its session and blob references resolve. Delete or replace a test image and exercise the agreed recovery procedure. Do not perform destructive recovery tests against production data.

**Release Acceptance Checklist**

- Anonymous users on the LAN can view all published exam sessions and their correct images.
- Only users in the approved admin group can validate, upload, replace, or publish data, including by calling APIs directly.
- Invalid or failed batches never partially replace published data, and a valid retry is safe.
- Azure blobs remain private; the browser receives image content only through the application and never receives storage credentials.
- Existing exam data is migrated and checked against the current portal.
- HTTPS works on supported LAN clients, the service is not reachable from outside the LAN, and no router port forwarding is configured.
- Lint, automated tests, end-to-end tests, production build, restart, and documented backup/restore checks pass.

