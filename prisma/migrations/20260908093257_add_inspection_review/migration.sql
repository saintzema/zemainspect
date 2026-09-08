-- AlterTable
ALTER TABLE "InspectionJob" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- CreateIndex
CREATE INDEX "InspectionJob_organizationId_lineId_result_reviewedAt_idx" ON "InspectionJob"("organizationId", "lineId", "result", "reviewedAt");

-- AddForeignKey
ALTER TABLE "InspectionJob" ADD CONSTRAINT "InspectionJob_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
