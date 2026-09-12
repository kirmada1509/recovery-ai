CREATE TYPE "public"."claim_actor_type" AS ENUM('user', 'admin', 'system', 'agent', 'insurer');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('DRAFT', 'SUBMITTED', 'VERIFYING', 'NEEDS_USER_INPUT', 'MANUAL_REVIEW', 'VERIFIED', 'READY_FOR_INSURER', 'INSURER_SUBMITTED', 'INSURER_REVIEW', 'DOCUMENTS_REQUESTED', 'OFFER_RECEIVED', 'NEGOTIATING', 'CHALLENGE_PENDING_USER_APPROVAL', 'CHALLENGED', 'ESCALATION_PENDING_APPROVAL', 'ESCALATION_FILED', 'ESCALATION_IN_PROGRESS', 'ESCALATION_RESOLVED', 'SETTLED', 'REJECTED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."coverage_status" AS ENUM('unknown', 'covered', 'excluded', 'partial');--> statement-breakpoint
CREATE TYPE "public"."incident_type" AS ENUM('flood', 'cyclone', 'fire', 'earthquake', 'other');--> statement-breakpoint
CREATE TYPE "public"."manual_review_status" AS ENUM('open', 'approved', 'rejected', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "claim_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_type" "claim_actor_type" NOT NULL,
	"actor_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_evidence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"evidence_document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_evidence_links_claim_document_unique" UNIQUE("claim_id","evidence_document_id")
);
--> statement-breakpoint
CREATE TABLE "claim_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"claimed_value_paise" bigint NOT NULL,
	"estimated_value_paise" bigint,
	"coverage_status" "coverage_status" DEFAULT 'unknown' NOT NULL,
	"coverage_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"incident_type" "incident_type" NOT NULL,
	"incident_at" timestamp with time zone,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text DEFAULT 'IN' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"description" text,
	"status" "claim_status" DEFAULT 'DRAFT' NOT NULL,
	"claimed_amount_paise" bigint,
	"estimated_entitlement_paise" bigint,
	"settlement_offered_paise" bigint,
	"first_offer_paise" bigint,
	"best_offer_paise" bigint,
	"settlement_final_paise" bigint,
	"negotiation_rounds_used" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"claim_id" uuid NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_review_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"reason_text" text,
	"status" "manual_review_status" DEFAULT 'open' NOT NULL,
	"assigned_admin_id" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_dispatch_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_dispatch_outbox_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE INDEX "claim_events_claim_id_idx" ON "claim_events" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "claim_evidence_links_claim_id_idx" ON "claim_evidence_links" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "claim_items_claim_id_idx" ON "claim_items" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "claims_user_id_idx" ON "claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "manual_review_tasks_claim_id_idx" ON "manual_review_tasks" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "manual_review_tasks_status_idx" ON "manual_review_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "verification_dispatch_outbox_status_idx" ON "verification_dispatch_outbox" USING btree ("status","next_attempt_at");