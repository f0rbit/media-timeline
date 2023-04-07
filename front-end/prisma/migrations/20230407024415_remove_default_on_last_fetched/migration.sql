-- AlterTable
ALTER TABLE "Integration" ALTER COLUMN "last_fetched" DROP NOT NULL,
ALTER COLUMN "last_fetched" DROP DEFAULT;
