# CIA (Content Impact Analysis) - Queue-Based Validation Flow

This document describes the complete data flow for the CIA validation system, which uses an async queue-based architecture to validate question-cycle compatibility.

## Overview

The CIA module determines: **"Can Question X be used with Learning Cycle Y?"**

It uses a queue-based async architecture:
1. **Producer** stages job to S3 and publishes to Redis/BullMQ
2. **External Validator** (Lambda/ECS) processes the job
3. **Consumer** receives completion event and persists results

---

## Phase 1: Structure Extraction (One-time prerequisite)

```
   ┌──────────────────┐      ┌──────────────────┐
   │  KFK DITAMAP     │      │ Coursebook DITAMAP│
   │  (XML file)      │      │  (XML file)       │
   └────────┬─────────┘      └────────┬──────────┘
            │                         │
            ▼                         ▼
   ┌────────────────────────────────────────────────┐
   │         KfkCoursebookMapperUtil                │
   │  ├─ createKfkDocumentLektionMap()              │
   │  │    → { docId → lektionNumber }              │
   │  └─ extractUnitMappingsFromCoursebookDitamap() │
   │       → [{ unitNumber, learningCycles[] }]     │
   └────────────────────┬───────────────────────────┘
                        │
                        ▼
   ┌────────────────────────────────────────────────┐
   │       StructureExtractionService               │
   │  Merges KFK questions + Coursebook cycles      │
   │  into Unit[] entities                          │
   └────────────────────┬───────────────────────────┘
                        │
                        ▼
   ┌────────────────────────────────────────────────┐
   │              units (MongoDB)                   │
   │  ┌─────────────────────────────────────────┐   │
   │  │ unit_number: 1                          │   │
   │  │ question_document_ids: [q1, q2, q3]     │   │
   │  │ cycle_document_ids: [c1, c2, c3]        │   │
   │  └─────────────────────────────────────────┘   │
   └────────────────────────────────────────────────┘
```

### Key Files
- `services/structure-extraction.service.ts` - Orchestrates extraction
- `utils/kfk-coursebook-mapper.util.ts` - Parses DITAMAP XMLs
- `schemas/unit.schema.ts` - MongoDB schema for units

---

## Phase 2: Trigger Validation

**Endpoint:** `POST /cia/validate/:courseVersionId`

```
   ┌────────────────────────────────────────────────┐
   │       ValidationOrchestratorService            │
   │            .triggerValidation()                │
   └────────────────────┬───────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   ┌─────────┐    ┌──────────┐    ┌──────────────────────┐
   │  units  │    │ kfk_docs │    │ coursebook_docs      │
   │ (mongo) │    │ (mongo)  │    │ (mongo)              │
   └────┬────┘    └────┬─────┘    └──────────┬───────────┘
        │              │                     │
        └──────────────┼─────────────────────┘
                       ▼
   ┌────────────────────────────────────────────────┐
   │           buildValidationPairs()               │
   │  Creates Cartesian product: Question × Cycle   │
   │  For Unit 1: [q1×c1, q1×c2, q1×c3,             │
   │               q2×c1, q2×c2, q2×c3, ...]        │
   └────────────────────┬───────────────────────────┘
                        │
                        ▼
   ┌────────────────────────────────────────────────┐
   │           Check Cache                          │
   │  Query: question_cycle_validations             │
   │  Compare content hashes:                       │
   │    - kfk_content_hash                          │
   │    - coursebook_content_hash                   │
   │  If match & !force → skip (cached)             │
   │  If mismatch → add to toValidate[]             │
   └────────────────────┬───────────────────────────┘
                        │
                        ▼
   ┌────────────────────────────────────────────────┐
   │           CiaS3Service.stageValidationJob()    │
   │  Uploads to S3:                                │
   │    s3://bucket/cia-jobs/{jobId}/               │
   │      ├── manifest.json                         │
   │      ├── kfk/{docId}.xml                       │
   │      └── cycles/{docId}.xml                    │
   └────────────────────┬───────────────────────────┘
                        │
                        ▼
   ┌────────────────────────────────────────────────┐
   │           CiaJobProducer                       │
   │  .publishValidationJob() → Redis/BullMQ       │
   │                                                │
   │  Queue: 'cia-validation-jobs'                  │
   │  Payload: { jobId, s3Bucket, s3Prefix,         │
   │             pairCount, courseVersionId }       │
   └────────────────────┬───────────────────────────┘
                        │
                        ▼
   ┌────────────────────────────────────────────────┐
   │       HTTP Response: { status: 'queued',       │
   │                        jobId: '...' }          │
   └────────────────────────────────────────────────┘
```

### Key Files
- `services/validation-orchestrator.service.ts` - Main orchestration logic
- `services/cia-s3.service.ts` - S3 staging and retrieval
- `queues/cia-job.producer.ts` - Publishes to queue

---

## Phase 3: External Validation (Outside this codebase)

```
   ┌────────────────────────────────────────────────┐
   │     External Validator Service (Lambda/ECS)    │
   │                                                │
   │  1. Reads from 'cia-validation-jobs' queue     │
   │  2. Downloads XMLs from S3                     │
   │  3. Runs AI/ML validation on each pair         │
   │  4. Writes results.json to S3                  │
   │  5. Publishes to 'cia-validation-completed'    │
   └────────────────────────────────────────────────┘
```

---

## Phase 4: Process Completion

```
   ┌────────────────────────────────────────────────┐
   │  Queue: 'cia-validation-completed'             │
   │  Event: CiaValidationCompletedEvent            │
   │    { jobId, status, outputRef (S3 URI) }       │
   └────────────────────┬───────────────────────────┘
                        │
                        ▼
   ┌────────────────────────────────────────────────┐
   │       CiaCompletionConsumer.process()          │
   └────────────────────┬───────────────────────────┘
                        │
                        ▼
   ┌────────────────────────────────────────────────┐
   │  CiaS3Service.downloadResultsByUri()           │
   │  Downloads results.json from S3                │
   └────────────────────┬───────────────────────────┘
                        │
                        ▼
   ┌────────────────────────────────────────────────┐
   │  orchestrator.saveResults()                    │
   │  Transforms results → QuestionCycleValidation  │
   │  Calls: validationRepository.bulkUpsert()      │
   └────────────────────┬───────────────────────────┘
                        │
                        ▼
   ┌────────────────────────────────────────────────┐
   │     question_cycle_validations (MongoDB)       │
   │  ┌──────────────────────────────────────────┐  │
   │  │  kfk_document_id: "question-001.xml"     │  │
   │  │  coursebook_document_id: "cycle-003.xml" │  │
   │  │  is_compatible: true                     │  │
   │  │  reason: "Content aligns with..."        │  │
   │  │  is_primary: false                       │  │
   │  │  kfk_content_hash: "sha256..."           │  │
   │  │  coursebook_content_hash: "sha256..."    │  │
   │  └──────────────────────────────────────────┘  │
   └────────────────────┬───────────────────────────┘
                        │
                        ▼
   ┌────────────────────────────────────────────────┐
   │  orchestrator.assignPrimaryCycles()            │
   │                                                │
   │  For each question:                            │
   │    1. Get platform number from KFK XML         │
   │    2. Find compatible cycles                   │
   │    3. Match cycle_number == platform           │
   │    4. Set is_primary = true for that pair      │
   └────────────────────────────────────────────────┘
```

### Key Files
- `queues/cia-completion.consumer.ts` - Processes completion events
- `repositories/question-cycle-validation.repository.ts` - Data persistence

---

## Phase 5: Reporting

**Endpoint:** `GET /cia/report/:courseVersionId`

```
   ┌────────────────────────────────────────────────┐
   │       ReportGeneratorService                   │
   │                                                │
   │  Reads from question_cycle_validations         │
   │  Groups by unit → question → cycles            │
   │  Returns CiaReportResponse                     │
   └────────────────────────────────────────────────┘
```

### Key Files
- `services/report-generator.service.ts` - Generates reports

---

## Data Model: `question_cycle_validations`

| Field | Type | Purpose |
|-------|------|---------|
| `uuid` | string | Unique identifier |
| `course_version_id` | ObjectId | FK to course version |
| `course_code` | string | Course code |
| `kfk_document_id` | string | The question being validated |
| `coursebook_document_id` | string | The cycle it's validated against |
| `unit_number` | number | Which unit this pair belongs to |
| `is_compatible` | boolean | **THE RESULT** - Can this Q be used with this C? |
| `reason` | string | AI explanation of compatibility |
| `is_primary` | boolean | Is this THE cycle for this question? |
| `kfk_content_hash` | string | For cache invalidation |
| `coursebook_content_hash` | string | For cache invalidation |
| `validated_at` | Date | When validation occurred |
| `from_cache` | boolean | Was result from cache? |

### Unique Index
```
{ course_version_id, kfk_document_id, coursebook_document_id }
```

---

## Queue Configuration

| Queue Name | Purpose |
|------------|---------|
| `cia-validation-jobs` | Jobs published by producer for external validator |
| `cia-validation-completed` | Completion events consumed by consumer |

### Queue Settings (from `config/cia-queue.config.ts`)
- Retry attempts: 3
- Backoff: exponential with 5s delay
- Remove completed jobs after: 100
- Remove failed jobs after: 500

---

## Key Collections Summary

| Collection | Purpose | When Written |
|------------|---------|--------------|
| `units` | Course structure (questions + cycles per unit) | Phase 1: Structure extraction |
| `question_cycle_validations` | Validation results (Q×C compatibility) | Phase 4: Consumer processes results |

---

## File Structure

```
src/modules/cia/
├── config/
│   └── cia-queue.config.ts          # Queue names and settings
├── controllers/
│   └── cia.controller.ts            # HTTP endpoints
├── dto/
│   └── cia.dto.ts                   # Input validation
├── interfaces/
│   ├── cia-events.interface.ts      # Queue event schemas
│   ├── cia-v2.interface.ts          # API interfaces
│   └── kfk-coursebook-mapping.interface.ts  # Mapping types
├── queues/
│   ├── cia-job.producer.ts          # Publishes to VALIDATION_JOBS
│   └── cia-completion.consumer.ts   # Consumes VALIDATION_COMPLETED
├── repositories/
│   ├── question-cycle-validation.repository.ts
│   └── unit.repository.ts
├── schemas/
│   ├── question-cycle-validation.schema.ts
│   └── unit.schema.ts
├── services/
│   ├── cia-s3.service.ts            # S3 staging and retrieval
│   ├── report-generator.service.ts  # Report generation
│   ├── structure-extraction.service.ts  # DITAMAP parsing
│   └── validation-orchestrator.service.ts  # Main orchestration
├── utils/
│   └── kfk-coursebook-mapper.util.ts  # XML parsing utilities
└── cia.module.ts                    # NestJS module definition
```
