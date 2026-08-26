CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "ApprovalDecisionType" AS ENUM ('APPROVE', 'REJECT');
CREATE TYPE "AccessReviewStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "AccessReviewDecision" AS ENUM ('KEEP', 'REVOKE');
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ');
CREATE TYPE "EmergencyAccessStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REJECTED');

ALTER TABLE "AdminSession" ADD COLUMN "stepUpAt" TIMESTAMP(3);
ALTER TABLE "AdminOperation"
  ADD COLUMN "requestId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "permission" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "environmentId" TEXT,
  ADD COLUMN "resourceScopes" JSONB,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "AdminOperation_status_nextAttemptAt_idx" ON "AdminOperation"("status", "nextAttemptAt");
CREATE UNIQUE INDEX "RoleAssignment_active_scope_key"
ON "RoleAssignment"("adminUserId", "roleId", COALESCE("platformId", ''), COALESCE("environmentId", ''))
WHERE "revokedAt" IS NULL;

CREATE TABLE "ApprovalRequest" (
  "id" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "platformId" TEXT,
  "action" TEXT NOT NULL,
  "riskLevel" "RiskLevel" NOT NULL,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "approvalsRequired" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "executedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ApprovalDecision" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "approverId" TEXT NOT NULL,
  "decision" "ApprovalDecisionType" NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AccessReview" (
  "id" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "platformId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "AccessReviewStatus" NOT NULL DEFAULT 'DRAFT',
  "dueAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessReview_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AccessReviewItem" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "decision" "AccessReviewDecision",
  "reason" TEXT,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "AccessReviewItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "href" TEXT,
  "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "EmergencyAccessGrant" (
  "id" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "approverId" TEXT,
  "platformId" TEXT NOT NULL,
  "permissions" TEXT[],
  "reason" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "status" "EmergencyAccessStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "EmergencyAccessGrant_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "RateLimitBucket" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "resetAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);
CREATE TABLE "AuditDelivery" (
  "id" TEXT NOT NULL,
  "auditEventId" TEXT NOT NULL,
  "status" "OperationStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "lastError" TEXT,
  CONSTRAINT "AuditDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApprovalRequest_status_expiresAt_idx" ON "ApprovalRequest"("status", "expiresAt");
CREATE INDEX "ApprovalRequest_requesterId_createdAt_idx" ON "ApprovalRequest"("requesterId", "createdAt");
CREATE UNIQUE INDEX "ApprovalDecision_requestId_approverId_key" ON "ApprovalDecision"("requestId", "approverId");
CREATE INDEX "AccessReview_status_dueAt_idx" ON "AccessReview"("status", "dueAt");
CREATE INDEX "AccessReview_reviewerId_status_idx" ON "AccessReview"("reviewerId", "status");
CREATE UNIQUE INDEX "AccessReviewItem_reviewId_assignmentId_key" ON "AccessReviewItem"("reviewId", "assignmentId");
CREATE INDEX "AccessReviewItem_adminUserId_idx" ON "AccessReviewItem"("adminUserId");
CREATE INDEX "Notification_adminUserId_status_createdAt_idx" ON "Notification"("adminUserId", "status", "createdAt");
CREATE INDEX "EmergencyAccessGrant_status_expiresAt_idx" ON "EmergencyAccessGrant"("status", "expiresAt");
CREATE INDEX "EmergencyAccessGrant_adminUserId_platformId_idx" ON "EmergencyAccessGrant"("adminUserId", "platformId");
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_adminUserId_expiresAt_idx" ON "PasswordResetToken"("adminUserId", "expiresAt");
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");
CREATE UNIQUE INDEX "AuditDelivery_auditEventId_key" ON "AuditDelivery"("auditEventId");
CREATE INDEX "AuditDelivery_status_nextAttemptAt_idx" ON "AuditDelivery"("status", "nextAttemptAt");

ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccessReview" ADD CONSTRAINT "AccessReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccessReview" ADD CONSTRAINT "AccessReview_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "AccessReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "RoleAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencyAccessGrant" ADD CONSTRAINT "EmergencyAccessGrant_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencyAccessGrant" ADD CONSTRAINT "EmergencyAccessGrant_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyAccessGrant" ADD CONSTRAINT "EmergencyAccessGrant_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyAccessGrant" ADD CONSTRAINT "EmergencyAccessGrant_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditDelivery" ADD CONSTRAINT "AuditDelivery_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "AuditEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audit records are immutable at the database boundary, including for application roles.
CREATE OR REPLACE FUNCTION prevent_audit_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
