ALTER TABLE "stream_grants"
ADD COLUMN "purpose" VARCHAR(16) NOT NULL DEFAULT 'PREVIEW',
ADD COLUMN "max_uses" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "use_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "stream_grants"
ADD CONSTRAINT "stream_grants_use_bounds" CHECK ("max_uses" >= 1 AND "max_uses" <= 20 AND "use_count" >= 0 AND "use_count" <= "max_uses");
