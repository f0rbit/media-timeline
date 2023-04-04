/*
  Warnings:

  - You are about to drop the column `name` on the `ClientServer` table. All the data in the column will be lost.
  - You are about to drop the column `url` on the `ClientServer` table. All the data in the column will be lost.
  - Added the required column `name` to the `Client` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cluster_name` to the `ClientServer` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "name" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ClientServer" DROP COLUMN "name",
DROP COLUMN "url",
ADD COLUMN     "cluster_name" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "ServerCluster" (
    "name" TEXT NOT NULL,
    "ipv4" TEXT NOT NULL,
    "ipv6" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ServerCluster_name_key" ON "ServerCluster"("name");

-- AddForeignKey
ALTER TABLE "ClientServer" ADD CONSTRAINT "ClientServer_cluster_name_fkey" FOREIGN KEY ("cluster_name") REFERENCES "ServerCluster"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
