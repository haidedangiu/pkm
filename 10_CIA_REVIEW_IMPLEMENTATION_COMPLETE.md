# CIA Review Workflow - Complete Implementation Guide

> **Status**: ✅ IMPLEMENTED (December 2024)  
> **Supersedes**: 08_CIA_REVIEW_PUBLISHING_FLOW.md (Proposed), 09_IMPLEMENTATION_GAP_ANALYSIS.md (Gap Analysis)

## 📋 Document Purpose

This document is the **final, authoritative reference** for the CIA Review Workflow after full implementation. It covers:

1. What was built (Backend + Frontend)
2. How the system works end-to-end
3. Key implementation details and edge cases handled
4. Lessons learned and bug fixes applied

---

## 🎯 Executive Summary

The CIA (Content Impact Analysis) Review Workflow enables Module Managers (MVs) to:

1. **Create new versions** from published content
2. **Edit content** in Fonto editor
3. **Run CIA analysis** to detect question/content incompatibilities
4. **Review and handle** AI suggestions (mark as fixed or ignored)
5. **Publish** when all suggestions are handled

### Key Components Built

| Component | Location | Description |
|-----------|----------|-------------|
| Version Workflow Service | `ai-contenthub-core/src/modules/ssp-api/services/course-version-workflow.service.ts` | Backend orchestration |
| CIA Suggestion Schema | `ai-contenthub-core/src/modules/cia/schemas/cia-suggestion.schema.ts` | MongoDB schema |
| CIA Suggestion Sync | `ai-contenthub-core/src/modules/cia/services/cia-suggestion-sync.service.ts` | Smart merge logic |
| Frontend Store | `ai.media.ssp/src/apps/course-content-review/stores/course-version-workflow.store.ts` | Pinia store |
| Content Overview Page | `ai.media.ssp/src/apps/course-content-review/pages/ContentOverviewPage.vue` | Main UI |

---

## 🔄 Complete User Journey

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              USER JOURNEY                                            │
└─────────────────────────────────────────────────────────────────────────────────────┘

  User sees: v1 PUBLISHED
       │
       │ Click "CREATE NEW VERSION"
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │ BACKEND: createNewVersion()                                                      │
  │                                                                                  │
  │ 1. Validate user has MV access to this course                                   │
  │ 2. Check no draft already exists (409 Conflict if it does)                      │
  │ 3. Find latest PUBLISHED version as base                                        │
  │ 4. Create new CourseVersion record (status: DRAFT)                              │
  │ 5. Copy ALL KFK documents (183 docs) → new courseVersionId                      │
  │ 6. Copy ALL Coursebook documents (129 docs) → new courseVersionId               │
  │ 7. Smart-copy CIA suggestions (only HANDLED + unchanged content)                │
  └─────────────────────────────────────────────────────────────────────────────────┘
       │
       │ Success: v2 DRAFT created
       ▼
  User sees: v2 DRAFT with "EDIT CONTENT" and "START REVIEW" buttons
       │
       │ (User edits content in Fonto - optional)
       │
       │ Click "START REVIEW"
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │ BACKEND: startReview()                                                           │
  │                                                                                  │
  │ 1. Validate version is in DRAFT status                                          │
  │ 2. Trigger CIA validation (async job via CiaFacadeService)                      │
  │ 3. Update version status → IN_REVIEW                                            │
  │ 4. Return jobId for tracking                                                    │
  │                                                                                  │
  │ ASYNC: When CIA completes, CiaSuggestionSyncService performs SMART MERGE:       │
  │ - Creates new PENDING suggestions for incompatible questions                    │
  │ - Preserves HANDLED suggestions where content unchanged                         │
  │ - Resets suggestions to PENDING where content changed                           │
  │ - Deletes suggestions for now-compatible questions                              │
  └─────────────────────────────────────────────────────────────────────────────────┘
       │
       │ Status: IN_REVIEW, suggestions available
       ▼
  User sees: Review page with suggestions
       │
       │ For each suggestion: Click "FIXED" or "IGNORE"
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │ BACKEND: handleSuggestion()                                                      │
  │                                                                                  │
  │ 1. Update suggestion status (PENDING → FIXED or IGNORED)                        │
  │ 2. Record who handled it and when                                               │
  │ 3. Return updated progress                                                      │
  └─────────────────────────────────────────────────────────────────────────────────┘
       │
       │ All suggestions handled (e.g., 23/23)
       │
       │ Click "APPROVE & PUBLISH"
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │ BACKEND: approveAndPublish()                                                     │
  │                                                                                  │
  │ 1. Verify all suggestions handled (400 Bad Request if pending > 0)              │
  │ 2. Create PublishingJob record                                                  │
  │ 3. Update version status → PUBLISHING                                           │
  │ 4. Trigger publishing pipeline (S3 + Moodle)                                    │
  │ 5. On success: status → PUBLISHED, previous version → ARCHIVED                  │
  │ 6. On failure: status → IN_REVIEW (rollback), user can retry                    │
  └─────────────────────────────────────────────────────────────────────────────────┘
       │
       │ Success!
       ▼
  User sees: v2 PUBLISHED, can create v3 when needed
```

---

## 📊 Version Status State Machine

```
                                ┌──────────────┐
                                │   DRAFT      │
                                │              │
                                │ • Edit freely│
                                │ • No CIA yet │
                                └──────┬───────┘
                                       │
                                       │ startReview()
                                       │ (triggers CIA)
                                       ▼
                                ┌──────────────┐
                     ┌─────────│  IN_REVIEW   │◄─────────┐
                     │         │              │          │
                     │         │ • CIA ran    │          │
        rerunCia()   │         │ • Handle     │          │ Publishing
        (optional)   │         │   suggestions│          │ failed
                     │         └──────┬───────┘          │
                     │                │                  │
                     └────────────────┤                  │
                                      │ approveAndPublish()
                                      │ (all suggestions handled)
                                      ▼
                                ┌──────────────┐
                                │  PUBLISHING  │──────────┤
                                │              │          │
                                │ • Uploading  │          │
                                │ • Wait...    │          │
                                └──────┬───────┘          │
                                       │                  │
                                       │ Success          │
                                       ▼                  │
                                ┌──────────────┐          │
                                │  PUBLISHED   │──────────┘
                                │              │
                                │ • Live!      │
                                │ • Read-only  │
                                └──────────────┘
```

---

## 🗄️ Database Schema

### CiaSuggestion Collection

```typescript
// src/modules/cia/schemas/cia-suggestion.schema.ts

interface CiaSuggestion {
  _id: ObjectId;
  courseVersionId: ObjectId;       // FK to CourseVersion
  courseCode: string;              // Denormalized for queries
  
  // Document references (documentId, NOT MongoDB _id!)
  kfkDocumentId: string;           // e.g., "sf150-403591.xml"
  cycleDocumentId: string;         // e.g., "lc-unit1-cycle1.dita"
  unitNumber: number;
  
  // Content hashes at time of CIA validation
  kfkContentHash: string;          // Hash when CIA ran
  cycleContentHash: string;        // Hash when CIA ran
  
  // Question details (parsed from KFK XML)
  questionType: 'open' | 'single-choice' | 'multiple-choice';
  questionText: string;
  answerOptions?: string[];
  
  // AI feedback
  aiSuggestion: string;            // "This question references X but cycle doesn't cover X"
  
  // User handling
  status: 'pending' | 'fixed' | 'ignored';
  handledBy?: string;              // iuUserId
  handledAt?: Date;
  notes?: string;
  
  // Lineage (for smart copy)
  copiedFromVersionId?: ObjectId;
  copiedFromSuggestionId?: ObjectId;
  
  // Timestamps
  createdAt: Date;
  updatedAt?: Date;
}
```

### CourseVersion Extended Fields

```typescript
// src/collections/course-versions/schemas/course-version.schema.ts

interface CourseVersion {
  // ... existing fields ...
  
  // CIA tracking
  ciaRunAt?: Date;                 // When CIA was last triggered
  ciaJobId?: string;               // Job ID for status tracking
  
  // Publishing
  lastPublishingJobId?: ObjectId;
}
```

---

## 🔧 Backend API Endpoints

### SSP API Controller

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ssp-api/v1/courses/:courseId/versions` | POST | Create new version |
| `/ssp-api/v1/course-versions/:id` | DELETE | Discard draft |
| `/ssp-api/v1/course-versions/:id/start-review` | POST | Start review (triggers CIA) |
| `/ssp-api/v1/course-versions/:id/rerun-cia` | POST | Re-run CIA |
| `/ssp-api/v1/course-versions/:id/suggestions` | GET | Get suggestions with status |
| `/ssp-api/v1/course-versions/:id/suggestions/:suggestionId` | PATCH | Handle suggestion |
| `/ssp-api/v1/course-versions/:id/suggestions/:suggestionId/reset` | POST | Reset to pending |
| `/ssp-api/v1/course-versions/:id/can-publish` | GET | Check if publishable |
| `/ssp-api/v1/course-versions/:id/publish` | POST | Approve & publish |
| `/ssp-api/v1/course-versions/:id/publish-status` | GET | Get publish progress |

### Example: Create New Version Response

```json
{
  "courseVersionId": "693732142e3b550e5a438fee",
  "versionNumber": 2,
  "status": "draft",
  "kfkDocumentsCopied": 183,
  "coursebookDocumentsCopied": 129,
  "suggestionsCopied": 15
}
```

### Example: Get Suggestions Response

```json
{
  "courseCode": "DLBAGRMGDS01",
  "courseVersionId": "693732142e3b550e5a438fee",
  "versionNumber": 2,
  "progress": {
    "total": 23,
    "handled": 15,
    "pending": 8
  },
  "hasStaleContent": false,
  "ciaStatus": "completed",
  "suggestions": [
    {
      "id": "6937abc123...",
      "unitNumber": 1,
      "unitLabel": "LC 1: Einführung - Unit 1: Grundlagen",
      "cycleNumber": 1,
      "kfkDocumentId": "kfk/sf150-403591.xml",
      "cycleDocumentId": "coursebook/lc-unit1-cycle1.dita",
      "questionType": "open",
      "questionText": "What are the ethical challenges...",
      "aiSuggestion": "This question references ethics but...",
      "status": "pending",
      "isStale": false
    }
  ]
}
```

---

## 🖥️ Frontend Implementation

### Store: course-version-workflow.store.ts

```typescript
// Key actions
const workflowStore = useCourseVersionWorkflowStore();

// Create new version
await workflowStore.createNewVersion(courseId);

// Start review (triggers CIA)
await workflowStore.startReview(courseVersionId);

// Handle suggestion
await workflowStore.handleSuggestion(courseVersionId, suggestionId, 'fixed', notes?);

// Check if can publish
const { canPublish, pendingSuggestions } = await workflowStore.checkCanPublish(courseVersionId);

// Publish
await workflowStore.approveAndPublish(courseVersionId);
```

### Store: course-content-review.store.ts

Updated to fetch both `latestVersion` and `publishedVersion` from API:

```typescript
// Enriched project data
interface CourseContentReviewProject {
  _id: string;
  courseCode: string;
  // ...
  latestVersion?: {
    courseVersionId: string;
    versionNumber: number;
    status: 'draft' | 'in_review' | 'publishing' | 'published';
    createdAt: Date;
  };
  publishedVersion?: {
    courseVersionId: string;
    versionNumber: number;
    status: 'published';
    createdAt: Date;
  };
}
```

### Page: ContentOverviewPage.vue

Key computed properties:

```typescript
// Determine which version to show
const currentVersion = computed(() => {
  const project = currentProject.value;
  if (!project) return null;
  
  // Prioritize draft/in_review over published
  if (project.latestVersion?.status !== 'published') {
    return project.latestVersion;
  }
  return project.publishedVersion;
});

// Button states
const showCreateNewVersion = computed(() => {
  // Show when latest version is published (no draft exists)
  return currentVersion.value?.status === 'published';
});

const showEditContent = computed(() => {
  // Show when in draft or in_review
  return ['draft', 'in_review'].includes(currentVersion.value?.status);
});
```

---

## 🔑 Key Implementation Details

### 1. Document Copying - Conflict Resolution

**Problem**: When copying documents from v1 to v2, the original code threw conflicts because it checked uniqueness on `documentId + revisionId` globally.

**Solution**: Changed conflict check to include `courseVersionId`:

```typescript
// BEFORE (broken)
findByDocumentIdAndRevisionId(documentId, revisionId)

// AFTER (fixed)
findByDocumentIdRevisionIdAndVersion(documentId, revisionId, courseVersionId)
```

**Files Changed**:
- `kfk-document.service.ts`
- `kfk-document.repository.ts`
- `coursebook-document.service.ts`
- `coursebook-document.repository.ts`

### 2. Smart Copy of CIA Suggestions

When creating a new version, we preserve handled suggestions **only if content is unchanged**:

```typescript
// course-version-workflow.service.ts - createNewVersion()

for (const suggestion of baseSuggestions) {
  const currentKfkHash = kfkHashMap.get(suggestion.kfkDocumentId);
  const currentCycleHash = coursebookHashMap.get(suggestion.cycleDocumentId);

  if (
    currentKfkHash === suggestion.kfkContentHash &&    // KFK unchanged
    currentCycleHash === suggestion.cycleContentHash && // Cycle unchanged
    suggestion.status !== SuggestionStatus.PENDING      // Actually handled
  ) {
    // Safe to copy - content identical, fix still applies
    await this.ciaSuggestionRepository.create({
      ...suggestion,
      courseVersionId: newVersionId,
      copiedFromVersionId: baseVersionId,
      copiedFromSuggestionId: suggestion._id,
    });
  }
}
```

### 3. Frontend API Response Handling

**Problem**: After creating version, API returns 409 if draft already exists, but frontend showed error even on success.

**Solution**: Separated error handling for version creation vs. project refresh:

```typescript
// ContentOverviewPage.vue - handleCreateNewVersion()

try {
  await workflowStore.createNewVersion(courseId);
  
  // Refresh separately - don't fail whole operation if this fails
  try {
    await courseContentReviewStore.fetchProjects();
  } catch (refreshError) {
    console.warn('Version created but refresh failed');
    // Don't show error - version was created
  }
} catch (error) {
  if (error?.response?.status === 409) {
    // Draft exists - just refresh silently
    await courseContentReviewStore.fetchProjects();
    // No alert - let UI show the existing draft
  } else {
    alert(`Failed: ${error.message}`);
  }
}
```

### 4. Fonto Editor Integration

The Fonto editor receives `courseVersionId` via URL parameters:

```
http://localhost:8080/fonto?courseVersionId=693732142e3b550e5a438fee&documentId=coursebook/DLBAGRMGDS01.ditamap
```

Backend CMS connector uses this to load documents for the correct version:

```typescript
// Request includes editSessionToken with courseVersionId
const { courseVersionId } = context.editSessionToken;
const doc = await this.coursebookDocumentService.findByDocumentIdAndVersion(
  documentId,
  courseVersionId
);
```

---

## 🐛 Bugs Fixed During Implementation

### Bug 1: "Failed to create new version" on Success

**Symptom**: Alert showed failure but version was actually created.

**Root Cause**: Single try-catch covered both API call and subsequent refresh. Refresh timeout was causing the error.

**Fix**: Separated try-catch blocks, suppressed alert for refresh failures.

### Bug 2: 409 Conflict When Copying Documents

**Symptom**: `KFK document with documentId "sf150-403591.xml" already exists`

**Root Cause**: Conflict check didn't include `courseVersionId`, so v1 doc blocked v2 copy.

**Fix**: Added `findByDocumentIdRevisionIdAndVersion()` method to check within same version only.

### Bug 3: Frontend Showing Stale Version Data

**Symptom**: Page showed "v1 PUBLISHED" when "v2 DRAFT" existed.

**Root Cause**: API only returned `latestVersion`, frontend used it for both display and create-button logic.

**Fix**: API now returns both `latestVersion` (could be draft) and `publishedVersion` (guaranteed published).

### Bug 4: Double-Click Creating Multiple Versions

**Symptom**: Rapid clicks could trigger multiple API calls.

**Fix**: Added `isCreatingVersion` ref to guard against concurrent calls:

```typescript
if (isCreatingVersion.value) {
  console.log('Ignoring click - already creating');
  return;
}
isCreatingVersion.value = true;
try {
  // ... create version
} finally {
  isCreatingVersion.value = false;
}
```

---

## 📁 File Reference

### Backend (ai-contenthub-core)

```
src/
├── collections/
│   ├── course-versions/
│   │   ├── schemas/course-version.schema.ts    # Extended with ciaRunAt, ciaJobId
│   │   └── services/course-version.service.ts  # Version management
│   ├── kfk-documents/
│   │   ├── services/kfk-document.service.ts    # Fixed conflict check
│   │   └── repositories/kfk-document.repository.ts  # Added findByDocumentIdRevisionIdAndVersion
│   └── coursebook-documents/
│       ├── services/coursebook-document.service.ts    # Fixed conflict check
│       └── repositories/coursebook-document.repository.ts  # Added findByDocumentIdRevisionIdAndVersion
│
├── modules/
│   ├── cia/
│   │   ├── schemas/cia-suggestion.schema.ts           # Suggestion model
│   │   ├── repositories/cia-suggestion.repository.ts  # CRUD + queries
│   │   └── services/cia-suggestion-sync.service.ts    # Smart merge logic
│   │
│   ├── ssp-api/
│   │   ├── controllers/ssp-api.controller.ts          # REST endpoints
│   │   ├── services/ssp-api.service.ts                # Enriches courses with versions
│   │   └── services/course-version-workflow.service.ts # Main orchestration
│   │
│   └── publishing/
│       ├── schemas/publishing-job.schema.ts
│       └── repositories/publishing-job.repository.ts
```

### Frontend (ai.media.ssp)

```
src/apps/course-content-review/
├── stores/
│   ├── course-content-review.store.ts        # Project list, latestVersion/publishedVersion
│   └── course-version-workflow.store.ts      # Version actions
│
├── pages/
│   └── ContentOverviewPage.vue               # Main UI, button logic
│
├── models/
│   └── course-content-review-project.model.ts  # Added publishedVersion field
│
└── utils/
    └── course-content-rest-instance.util.ts  # API endpoint paths
```

---

## ✅ Implementation Checklist

### Backend
- [x] CourseVersion schema updates (ciaRunAt, ciaJobId)
- [x] CiaSuggestion schema + repository + service
- [x] PublishingJob schema + repository
- [x] CourseVersionWorkflowService (createNewVersion, startReview, handleSuggestion, etc.)
- [x] Document conflict check fix (include courseVersionId)
- [x] Smart copy of suggestions
- [x] SSP API endpoints
- [x] API returns both latestVersion and publishedVersion

### Frontend
- [x] course-version-workflow.store.ts
- [x] course-content-review.store.ts (handle both versions)
- [x] ContentOverviewPage.vue (button logic, error handling)
- [x] Double-click prevention
- [x] Silent 409 handling

### Edge Cases Handled
- [x] Draft already exists → 409 + silent refresh
- [x] Document conflict on copy → Check within version only
- [x] Content changed after CIA → Stale detection via hashes
- [x] Smart copy preserves handled suggestions
- [x] Refresh failure doesn't block version creation

---

## 🚀 Testing the Flow

### Manual Test Checklist

1. **Import a course** (creates v1 PUBLISHED)
   ```bash
   curl -X POST http://localhost:3000/ai-contenthub-core/app/import-factory/course-s3 \
     -H "Content-Type: application/json" \
     -d '{"courseCode": "DLBAGRMGDS01"}'
   ```

2. **View in frontend** at `http://localhost:5173/course-content-review`
   - Should see course with "v1 PUBLISHED"
   - "CREATE NEW VERSION" button visible

3. **Create new version** (click button)
   - Should transition to "v2 DRAFT"
   - No error popup
   - Console shows documents copied

4. **Edit content** (optional)
   - Click "EDIT CONTENT" → Opens Fonto
   - Verify correct courseVersionId in URL

5. **Start review**
   - Click "START REVIEW"
   - Should trigger CIA, show suggestions

6. **Handle suggestions**
   - Mark each as FIXED or IGNORED
   - Progress bar updates

7. **Publish**
   - "APPROVE & PUBLISH" enabled when all handled
   - Successful publish → "v2 PUBLISHED"

---

## 📝 Lessons Learned

1. **Conflict checks need full context** - Always include version/tenant ID in uniqueness checks when building multi-version systems.

2. **Separate success from refresh** - API call success and UI refresh are different concerns. Handle them in separate try-catch blocks.

3. **Return comprehensive data** - Frontend needs both "latest" and "published" versions to make UI decisions. Don't make them derive it.

4. **Guard against double-clicks** - Users click fast. Add loading states that block duplicate actions.

5. **Smart copy saves time** - Preserving handled suggestions when content is unchanged dramatically improves UX for iterative reviews.

---

**Document Version**: 1.0  
**Last Updated**: December 8, 2024  
**Authors**: Development Team


