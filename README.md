# Back Sistem Skripsi (Backend)

Single-source context file for this backend so a new Codex session can understand the project quickly.

## 1. Purpose

This is an Express + MySQL backend for thesis administration workflows:
- Authentication (`STUDENT`, `LECTURER`)
- Outline submission and Kaprodi review
- Title submission and Kaprodi review
- Supporting lookup endpoints (`dosen`, `program studi`)

Main workflow:
1. Student submits outline.
2. Kaprodi reviews outline (`ACCEPTED`, `NEED_REVISION`, `REJECTED`, etc.).
3. If outline is `ACCEPTED`, student can submit title form.
4. Kaprodi reviews title submission (`APPROVED`, `NEED_REVISION`, `REJECTED`).

## 2. Tech Stack

- Node.js (CommonJS)
- Express `5.2.1`
- MySQL (`mysql2/promise`)
- JWT (`jsonwebtoken`)
- Password hashing (`bcrypt`)
- CORS + dotenv

## 3. Run & Environment

Install and run:

```bash
npm install
npm run dev
```

`npm run dev` starts `nodemon src/server.js`.

Required `.env` variables:
- `PORT` (default `3001`)
- `DB_HOST`
- `DB_PORT` (default `3306`)
- `DB_USER`
- `DB_PASSWORD` (optional, default empty string)
- `DB_NAME`
- `JWT_SECRET`
- `JWT_EXPIRES_IN` (optional, default `7d`)

## 4. Project Structure

```txt
src/
  app.js
  server.js
  db.js
  routes/
    health.routes.js
    db.routes.js
    auth.routes.js
    outline.routes.js
    titleSubmission.routes.js
    dosen.routes.js
    programStudi.routes.js
  controllers/
    auth.controller.js
    outline.controller.js
    titleSubmission.controller.js
    titleSubmissionKaprodi.controller.js
    dosen.controller.js
    programStudi.controller.js
  middlewares/
    auth.js
    attachProgramStudi.js
    notFound.js
    errorHandler.js
```

## 5. Request Flow

1. `src/server.js` starts server.
2. `src/app.js` loads middleware + routes.
3. Protected endpoints use `middlewares/auth.js`:
   - Expects `Authorization: Bearer <token>`
   - Decodes `sub` and `userType` into `req.user`.
4. Student endpoints that need program study use `attachProgramStudi`:
   - Reads `users -> mahasiswa.program_studi_id`
   - Attaches `req.user.programStudiId`
5. Controllers execute SQL directly through `db.query(...)`.
6. `notFound` and `errorHandler` return JSON errors.

## 6. Auth Model

Token payload:
- `sub`: user id as string
- `userType`: `STUDENT` or `LECTURER`

`POST /auth/login`:
- Validates username/password
- Checks active user
- Uses bcrypt compare against `password_hash`
- Returns token + user profile data from:
  - `mahasiswa` for students
  - `dosen` for lecturers

`GET /auth/me`:
- Returns current user + role profile detail.

## 7. API Endpoints

### Health & Infra
- `GET /health`
- `GET /db/ping`

### Auth
- `POST /auth/login`
- `GET /auth/me` (auth required)

### Outline
- `POST /outlines` (student)
- `GET /outlines` (kaprodi list)
- `GET /outlines/latest` (student latest)
- `GET /outlines/:id` (student own, lecturer allowed)
- `GET /outlines/:id/review-history`
- `PATCH /outlines/:id/review` (kaprodi review)
- `PATCH /outlines/:id` (student resubmit)

### Title Submission
- `POST /title-submissions` (student, requires accepted outline)
- `GET /title-submissions/me` (student list)
- `GET /title-submissions/latest` (student latest)
- `GET /title-submissions` (kaprodi list)
- `GET /title-submissions/:id` (student own / kaprodi own prodi)
- `PATCH /title-submissions/:id/review` (kaprodi)
- `PATCH /title-submissions/:id/resubmit` (student)

### Reference
- `GET /dosen`
- `POST /program-studi/kaprodi`

## 8. Domain Entities (Current)

Core tables used by code:
- `users`
- `mahasiswa`
- `dosen`
- `program_studi`
- `outline`
- `outline_details`
- `pengajuan_judul`
- `pengajuan_judul_syarat`
- `pengajuan_judul_file`

Important relationships:
- `users.npm -> mahasiswa.npm` for students
- `users.nidn -> dosen.nidn` for lecturers
- `mahasiswa.program_studi_id -> program_studi.id`
- `program_studi.kaprodi_nidn -> dosen.nidn`
- `outline.npm -> mahasiswa.npm`
- `outline.program_studi_id -> program_studi.id`
- `outline_details.outline_id -> outline.id`
- `pengajuan_judul.outline_id -> outline.id`
- `pengajuan_judul.npm -> mahasiswa.npm`
- `pengajuan_judul.program_studi_id -> program_studi.id`
- `pengajuan_judul_syarat.pengajuan_judul_id -> pengajuan_judul.id`
- `pengajuan_judul_file.pengajuan_judul_id -> pengajuan_judul.id`

Title submission split model:
- `pengajuan_judul` stores header/workflow + core form fields.
- `pengajuan_judul_syarat` stores checklist fields (`syarat_*`) in 1:1 relation.
- `pengajuan_judul_file` stores attachments by `file_type` in 1:N relation.

## 9. Business Rules

### Outline Rules
- Only `STUDENT` can create/resubmit outline.
- New outline creation blocked if student has any non-`REJECTED` outline.
- Outline review only by Kaprodi of matching `program_studi`.
- On resubmit:
  - Outline status set to `SUBMITTED`
  - New `outline_details` revision inserted if file provided
  - Revisions trimmed to latest 3

### Title Submission Rules
- Only `STUDENT` can create/resubmit own title submission.
- Create requires selected outline status `ACCEPTED`.
- Duplicate title submission for same outline is blocked.
- Kaprodi can review only submissions in their program.
- Student resubmit only allowed when status is `REJECTED` or `NEED_REVISION`.
- Resubmit resets decision fields and sets status back to `SUBMITTED`.

## 10. Status Values

Enforced outline statuses (DB ENUM):
- `SUBMITTED`
- `NEED_REVISION`
- `REJECTED`
- `ACCEPTED`

Enforced title submission statuses (DB ENUM):
- `SUBMITTED`
- `APPROVED`
- `NEED_REVISION`
- `REJECTED`

## 11. Conventions Used in This Codebase

- All responses are JSON with `ok` boolean.
- Error style usually:
  - `400` validation/business input error
  - `401` unauthorized
  - `403` forbidden
  - `404` not found/access-scoped not found
  - `409` conflict (duplicate/not eligible state)
- SQL is written inline in controllers (no repository/service layer yet).
- File uploads are currently handled as payload fields (e.g., base64/string), not multipart middleware.
- For title submission responses, controller maps new `pengajuan_judul_file` rows back to legacy response keys:
  - `file_pengajuan_judul`, `file_pengajuan_judul_name`
  - `file_transkrip`, `file_transkrip_name`
  - `file_krs`, `file_krs_name`
  - `file_metodologi`, `file_metodologi_name`

## 12. Change Log Snapshot

Completed refactors:
1. Strict status constraints added via DB ENUM:
   - `outline.status`
   - `pengajuan_judul.status`
2. Added `program_studi_id` FK integrity:
   - `outline.program_studi_id -> program_studi.id`
   - `pengajuan_judul.program_studi_id -> program_studi.id`
3. Split title submission storage:
   - checklist moved to `pengajuan_judul_syarat`
   - files moved to `pengajuan_judul_file`
   - old checklist/file columns in `pengajuan_judul` removed
4. Backend controllers updated for new read/write paths and currently working with frontend.

## 13. Expansion Guide (when resuming improvements)

When adding features, keep this order:
1. Define business rule + state transitions first.
2. Add route in `src/routes/*`.
3. Implement controller with role + ownership checks first, then SQL.
4. Reuse `auth` and `attachProgramStudi` where needed.
5. Keep response contract consistent (`ok`, `message`, `data`).

Suggested next improvements (optional, not yet started):
1. Add migration/versioning tool for DB schema.
2. Introduce validation layer (Joi/Zod) for request schemas.
3. Move SQL from controllers into service/repository modules.
4. Centralize status constants/enums to avoid string drift.
5. Add integration tests for workflow-critical endpoints.
6. Move file payloads out of DB `longtext` to object storage and store references in DB.

## 14. Quick Onboarding Checklist for New Codex Session

1. Read this README fully.
2. Check `src/app.js` route mounting to locate feature entry points.
3. Inspect target controller for business rules and status transitions.
4. Verify any role scope (`STUDENT` vs `LECTURER`) and ownership constraints.
5. Keep backward-compatible response structure unless explicitly changing API contract.
