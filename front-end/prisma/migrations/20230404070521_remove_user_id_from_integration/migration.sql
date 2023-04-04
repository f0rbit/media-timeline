/*
  Warnings:

  - You are about to drop the column `user_id` on the `Integration` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[client_id,platform]` on the table `Integration` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Integration_user_id_platform_key";

-- AlterTable
ALTER TABLE "Integration" DROP COLUMN "user_id";

-- CreateIndex
CREATE UNIQUE INDEX "Integration_client_id_platform_key" ON "Integration"("client_id", "platform");
