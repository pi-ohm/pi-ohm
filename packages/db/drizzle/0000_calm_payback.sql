CREATE TABLE `ohm_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at_epoch_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ohm_state` (
	`namespace` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`updated_at_epoch_ms` integer NOT NULL,
	PRIMARY KEY(`namespace`, `key`)
);
--> statement-breakpoint
CREATE TABLE `ohm_subagent_session_event` (
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`at_epoch_ms` integer NOT NULL,
	PRIMARY KEY(`session_id`, `seq`),
	FOREIGN KEY (`session_id`) REFERENCES `ohm_subagent_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ohm_subagent_session_event_session_at` ON `ohm_subagent_session_event` (`session_id`,`at_epoch_ms`);--> statement-breakpoint
CREATE TABLE `ohm_subagent_session` (
	`id` text PRIMARY KEY NOT NULL,
	`project_cwd` text NOT NULL,
	`subagent_type` text NOT NULL,
	`invocation` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`output` text,
	`created_at_epoch_ms` integer NOT NULL,
	`updated_at_epoch_ms` integer NOT NULL,
	`ended_at_epoch_ms` integer
);
--> statement-breakpoint
CREATE INDEX `idx_ohm_subagent_session_project_updated` ON `ohm_subagent_session` (`project_cwd`,`updated_at_epoch_ms`);