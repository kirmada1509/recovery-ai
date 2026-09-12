CREATE TYPE "public"."document_source" AS ENUM('user', 'admin', 'insurer', 'system');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('policy', 'damage_photo', 'receipt', 'ownership_proof', 'other');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('pending', 'uploaded', 'quarantined', 'ready', 'deleted');--> statement-breakpoint
CREATE TABLE "document_metadata" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"captured_at" timestamp with time zone,
	"gps_lat" double precision,
	"gps_lng" double precision,
	"page_count" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"claim_id" uuid,
	"policy_id" uuid,
	"document_type" "document_type" NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint,
	"sha256" text,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"upload_status" "upload_status" DEFAULT 'pending' NOT NULL,
	"source" "document_source" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "documents_owner_user_id_idx" ON "documents" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "documents_claim_id_idx" ON "documents" USING btree ("claim_id");