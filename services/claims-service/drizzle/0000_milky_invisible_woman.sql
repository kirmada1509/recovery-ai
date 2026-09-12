CREATE TYPE "public"."policy_status" AS ENUM('active', 'expired', 'unknown');--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"evidence_document_id" uuid NOT NULL,
	"insurer_name" text NOT NULL,
	"policy_number_masked" text NOT NULL,
	"policy_type" text NOT NULL,
	"coverage_start" date,
	"coverage_end" date,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "policy_status" DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "policies_user_id_idx" ON "policies" USING btree ("user_id");