# Implementation Gap Analysis

> **Alignment review**: Current state vs Proposed architecture (08_CIA_REVIEW_PUBLISHING_FLOW.md)

## 📊 Executive Summary

This document maps the proposed architecture against existing code to identify:

- What already exists and can be reused
- What needs to be modified
- What needs to be added new

---

## 🔍 Backend Analysis (ai-contenthub-core)

### 1. CourseVersion Schema

#### Current State

```typescript
// src/collections/course-versions/schemas/course-version.schema.ts

enum CourseVersionStatus {
  DRAFT = 'draft',
  REVIEW = 'review',
  VALIDATED = 'validated',
  PUBLISHMENT_IN_PROGRESS = 'publisment_in_progress',  // typo!
  PUBLISHED = 'published',
}

CourseVersion {
  courseId: ObjectId
  courseCode: string
  status: CourseVersionStatus
  currentUserSessionId?: ObjectId
  reviewEndDate?: Date
  versionNumber: number
  createdAt: Date
  createdBy: string
  updatedAt?: Date
  lastUpdatedBy?: string
}
```

#### Proposed State

```typescript
enum CourseVersionStatus {
  DRAFT = 'draft',
  IN_REVIEW = 'in_review',        // renamed from 'review'
  PUBLISHING = 'publishing',       // renamed from 'publisment_in_progress'
  PUBLISHED = 'published',
  ARCHIVED = 'archived',           // NEW
}

CourseVersion {
  // Existing (keep)
  courseId, courseCode, status, versionNumber,
  createdAt, createdBy, updatedAt, lastUpdatedBy, currentUserSessionId
  
  // REMOVE
  reviewEndDate         // not needed
  
  // ADD
  baseVersionId?: ObjectId         // NEW - version lineage
  ciaRunAt?: Date                  // NEW - when CIA was last run
  ciaJobId?: string                // NEW - reference to CIA job
  approvedBy?: string              // NEW - who approved
  approvedAt?: Date                // NEW - when approved
  publishedAt?: Date               // NEW - when published
  lastPublishingJobId?: ObjectId   // NEW - reference to publishing job
  
  // NOTE: No need for `contentChangedAfterCia` flag!
  // CIA already stores content hashes in CiaSuggestion.
  // We can detect content changes by comparing:
  //   document.contentHash vs ciaSuggestion.kfkContentHash/cycleContentHash
}
```

#### Changes Required

| Field                        | Action | Notes                       |
| ---------------------------- | ------ | --------------------------- |
| `status` enum                | MODIFY | Rename values, add ARCHIVED |
| `reviewEndDate`              | REMOVE | Not needed                  |
| `baseVersionId`              | ADD    | Track version lineage       |
| `ciaRunAt`                   | ADD    | When CIA last ran           |
| `ciaJobId`                   | ADD    | Reference to CIA job        |
| `approvedBy`, `approvedAt`   | ADD    | Approval tracking           |
| `publishedAt`                | ADD    | Publication timestamp       |
| `lastPublishingJobId`        | ADD    | Reference to job            |

> **Note**: No `contentChangedAfterCia` flag needed - we compute this on-the-fly by comparing
> `document.contentHash` vs `CiaSuggestion.kfkContentHash/cycleContentHash`

---

### 2. KfkDocument Schema

#### Current State

```typescript
// src/collections/kfk-documents/schemas/kfk-document.schema.ts

KfkDocument {
  documentId: string           // ✅ Keep - same across versions
  courseId: ObjectId
  courseBookDocumentId?: string
  courseVersionId: ObjectId
  courseCode: string
  xml: string
  revisionId: number
  contentHash: string          // ✅ Already exists!
  lockedBy?: string
  lockedByUserName?: string
  lockedAt?: Date
  lockAvailable: boolean
  createdBy: string
}
```

#### Proposed State

No schema changes needed! Already has:

- ✅ `documentId` (stays same across versions)
- ✅ `courseVersionId` (FK to version)
- ✅ `contentHash` (for CIA result reuse)

#### Changes Required

**NONE** - Schema is already suitable for version copying.

---

### 3. CoursebookDocument Schema

#### Current State

```typescript
// src/collections/coursebook-documents/schemas/coursebook-document.schema.ts

CoursebookDocument {
  documentId: string           // ✅ Keep
  courseId: ObjectId
  courseVersionId: ObjectId
  courseCode: string
  xml: string
  revisionId: number
  contentHash: string          // ✅ Already exists!
  lockedBy?: string
  lockedByUserName?: string
  lockedAt?: Date
  lockAvailable: boolean
  createdBy: string
}
```

#### Changes Required

**NONE** - Schema is already suitable for version copying.

---

### 4. QuestionCycleValidation Schema (CIA Results)

#### Current State

```typescript
// src/modules/cia/schemas/question-cycle-validation.schema.ts

QuestionCycleValidation {
  uuid: string
  course_version_id: ObjectId
  course_code: string
  kfk_document_id: string
  coursebook_document_id: string
  unit_number: number
  is_compatible: boolean
  is_primary: boolean
  kfk_content_hash: string         // ✅ Already exists!
  coursebook_content_hash: string  // ✅ Already exists!
  reason: string
  validated_at: Date
  from_cache: boolean
}
```

#### Analysis

This is the **CIA validation result**, not the **suggestion handling status**.

We need a NEW collection for tracking how the user handled each suggestion.

---

### 5. NEW: CiaSuggestion Schema (To Create)

```typescript
// NEW FILE: src/modules/cia/schemas/cia-suggestion.schema.ts

enum SuggestionStatus {
  PENDING = 'pending',
  FIXED = 'fixed',
  IGNORED = 'ignored',
}

@Schema({ collection: 'cia_suggestions', timestamps: true })
class CiaSuggestion {
  @Prop({ type: Types.ObjectId, required: true, ref: 'CourseVersion', index: true })
  courseVersionId: ObjectId;
  
  @Prop({ type: String, required: true })
  courseCode: string;
  
  // Link to original validation result
  @Prop({ type: Types.ObjectId, ref: 'QuestionCycleValidation' })
  validationId?: ObjectId;
  
  // Document references
  @Prop({ type: String, required: true })
  kfkDocumentId: string;
  
  @Prop({ type: String, required: true })
  cycleDocumentId: string;
  
  @Prop({ type: Number, required: true })
  unitNumber: number;
  
  // Content hashes for smart copy
  @Prop({ type: String, required: true })
  kfkContentHash: string;
  
  @Prop({ type: String, required: true })
  cycleContentHash: string;
  
  // Question details (denormalized for display)
  @Prop({ type: String, enum: ['open', 'single-choice', 'multiple-choice'] })
  questionType: string;
  
  @Prop({ type: String })
  questionText: string;
  
  @Prop({ type: [String] })
  answerOptions?: string[];
  
  // AI suggestion
  @Prop({ type: String, required: true })
  aiSuggestion: string;
  
  // User handling
  @Prop({ type: String, enum: SuggestionStatus, default: SuggestionStatus.PENDING })
  status: SuggestionStatus;
  
  @Prop({ type: String })
  handledBy?: string;
  
  @Prop({ type: Date })
  handledAt?: Date;
  
  @Prop({ type: String })
  notes?: string;
  
  // Lineage tracking
  @Prop({ type: Types.ObjectId, ref: 'CourseVersion' })
  copiedFromVersionId?: ObjectId;
  
  @Prop({ type: Types.ObjectId, ref: 'CiaSuggestion' })
  copiedFromSuggestionId?: ObjectId;
}
```

---

### 6. NEW: PublishingJob Schema (To Create)

```typescript
// NEW FILE: src/modules/publishing/schemas/publishing-job.schema.ts

enum PublishingJobStatus {
  QUEUED = 'queued',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PARTIAL_FAILURE = 'partial_failure',
}

enum TargetStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

@Schema({ collection: 'publishing_jobs', timestamps: true })
class PublishingJob {
  @Prop({ type: Types.ObjectId, required: true, ref: 'CourseVersion', index: true })
  courseVersionId: ObjectId;
  
  @Prop({ type: String, required: true })
  courseCode: string;
  
  @Prop({ type: Number, required: true })
  versionNumber: number;
  
  @Prop({ type: String, enum: PublishingJobStatus, default: PublishingJobStatus.QUEUED })
  status: PublishingJobStatus;
  
  @Prop({ type: Date })
  startedAt?: Date;
  
  @Prop({ type: Date })
  completedAt?: Date;
  
  @Prop({ type: String, required: true })
  initiatedBy: string;
  
  // Target results
  @Prop({ type: Object })
  targets: {
    s3: { status: TargetStatus; s3Key?: string; error?: string };
    moodle: { status: TargetStatus; responseData?: object; error?: string };
    myCampus?: { status: TargetStatus; error?: string };
  };
  
  // Content snapshot
  @Prop({ type: Object })
  contentSnapshot: {
    kfkDocumentCount: number;
    coursebookDocumentCount: number;
    imageCount: number;
    zipFilename: string;
    zipSizeBytes: number;
  };
  
  @Prop({ type: String })
  errorMessage?: string;
  
  @Prop({ type: Types.ObjectId, ref: 'PublishingJob' })
  retryOf?: ObjectId;
}
```

---

### 7. API Endpoints Analysis

#### Current Endpoints (ssp-api.controller.ts)

| Endpoint                                            | Exists | Notes                            |
| --------------------------------------------------- | ------ | -------------------------------- |
| `GET /ssp-api/v1/courses`                         | ✅     | List courses with latest version |
| `GET /ssp-api/v1/course-versions/:id`             | ✅     | Get version details              |
| `GET /ssp-api/v1/course-versions/:id/cover-image` | ✅     | Get cover image                  |
| `PUT /ssp-api/v1/course-versions/:id/status`      | ✅     | Update status                    |
| `GET /ssp-api/v1/courses/:id/cia-suggestions`     | ✅     | Get CIA suggestions              |

#### Current CIA Endpoints (cia.controller.ts)

| Endpoint                                    | Exists | Notes                  |
| ------------------------------------------- | ------ | ---------------------- |
| `POST /cia/v2/structure/:courseVersionId` | ✅     | Extract structure      |
| `POST /cia/v2/validate/:courseVersionId`  | ✅     | Trigger CIA validation |
| `GET /cia/v2/report/:courseVersionId`     | ✅     | Get CIA report         |
| `GET /cia/v2/status/:courseVersionId`     | ✅     | Get validation status  |

#### Current Publishing Endpoints (publishing.controller.ts)

| Endpoint                   | Exists | Notes                                             |
| -------------------------- | ------ | ------------------------------------------------- |
| `POST /publishing/start` | ✅     | Start publishing (uses courseCode, not versionId) |

#### NEW Endpoints Needed

| Endpoint                                                 | Purpose                     | Priority |
| -------------------------------------------------------- | --------------------------- | -------- |
| `POST /courses/:courseId/versions`                     | Create new version (copy)   | HIGH     |
| `DELETE /course-versions/:id`                          | Discard draft               | MEDIUM   |
| `POST /course-versions/:id/start-review`               | Trigger CIA, set IN_REVIEW  | HIGH     |
| `POST /course-versions/:id/re-run-cia`                 | Re-run CIA                  | HIGH     |
| `GET /course-versions/:id/suggestions`                 | Get suggestions with status | HIGH     |
| `PATCH /course-versions/:id/suggestions/:suggestionId` | Handle suggestion           | HIGH     |
| `POST /course-versions/:id/publish`                    | Approve & publish           | HIGH     |
| `GET /course-versions/:id/publish-status`              | Get publish progress        | HIGH     |
| `POST /course-versions/:id/retry-publish`              | Retry failed publish        | MEDIUM   |

---

### 8. Services Analysis

#### CourseVersionService

| Method                       | Exists | Changes Needed                              |
| ---------------------------- | ------ | ------------------------------------------- |
| `create()`                 | ✅     | Modify to support copying from base version |
| `findOne()`                | ✅     | No changes                                  |
| `findLatestByCourseCode()` | ✅     | No changes                                  |
| `update()`                 | ✅     | Add validation for status transitions       |
| `findDraft()`              | ❌     | ADD - find existing draft                   |
| `findLatestPublished()`    | ❌     | ADD - find latest published version         |
| `createNewVersion()`       | ❌     | ADD - copy documents from base version      |
| `archive()`                | ❌     | ADD - set status to ARCHIVED                |

#### PublishingService

| Method                       | Exists | Changes Needed                                      |
| ---------------------------- | ------ | --------------------------------------------------- |
| `startPublishing()`        | ✅     | Modify to use courseVersionId instead of courseCode |
| `checkCourseExists()`      | ✅     | Modify to check approval status                     |
| `executePublishPipeline()` | ✅     | Add pre-flight checks, job tracking                 |
| `createPublishingJob()`    | ❌     | ADD - create job record                             |
| `updateJobStatus()`        | ❌     | ADD - update job progress                           |
| `retryPublish()`           | ❌     | ADD - retry failed job                              |

#### NEW: CiaSuggestionService (To Create)

| Method                                | Purpose                                       |
| ------------------------------------- | --------------------------------------------- |
| `createSuggestionsFromValidation()` | Create suggestions from CIA results           |
| `findByVersionId()`                 | Get all suggestions for a version             |
| `getProgress()`                     | Get handling progress (total/handled/pending) |
| `handleSuggestion()`                | Mark as fixed/ignored                         |
| `reactivateSuggestion()`            | Reset to pending                              |
| `copySuggestionsToNewVersion()`     | Smart copy for version creation               |
| `resetAllForVersion()`              | Reset all to pending (for re-run CIA)         |

---

### 9. Backend Validation Rules (To Implement)

#### State Transition Validation

```typescript
// CourseVersionService - validateStateTransition()

const ALLOWED_TRANSITIONS = {
  'draft': ['in_review'],                    // Start Review
  'in_review': ['in_review', 'publishing'],  // Re-run CIA or Approve & Publish
  'publishing': ['published', 'in_review'],  // Success or Failure rollback
  'published': ['archived'],                 // When new version published
  'archived': [],                            // Terminal state
};

// Block publish if pending suggestions exist
async canPublish(courseVersionId: ObjectId): Promise<{ allowed: boolean; reason?: string }> {
  const pending = await this.ciaSuggestionService.countPending(courseVersionId);
  if (pending > 0) {
    return { 
      allowed: false, 
      reason: `Cannot publish: ${pending} pending suggestions must be handled (mark as fixed or ignored)` 
    };
  }
  return { allowed: true };
}
```

#### Version Creation Guardrails

```typescript
// CourseVersionService - createNewVersion()

async createNewVersion(courseId: ObjectId, userId: string): Promise<CourseVersion> {
  // 1. Check no existing draft
  const existingDraft = await this.findDraft(courseId);
  if (existingDraft) {
    throw new ConflictException(
      `Cannot create new version: draft v${existingDraft.versionNumber} already exists. ` +
      `Finish or discard it first.`
    );
  }
  
  // 2. Find latest published as base
  const baseVersion = await this.findLatestPublished(courseId);
  if (!baseVersion) {
    throw new NotFoundException('No published version to copy from');
  }
  
  // 3. Copy documents with new ObjectIds
  // 4. Smart-copy CIA suggestions (if hashes match)
  // ...
}
```

#### Authorization Validation

```typescript
// Guard or middleware - validateMvAccess()

async validateMvAccess(userId: string, courseId: ObjectId): Promise<void> {
  const userAccess = await this.userAccessService.findOne({ userId, courseId });
  if (!userAccess || userAccess.role !== 'MV') {
    throw new ForbiddenException('Only the MV (Modulverantwortlicher) can perform this action');
  }
}

// Apply to these endpoints:
// - POST /courses/:courseId/versions (Create new version)
// - DELETE /course-versions/:id (Discard draft)
// - POST /course-versions/:id/start-review
// - POST /course-versions/:id/re-run-cia
// - PATCH /course-versions/:id/suggestions/:suggestionId
// - POST /course-versions/:id/publish
// - POST /course-versions/:id/retry-publish
```

---

## 🖥️ Frontend Analysis (ai.media.ssp)

### 1. Current State

#### Pages

| Page                    | Exists | Path                   |
| ----------------------- | ------ | ---------------------- |
| CourseContentReviewPage | ✅     | Project list           |
| ContentOverviewPage     | ✅     | Project dashboard      |
| ReviewContentPage       | ✅     | CIA suggestions review |

#### Store (course-content-review.store.ts)

| Method                    | Exists | Changes Needed                 |
| ------------------------- | ------ | ------------------------------ |
| `fetchProjects()`       | ✅     | Add draft info to response     |
| `checkReviewStatus()`   | ✅     | Keep                           |
| `finishReview()`        | ✅     | Rename to `startReview()`    |
| `fetchCiaSuggestions()` | ✅     | Add suggestion handling status |
| `createNewVersion()`    | ❌     | ADD                            |
| `handleSuggestion()`    | ❌     | ADD                            |
| `rerunCia()`            | ❌     | ADD                            |
| `approveAndPublish()`   | ❌     | ADD                            |
| `getPublishStatus()`    | ❌     | ADD                            |
| `discardDraft()`        | ❌     | ADD                            |
| `checkCanPublish()`     | ❌     | ADD - returns pending count    |

#### Models

| Model                          | Exists | Changes Needed             |
| ------------------------------ | ------ | -------------------------- |
| `CourseContentReviewProject` | ✅     | Add `currentDraft` field |
| `CiaSuggestion`              | ❌     | ADD - with status field    |
| `PublishingJob`              | ❌     | ADD                        |

### 2. API Endpoint Paths (course-content-rest-instance.util.ts)

#### Current

```typescript
COURSE_CONTENT_ENDPOINT_PATHS = {
  USER_PROJECTS: '/ssp-api/v1/courses',
  COURSE_VERSION_COVER_IMAGE: (id) => `/ssp-api/v1/course-versions/${id}/cover-image`,
  COURSE_REVIEW_STATUS: (id) => `/ssp-api/v1/courses/${id}/review-status`,
  FINISH_REVIEW: (id) => `/ssp-api/v1/courses/${id}/finish-review`,
  RUN_CIA: (id) => `/ssp-api/v1/courses/${id}/run-cia`,
  CIA_SUGGESTIONS: (id) => `/ssp-api/v1/courses/${id}/cia-suggestions`
}
```

#### Proposed Additions

```typescript
COURSE_CONTENT_ENDPOINT_PATHS = {
  // Existing...
  
  // NEW
  CREATE_VERSION: (courseId) => `/courses/${courseId}/versions`,
  DISCARD_DRAFT: (versionId) => `/course-versions/${versionId}`,
  START_REVIEW: (versionId) => `/course-versions/${versionId}/start-review`,
  RERUN_CIA: (versionId) => `/course-versions/${versionId}/re-run-cia`,
  SUGGESTIONS: (versionId) => `/course-versions/${versionId}/suggestions`,
  HANDLE_SUGGESTION: (versionId, suggestionId) => 
    `/course-versions/${versionId}/suggestions/${suggestionId}`,
  PUBLISH: (versionId) => `/course-versions/${versionId}/publish`,
  PUBLISH_STATUS: (versionId) => `/course-versions/${versionId}/publish-status`,
  RETRY_PUBLISH: (versionId) => `/course-versions/${versionId}/retry-publish`,
}
```

### 3. UI Components Needed

| Component                        | Exists | Changes Needed                    |
| -------------------------------- | ------ | --------------------------------- |
| CourseContentReviewCardComponent | ✅     | Add draft badge/status            |
| ContentOverviewPage              | ✅     | Major refactor for new states     |
| ReviewContentPage                | ✅     | Add suggestion handling API calls |
| QuestionSuggestionCard           | ✅     | Wire up to real API               |
| VersionHistorySection            | ❌     | ADD - show version list           |
| CreateVersionButton              | ❌     | ADD                               |
| PublishConfirmModal              | ❌     | ADD                               |
| PublishProgressModal             | ❌     | ADD                               |
| DiscardDraftConfirmModal         | ❌     | ADD                               |

### 4. Frontend Validation & UX Rules

#### Button State Logic

```typescript
// ContentOverviewPage - computed properties

// "Create New Version" button
const canCreateVersion = computed(() => {
  return !project.value.currentDraft; // No draft exists
});

// "Approve & Publish" button
const canPublish = computed(() => {
  const draft = project.value.currentDraft;
  if (!draft || draft.status !== 'in_review') return false;
  
  const { total, handled } = suggestionProgress.value;
  return handled === total; // All suggestions handled
});

const pendingSuggestions = computed(() => {
  const { total, handled } = suggestionProgress.value;
  return total - handled;
});
```

#### User Feedback Messages

| Scenario | UI Element | Message |
|----------|-----------|---------|
| Draft exists, click "Create Version" | Toast/disabled button | "A draft (v3) is already in progress. Finish or discard it first." |
| Pending suggestions, hover "Publish" | Tooltip | "Handle all 8 pending suggestions to enable publishing" |
| Content edited after CIA | Warning banner | "⚠️ Content changed since last CIA. Consider re-running CIA." |
| Publish in progress | Progress modal | "Publishing to Moodle... (Step 2/3)" |
| Publish failed | Error modal | "Publishing failed: Moodle connection timeout. [Retry] [View Details]" |

#### Discard Draft Confirmation

```
┌─────────────────────────────────────────────────────────────┐
│  Discard Draft?                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  This will permanently delete:                               │
│  • All changes made in v3                                    │
│  • All CIA suggestions and your handling decisions           │
│                                                              │
│  You can create a fresh version from the published           │
│  baseline (v2) at any time.                                  │
│                                                              │
│                              [Cancel]  [Discard Draft]       │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Implementation Plan

### Phase 1: Backend Schema Updates (Week 1)

1. **Update CourseVersion schema**

   - Add new fields
   - Update status enum
   - Create migration script
2. **Create CiaSuggestion schema & module**

   - Schema, repository, service
   - CRUD operations
3. **Create PublishingJob schema & module**

   - Schema, repository, service
   - Basic CRUD

### Phase 2: Backend API - Version Management (Week 1-2)

4. **CourseVersionService enhancements**

   - `createNewVersion()` with document copying
   - Smart CIA suggestion copying
   - Draft detection
5. **New endpoints**

   - `POST /courses/:courseId/versions`
   - `DELETE /course-versions/:id`

### Phase 3: Backend API - CIA Integration (Week 2)

6. **CiaSuggestionService**

   - Create suggestions from validation results
   - Handling operations
   - Progress tracking
7. **New endpoints**

   - `POST /course-versions/:id/start-review`
   - `POST /course-versions/:id/re-run-cia`
   - `GET/PATCH /course-versions/:id/suggestions`

### Phase 4: Backend API - Publishing (Week 2-3)

8. **PublishingService refactor**

   - Use courseVersionId instead of courseCode
   - Add pre-flight checks
   - Job tracking
9. **New endpoints**

   - `POST /course-versions/:id/publish`
   - `GET /course-versions/:id/publish-status`

### Phase 5: Frontend Updates (Week 3-4)

10. **Store updates**

    - New methods for all operations
    - API endpoint paths
11. **UI updates**

    - Version history section
    - Create version flow
    - Suggestion handling
    - Publish confirmation

---

## 🔄 Migration Strategy

### Database Migration

```javascript
// Migration: Update existing course versions
db.course_versions.updateMany(
  { status: 'review' },
  { $set: { status: 'in_review' } }
);

db.course_versions.updateMany(
  { status: 'publisment_in_progress' },
  { $set: { status: 'publishing' } }
);

// Add new fields with defaults
db.course_versions.updateMany(
  {},
  { 
    $set: { 
      baseVersionId: null 
    } 
  }
);
```

### Backward Compatibility

- Keep existing `/ssp-api/v1/courses` endpoint working
- Add new endpoints alongside existing ones
- Frontend can gradually migrate to new endpoints

---

## ✅ Summary: What to Build

### Backend - MODIFY

1. `CourseVersion` schema (add fields, update enum)
2. `CourseVersionService` (add version creation logic)
3. `PublishingService` (refactor to use versionId)

### Backend - CREATE NEW

1. `CiaSuggestion` schema + module
2. `PublishingJob` schema + module
3. New API endpoints (~9 endpoints)

### Frontend - MODIFY

1. `course-content-review.store.ts` (add new methods)
2. `ContentOverviewPage.vue` (new state machine)
3. `ReviewContentPage.vue` (wire up API calls)

### Frontend - CREATE NEW

1. Version history section
2. Create version button/modal
3. Publish confirmation modal
4. Publish progress modal

---

**Document Version**: 1.0
**Created**: December 2024


