-- CreateTable
CREATE TABLE "MetricRecord" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_url" TEXT NOT NULL,
    "response_code" INTEGER NOT NULL,
    "response_time" INTEGER NOT NULL,
    "request_address" TEXT NOT NULL,
    "request_region" TEXT NOT NULL,
    "server_id" TEXT,

    CONSTRAINT "MetricRecord_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MetricRecord" ADD CONSTRAINT "MetricRecord_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "ClientServer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
