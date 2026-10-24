ALTER TABLE "AdminOperation" ADD COLUMN "approvalId" TEXT;

CREATE INDEX "AdminOperation_approvalId_idx" ON "AdminOperation"("approvalId");
