/*
  Warnings:

  - You are about to drop the column `customer_id` on the `Integration` table. All the data in the column will be lost.
  - Added the required column `client_id` to the `Integration` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Integration" DROP CONSTRAINT "Integration_customer_id_fkey";

-- AlterTable
ALTER TABLE "Integration" DROP COLUMN "customer_id",
ADD COLUMN     "client_id" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
