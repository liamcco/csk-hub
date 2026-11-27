-- Added by hand: the database's character set and collation, before any table inherits them.
-- utf8mb4 holds all of Unicode. The UCA 14 collation is accent- and case-sensitive and does not pad,
-- so equality and uniqueness behave as in PostgreSQL, and text sorts by the Unicode collation order.
ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_nopad_as_cs;--> statement-breakpoint
CREATE TABLE `conversation` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`kind` enum('direct','group') NOT NULL,
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`next_message_sequence` int NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE `conversation_read_state` (
	`conversation_id` varchar(36) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`last_read_sequence` int NOT NULL DEFAULT 0,
	CONSTRAINT PRIMARY KEY(`conversation_id`,`user_id`),
	CONSTRAINT `conversationReadState_last_read_sequence_check` CHECK(`conversation_read_state`.`last_read_sequence` >= 0)
);
--> statement-breakpoint
CREATE TABLE `direct_conversation` (
	`conversation_id` varchar(36) PRIMARY KEY,
	`first_member_id` varchar(255) NOT NULL,
	`second_member_id` varchar(255) NOT NULL,
	CONSTRAINT `directConversation_member_pair_unique` UNIQUE INDEX(`first_member_id`,`second_member_id`),
	CONSTRAINT `directConversation_member_pair_order_check` CHECK(`direct_conversation`.`first_member_id` COLLATE utf8mb4_bin < `direct_conversation`.`second_member_id` COLLATE utf8mb4_bin)
);
--> statement-breakpoint
CREATE TABLE `group_conversation` (
	`conversation_id` varchar(36) PRIMARY KEY,
	`name` text NOT NULL,
	`created_by_user_id` varchar(255),
	`creation_idempotency_key` varchar(255),
	`creation_payload_hash` text,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `groupConversation_creator_creation_key_unique` UNIQUE INDEX(`created_by_user_id`,`creation_idempotency_key`),
	CONSTRAINT `groupConversation_name_not_blank_check` CHECK(length(trim(`group_conversation`.`name`)) > 0),
	CONSTRAINT `groupConversation_creation_intent_check` CHECK((`group_conversation`.`creation_idempotency_key` IS NULL AND `group_conversation`.`creation_payload_hash` IS NULL)
        OR (`group_conversation`.`creation_idempotency_key` IS NOT NULL AND length(trim(`group_conversation`.`creation_idempotency_key`)) > 0
          AND `group_conversation`.`creation_payload_hash` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `group_membership` (
	`conversation_id` varchar(36) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`joined_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`left_at` datetime(3),
	`history_visible_through_sequence` int,
	CONSTRAINT PRIMARY KEY(`conversation_id`,`user_id`),
	CONSTRAINT `groupMembership_departure_visibility_check` CHECK((`group_membership`.`left_at` IS NULL) = (`group_membership`.`history_visible_through_sequence` IS NULL)),
	CONSTRAINT `groupMembership_history_visible_through_sequence_check` CHECK(`group_membership`.`history_visible_through_sequence` IS NULL OR `group_membership`.`history_visible_through_sequence` >= 0)
);
--> statement-breakpoint
CREATE TABLE `message` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`conversation_id` varchar(36) NOT NULL,
	`sequence` int NOT NULL,
	`author_user_id` varchar(255),
	`text` text NOT NULL,
	`idempotency_key` varchar(255) NOT NULL,
	`sent_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `message_conversation_sequence_unique` UNIQUE INDEX(`conversation_id`,`sequence`),
	CONSTRAINT `message_author_idempotency_key_unique` UNIQUE INDEX(`author_user_id`,`idempotency_key`),
	CONSTRAINT `message_sequence_check` CHECK(`message`.`sequence` > 0),
	CONSTRAINT `message_text_not_blank_check` CHECK(length(trim(`message`.`text`)) > 0)
);
--> statement-breakpoint
CREATE TABLE `push_subscription` (
	`id` varchar(255) PRIMARY KEY,
	`user_id` varchar(255) NOT NULL,
	`endpoint` varchar(2048) NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`expiration_time` datetime(3),
	`user_agent` text,
	`device_label` text,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`last_seen_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`last_success_at` datetime(3),
	`last_failure_at` datetime(3),
	`failure_count` int NOT NULL DEFAULT 0,
	`disabled_at` datetime(3),
	`disabled_reason` text,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `push_subscription_endpoint_idx` UNIQUE INDEX(`endpoint`)
);
--> statement-breakpoint
CREATE TABLE `voice_capability` (
	`user_id` varchar(255) NOT NULL,
	`voice` enum('S','A','T','B','S1','S2','A1','A2','T1','T2','B1','B2') NOT NULL,
	CONSTRAINT PRIMARY KEY(`user_id`,`voice`),
	CONSTRAINT `voice_division_check` CHECK(`voice_capability`.`voice` IN ('S1', 'S2', 'A1', 'A2', 'T1', 'T2', 'B1', 'B2'))
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` varchar(255) PRIMARY KEY,
	`preferences` json NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activity_delivery` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`user_id` varchar(255) NOT NULL,
	`change` json NOT NULL,
	`body` text,
	`title` text,
	`href` text,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`published_at` datetime(3),
	`publish_after` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`push_after` datetime(3),
	`push_completed_at` datetime(3),
	`acknowledged_at` datetime(3),
	`attempts` int NOT NULL DEFAULT 0,
	`lease_until` datetime(3),
	`lease_token` varchar(36)
);
--> statement-breakpoint
CREATE TABLE `post` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`title` text NOT NULL,
	`body` json NOT NULL,
	`author_id` varchar(255),
	`published_at` datetime(3),
	`edited_at` datetime(3),
	`discarded_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `post_discarded_draft_check` CHECK(`post`.`discarded_at` is null or `post`.`published_at` is null)
);
--> statement-breakpoint
CREATE TABLE `post_read` (
	`user_id` varchar(255) NOT NULL,
	`post_id` varchar(36) NOT NULL,
	`read_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT PRIMARY KEY(`user_id`,`post_id`)
);
--> statement-breakpoint
CREATE TABLE `absence_reason` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`label` varchar(255) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `absence_reason_label_not_blank_check` CHECK(length(trim(`absence_reason`.`label`)) > 0)
);
--> statement-breakpoint
CREATE TABLE `event` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`type` enum('Rehearsal','Gig','Concert','Social','Rephelg','Körmöte','Booking','Meeting','Other') NOT NULL,
	`status` enum('Draft','Published','Cancelled') NOT NULL DEFAULT 'Draft',
	`title` text NOT NULL,
	`description` json,
	`starts_at` datetime(3) NOT NULL,
	`ends_at` datetime(3) NOT NULL,
	`all_day` boolean NOT NULL DEFAULT false,
	`location_id` varchar(36),
	`location_text` text,
	`call_time` datetime(3),
	`respond_by` datetime(3),
	`participation_mode` enum('None','ResponseRequired','ResponseRequiredStrict','Registration') NOT NULL,
	`organiser_group_id` varchar(36),
	`series_id` varchar(36),
	`created_by` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `event_id_type_unique` UNIQUE INDEX(`id`,`type`),
	CONSTRAINT `event_title_not_blank_check` CHECK(length(trim(`event`.`title`)) > 0),
	CONSTRAINT `event_period_check` CHECK(`event`.`ends_at` > `event`.`starts_at`),
	CONSTRAINT `event_call_time_check` CHECK(`event`.`call_time` IS NULL OR `event`.`call_time` <= `event`.`starts_at`),
	CONSTRAINT `event_respond_by_check` CHECK(`event`.`respond_by` IS NULL OR `event`.`respond_by` <= `event`.`starts_at`),
	CONSTRAINT `event_respond_by_mode_check` CHECK(`event`.`participation_mode` <> 'None' OR `event`.`respond_by` IS NULL)
);
--> statement-breakpoint
CREATE TABLE `event_attendance` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`event_id` varchar(36) NOT NULL,
	`user_id` varchar(255),
	`status` enum('Present','Excused','Absent') NOT NULL,
	`recorded_by` varchar(255),
	`recorded_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `event_attendance_event_user_unique` UNIQUE INDEX(`event_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `event_detail` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`event_id` varchar(36) NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`sort_order` int NOT NULL,
	CONSTRAINT `event_detail_label_not_blank_check` CHECK(length(trim(`event_detail`.`label`)) > 0)
);
--> statement-breakpoint
CREATE TABLE `event_registration` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`event_id` varchar(36) NOT NULL,
	`user_id` varchar(255),
	`status` enum('Registered','Withdrawn') NOT NULL DEFAULT 'Registered',
	`comment` text,
	`registered_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`withdrawn_at` datetime(3),
	CONSTRAINT `event_registration_event_user_unique` UNIQUE INDEX(`event_id`,`user_id`),
	CONSTRAINT `event_registration_withdrawn_check` CHECK((`event_registration`.`status` = 'Withdrawn') = (`event_registration`.`withdrawn_at` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `event_registration_answer` (
	`registration_id` varchar(36) NOT NULL,
	`question_id` varchar(36) NOT NULL,
	`text` text,
	`checked` boolean,
	CONSTRAINT PRIMARY KEY(`registration_id`,`question_id`),
	CONSTRAINT `event_registration_answer_one_value_check` CHECK(`event_registration_answer`.`text` IS NULL OR `event_registration_answer`.`checked` IS NULL)
);
--> statement-breakpoint
CREATE TABLE `event_registration_answer_choice` (
	`registration_id` varchar(36) NOT NULL,
	`question_id` varchar(36) NOT NULL,
	`option_id` varchar(36) NOT NULL,
	CONSTRAINT PRIMARY KEY(`registration_id`,`question_id`,`option_id`)
);
--> statement-breakpoint
CREATE TABLE `event_registration_question` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`event_id` varchar(36) NOT NULL,
	`label` text NOT NULL,
	`kind` enum('Text','SingleChoice','MultipleChoice','Checkbox') NOT NULL,
	`required` boolean NOT NULL DEFAULT false,
	`sort_order` int NOT NULL,
	CONSTRAINT `event_registration_question_label_not_blank_check` CHECK(length(trim(`event_registration_question`.`label`)) > 0)
);
--> statement-breakpoint
CREATE TABLE `event_registration_question_option` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`question_id` varchar(36) NOT NULL,
	`label` text NOT NULL,
	`sort_order` int NOT NULL,
	CONSTRAINT `event_registration_question_option_question_unique` UNIQUE INDEX(`question_id`,`id`),
	CONSTRAINT `event_registration_question_option_label_not_blank_check` CHECK(length(trim(`event_registration_question_option`.`label`)) > 0)
);
--> statement-breakpoint
CREATE TABLE `event_response` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`event_id` varchar(36) NOT NULL,
	`user_id` varchar(255),
	`answer` enum('Yes','No','Maybe') NOT NULL,
	`comment` text,
	`absence_reason_id` varchar(36),
	`reason_text` text,
	`responded_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `event_response_event_user_unique` UNIQUE INDEX(`event_id`,`user_id`),
	CONSTRAINT `event_response_one_reason_check` CHECK(`event_response`.`absence_reason_id` IS NULL OR `event_response`.`reason_text` IS NULL),
	CONSTRAINT `event_response_reason_only_with_no_check` CHECK(`event_response`.`answer` = 'No' OR (`event_response`.`absence_reason_id` IS NULL AND `event_response`.`reason_text` IS NULL))
);
--> statement-breakpoint
CREATE TABLE `event_series` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`name` text NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	CONSTRAINT `event_series_name_not_blank_check` CHECK(length(trim(`event_series`.`name`)) > 0)
);
--> statement-breakpoint
CREATE TABLE `event_target` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`event_id` varchar(36) NOT NULL,
	`group_id` varchar(36),
	`voice_family` enum('S','A','T','B','S1','S2','A1','A2','T1','T2','B1','B2'),
	CONSTRAINT `event_target_not_empty_check` CHECK(`event_target`.`group_id` IS NOT NULL OR `event_target`.`voice_family` IS NOT NULL),
	CONSTRAINT `voice_family_check` CHECK(`event_target`.`voice_family` IN ('S', 'A', 'T', 'B'))
);
--> statement-breakpoint
CREATE TABLE `gig` (
	`event_id` varchar(36) PRIMARY KEY,
	`type` enum('Rehearsal','Gig','Concert','Social','Rephelg','Körmöte','Booking','Meeting','Other') NOT NULL DEFAULT 'Gig',
	`responsible_user_id` varchar(255),
	`contact_name` text,
	`contact_details` text,
	CONSTRAINT `gig_type_check` CHECK(`gig`.`type` = 'Gig')
);
--> statement-breakpoint
CREATE TABLE `location` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`name` varchar(255) NOT NULL,
	`address` text,
	`map_url` text,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `location_name_not_blank_check` CHECK(length(trim(`location`.`name`)) > 0)
);
--> statement-breakpoint
CREATE TABLE `rehearsal` (
	`event_id` varchar(36) PRIMARY KEY,
	`type` enum('Rehearsal','Gig','Concert','Social','Rephelg','Körmöte','Booking','Meeting','Other') NOT NULL DEFAULT 'Rehearsal',
	`leader_user_id` varchar(255),
	CONSTRAINT `rehearsal_type_check` CHECK(`rehearsal`.`type` = 'Rehearsal')
);
--> statement-breakpoint
CREATE TABLE `social_event` (
	`event_id` varchar(36) PRIMARY KEY,
	`type` enum('Rehearsal','Gig','Concert','Social','Rephelg','Körmöte','Booking','Meeting','Other') NOT NULL DEFAULT 'Social',
	`cost_info` text,
	CONSTRAINT `social_event_type_check` CHECK(`social_event`.`type` = 'Social')
);
--> statement-breakpoint
CREATE TABLE `choir` (
	`group_id` varchar(36) PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `group` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`name` varchar(255) NOT NULL,
	`type` enum('Choir','Section','Board','GigGroup','Gigmästeri','Sexmästeri','Roddgrupp','Festgrupp','Rephelg','Konsertmästeri','Rekryteringskommitté','Turnékommitté','Valberedning','Webmästeri','Föräldramötet','Arkivarie','Utantillkommitté','Övrig') NOT NULL,
	`choir_id` varchar(36),
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `group_name_not_blank_check` CHECK(length(trim(`group`.`name`)) > 0),
	CONSTRAINT `group_choir_csk_wide_check` CHECK(`group`.`type` <> 'Choir' OR `group`.`choir_id` IS NULL),
	CONSTRAINT `group_section_in_choir_check` CHECK(`group`.`type` <> 'Section' OR `group`.`choir_id` IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `group_member` (
	`user_id` varchar(255) NOT NULL,
	`group_id` varchar(36) NOT NULL,
	`start_date` date NOT NULL,
	`end_date` date,
	`voice` enum('S','A','T','B','S1','S2','A1','A2','T1','T2','B1','B2'),
	CONSTRAINT `group_member_user_id_group_id_start_date_pk` UNIQUE INDEX(`user_id`,`group_id`,`start_date`),
	CONSTRAINT `group_member_period_check` CHECK(`group_member`.`end_date` IS NULL OR `group_member`.`end_date` >= `group_member`.`start_date`),
	CONSTRAINT `voice_division_check` CHECK(`group_member`.`voice` IN ('S1', 'S2', 'A1', 'A2', 'T1', 'T2', 'B1', 'B2'))
);
--> statement-breakpoint
CREATE TABLE `group_type_position` (
	`type` enum('Choir','Section','Board','GigGroup','Gigmästeri','Sexmästeri','Roddgrupp','Festgrupp','Rephelg','Konsertmästeri','Rekryteringskommitté','Turnékommitté','Valberedning','Webmästeri','Föräldramötet','Arkivarie','Utantillkommitté','Övrig') NOT NULL,
	`position_id` varchar(36) NOT NULL,
	CONSTRAINT PRIMARY KEY(`type`,`position_id`)
);
--> statement-breakpoint
CREATE TABLE `position` (
	`id` varchar(36) PRIMARY KEY DEFAULT (uuid()),
	`name` varchar(255) NOT NULL,
	CONSTRAINT `position_name_unique` UNIQUE INDEX(`name`),
	CONSTRAINT `position_name_not_blank_check` CHECK(length(trim(`position`.`name`)) > 0)
);
--> statement-breakpoint
CREATE TABLE `position_group` (
	`position_id` varchar(36) NOT NULL,
	`group_id` varchar(36) NOT NULL,
	CONSTRAINT PRIMARY KEY(`position_id`,`group_id`)
);
--> statement-breakpoint
CREATE TABLE `position_holder` (
	`user_id` varchar(255) NOT NULL,
	`group_id` varchar(36) NOT NULL,
	`position_id` varchar(36) NOT NULL,
	`start_date` date NOT NULL,
	`end_date` date,
	CONSTRAINT `position_holder_user_id_group_id_position_id_start_date_pk` UNIQUE INDEX(`user_id`,`group_id`,`position_id`,`start_date`),
	CONSTRAINT `position_holder_period_check` CHECK(`position_holder`.`end_date` IS NULL OR `position_holder`.`end_date` >= `position_holder`.`start_date`)
);
--> statement-breakpoint
CREATE TABLE `section` (
	`group_id` varchar(36) PRIMARY KEY,
	`voice` enum('S','A','T','B','S1','S2','A1','A2','T1','T2','B1','B2') NOT NULL
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` varchar(255) PRIMARY KEY,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` datetime(3),
	`refresh_token_expires_at` datetime(3),
	`scope` text,
	`password` text,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` varchar(255) PRIMARY KEY,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`credential_id` varchar(255) NOT NULL,
	`counter` int NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` boolean NOT NULL,
	`transports` text,
	`created_at` datetime(3),
	`aaguid` text
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` varchar(255) PRIMARY KEY,
	`expires_at` datetime(3) NOT NULL,
	`token` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` varchar(255) NOT NULL,
	`impersonated_by` text,
	CONSTRAINT `token_unique` UNIQUE INDEX(`token`)
);
--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` varchar(255) PRIMARY KEY,
	`secret` varchar(255) NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`verified` boolean DEFAULT true,
	`failed_verification_count` int DEFAULT 0,
	`locked_until` datetime(3)
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` varchar(255) PRIMARY KEY,
	`name` text NOT NULL,
	`email` varchar(255) NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`image` text,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`username` varchar(255),
	`display_username` text,
	`role` text,
	`banned` boolean DEFAULT false,
	`ban_reason` text,
	`ban_expires` datetime(3),
	`two_factor_enabled` boolean DEFAULT false,
	CONSTRAINT `email_unique` UNIQUE INDEX(`email`),
	CONSTRAINT `username_unique` UNIQUE INDEX(`username`)
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` varchar(255) PRIMARY KEY,
	`identifier` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (current_timestamp(3))
);
--> statement-breakpoint
CREATE INDEX `groupMembership_userId_idx` ON `group_membership` (`user_id`);--> statement-breakpoint
CREATE INDEX `message_conversation_sent_at_idx` ON `message` (`conversation_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `push_subscription_user_status_idx` ON `push_subscription` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `push_subscription_status_seen_idx` ON `push_subscription` (`status`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `activity_user_created_idx` ON `activity_delivery` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_publish_pending_idx` ON `activity_delivery` (`published_at`,`publish_after`);--> statement-breakpoint
CREATE INDEX `activity_push_pending_idx` ON `activity_delivery` (`push_completed_at`,`push_after`);--> statement-breakpoint
CREATE INDEX `post_published_at_idx` ON `post` (`published_at`);--> statement-breakpoint
CREATE INDEX `post_read_post_id_idx` ON `post_read` (`post_id`);--> statement-breakpoint
CREATE INDEX `event_starts_at_idx` ON `event` (`starts_at`);--> statement-breakpoint
CREATE INDEX `event_series_id_idx` ON `event` (`series_id`);--> statement-breakpoint
CREATE INDEX `event_organiser_group_id_idx` ON `event` (`organiser_group_id`);--> statement-breakpoint
CREATE INDEX `event_attendance_user_id_idx` ON `event_attendance` (`user_id`);--> statement-breakpoint
CREATE INDEX `event_detail_event_id_idx` ON `event_detail` (`event_id`);--> statement-breakpoint
CREATE INDEX `event_registration_user_id_idx` ON `event_registration` (`user_id`);--> statement-breakpoint
CREATE INDEX `event_registration_answer_question_id_idx` ON `event_registration_answer` (`question_id`);--> statement-breakpoint
CREATE INDEX `event_registration_answer_choice_option_idx` ON `event_registration_answer_choice` (`question_id`,`option_id`);--> statement-breakpoint
CREATE INDEX `event_registration_question_event_id_idx` ON `event_registration_question` (`event_id`);--> statement-breakpoint
CREATE INDEX `event_response_user_id_idx` ON `event_response` (`user_id`);--> statement-breakpoint
CREATE INDEX `event_target_event_id_idx` ON `event_target` (`event_id`);--> statement-breakpoint
CREATE INDEX `event_target_group_id_idx` ON `event_target` (`group_id`);--> statement-breakpoint
CREATE INDEX `group_choirId_idx` ON `group` (`choir_id`);--> statement-breakpoint
CREATE INDEX `group_member_groupId_idx` ON `group_member` (`group_id`);--> statement-breakpoint
CREATE INDEX `position_group_groupId_idx` ON `position_group` (`group_id`);--> statement-breakpoint
CREATE INDEX `position_holder_userId_idx` ON `position_holder` (`user_id`);--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `passkey_userId_idx` ON `passkey` (`user_id`);--> statement-breakpoint
CREATE INDEX `passkey_credentialID_idx` ON `passkey` (`credential_id`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `twoFactor_secret_idx` ON `two_factor` (`secret`);--> statement-breakpoint
CREATE INDEX `twoFactor_userId_idx` ON `two_factor` (`user_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
ALTER TABLE `conversation_read_state` ADD CONSTRAINT `conversation_read_state_conversation_id_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `conversation_read_state` ADD CONSTRAINT `conversation_read_state_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `direct_conversation` ADD CONSTRAINT `direct_conversation_conversation_id_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `direct_conversation` ADD CONSTRAINT `direct_conversation_first_member_id_user_id_fkey` FOREIGN KEY (`first_member_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `direct_conversation` ADD CONSTRAINT `direct_conversation_second_member_id_user_id_fkey` FOREIGN KEY (`second_member_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `group_conversation` ADD CONSTRAINT `group_conversation_conversation_id_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `group_conversation` ADD CONSTRAINT `group_conversation_created_by_user_id_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `group_membership` ADD CONSTRAINT `group_membership_GIzhv5D4gzvG_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `group_conversation`(`conversation_id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `group_membership` ADD CONSTRAINT `group_membership_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `message` ADD CONSTRAINT `message_conversation_id_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `message` ADD CONSTRAINT `message_author_user_id_user_id_fkey` FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `push_subscription` ADD CONSTRAINT `push_subscription_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `voice_capability` ADD CONSTRAINT `voice_capability_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD CONSTRAINT `user_preferences_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `activity_delivery` ADD CONSTRAINT `activity_delivery_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `post` ADD CONSTRAINT `post_author_id_user_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `post_read` ADD CONSTRAINT `post_read_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `post_read` ADD CONSTRAINT `post_read_post_id_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `post`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `event` ADD CONSTRAINT `event_location_id_location_id_fkey` FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `event` ADD CONSTRAINT `event_organiser_group_id_group_id_fkey` FOREIGN KEY (`organiser_group_id`) REFERENCES `group`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `event` ADD CONSTRAINT `event_series_id_event_series_id_fkey` FOREIGN KEY (`series_id`) REFERENCES `event_series`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `event` ADD CONSTRAINT `event_created_by_user_id_fkey` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `event_attendance` ADD CONSTRAINT `event_attendance_event_id_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `event_attendance` ADD CONSTRAINT `event_attendance_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `event_attendance` ADD CONSTRAINT `event_attendance_recorded_by_user_id_fkey` FOREIGN KEY (`recorded_by`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `event_detail` ADD CONSTRAINT `event_detail_event_id_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `event_registration` ADD CONSTRAINT `event_registration_event_id_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `event_registration` ADD CONSTRAINT `event_registration_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `event_registration_answer` ADD CONSTRAINT `event_registration_answer_registration_fk` FOREIGN KEY (`registration_id`) REFERENCES `event_registration`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `event_registration_answer` ADD CONSTRAINT `event_registration_answer_question_fk` FOREIGN KEY (`question_id`) REFERENCES `event_registration_question`(`id`);--> statement-breakpoint
ALTER TABLE `event_registration_answer_choice` ADD CONSTRAINT `event_registration_answer_choice_answer_fk` FOREIGN KEY (`registration_id`,`question_id`) REFERENCES `event_registration_answer`(`registration_id`,`question_id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `event_registration_answer_choice` ADD CONSTRAINT `event_registration_answer_choice_option_fk` FOREIGN KEY (`question_id`,`option_id`) REFERENCES `event_registration_question_option`(`question_id`,`id`);--> statement-breakpoint
ALTER TABLE `event_registration_question` ADD CONSTRAINT `event_registration_question_event_id_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `event_registration_question_option` ADD CONSTRAINT `event_registration_question_option_question_fk` FOREIGN KEY (`question_id`) REFERENCES `event_registration_question`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `event_response` ADD CONSTRAINT `event_response_event_id_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `event_response` ADD CONSTRAINT `event_response_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `event_response` ADD CONSTRAINT `event_response_absence_reason_id_absence_reason_id_fkey` FOREIGN KEY (`absence_reason_id`) REFERENCES `absence_reason`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `event_target` ADD CONSTRAINT `event_target_event_id_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `event_target` ADD CONSTRAINT `event_target_group_id_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `gig` ADD CONSTRAINT `gig_responsible_user_id_user_id_fkey` FOREIGN KEY (`responsible_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `gig` ADD CONSTRAINT `gig_event_id_type_event_id_type_fkey` FOREIGN KEY (`event_id`,`type`) REFERENCES `event`(`id`,`type`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `rehearsal` ADD CONSTRAINT `rehearsal_leader_user_id_user_id_fkey` FOREIGN KEY (`leader_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `rehearsal` ADD CONSTRAINT `rehearsal_event_id_type_event_id_type_fkey` FOREIGN KEY (`event_id`,`type`) REFERENCES `event`(`id`,`type`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `social_event` ADD CONSTRAINT `social_event_event_id_type_event_id_type_fkey` FOREIGN KEY (`event_id`,`type`) REFERENCES `event`(`id`,`type`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `choir` ADD CONSTRAINT `choir_group_id_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `group` ADD CONSTRAINT `group_choir_id_choir_group_id_fkey` FOREIGN KEY (`choir_id`) REFERENCES `choir`(`group_id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `group_member` ADD CONSTRAINT `group_member_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `group_member` ADD CONSTRAINT `group_member_group_id_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `group_type_position` ADD CONSTRAINT `group_type_position_position_id_position_id_fkey` FOREIGN KEY (`position_id`) REFERENCES `position`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `position_group` ADD CONSTRAINT `position_group_position_id_position_id_fkey` FOREIGN KEY (`position_id`) REFERENCES `position`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `position_group` ADD CONSTRAINT `position_group_group_id_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `position_holder` ADD CONSTRAINT `position_holder_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `position_holder` ADD CONSTRAINT `position_holder_group_id_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `position_holder` ADD CONSTRAINT `position_holder_position_id_position_id_fkey` FOREIGN KEY (`position_id`) REFERENCES `position`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `section` ADD CONSTRAINT `section_group_id_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `account` ADD CONSTRAINT `account_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `passkey` ADD CONSTRAINT `passkey_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `session` ADD CONSTRAINT `session_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `two_factor` ADD CONSTRAINT `two_factor_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint

-- Added by hand: everything below. drizzle-kit neither generates nor diffs it; the schema files in
-- src/core/db/schema/mariadb mark each addition "Hand-written in the MariaDB baseline". The triggers
-- signal MYSQL_ERRNO 4025 with a constraint's name as the message, so the application maps them like
-- any CHECK constraint, as it maps the PostgreSQL triggers that raise the same names.
--
-- (1) Partial and NULLS NOT DISTINCT unique indexes, which MariaDB lacks, as unique indexes over
-- invisible generated columns: a column is null exactly where PostgreSQL's index excludes the row,
-- and nulls never collide. Invisible columns are left out of `SELECT *`, and Drizzle does not know them.
ALTER TABLE `group`
	ADD COLUMN `active_name_key` varchar(255) GENERATED ALWAYS AS (IF(`active`, `name`, NULL)) VIRTUAL INVISIBLE,
	ADD COLUMN `active_choir_key` varchar(36) GENERATED ALWAYS AS (IF(`active`, COALESCE(`choir_id`, ''), NULL)) VIRTUAL INVISIBLE,
	ADD CONSTRAINT `group_name_choir_active_unique` UNIQUE (`active_name_key`, `active_choir_key`);--> statement-breakpoint
ALTER TABLE `group_member`
	ADD COLUMN `current_key` tinyint GENERATED ALWAYS AS (IF(`end_date` IS NULL, 1, NULL)) VIRTUAL INVISIBLE,
	ADD CONSTRAINT `group_member_current_unique` UNIQUE (`user_id`, `group_id`, `current_key`);--> statement-breakpoint
ALTER TABLE `position_holder`
	ADD COLUMN `current_key` tinyint GENERATED ALWAYS AS (IF(`end_date` IS NULL, 1, NULL)) VIRTUAL INVISIBLE,
	ADD CONSTRAINT `position_holder_current_unique` UNIQUE (`group_id`, `position_id`, `current_key`);--> statement-breakpoint
ALTER TABLE `location`
	ADD COLUMN `active_name_key` varchar(255) GENERATED ALWAYS AS (IF(`active`, `name`, NULL)) VIRTUAL INVISIBLE,
	ADD CONSTRAINT `location_name_active_unique` UNIQUE (`active_name_key`);--> statement-breakpoint
ALTER TABLE `absence_reason`
	ADD COLUMN `active_label_key` varchar(255) GENERATED ALWAYS AS (IF(`active`, `label`, NULL)) VIRTUAL INVISIBLE,
	ADD CONSTRAINT `absence_reason_label_active_unique` UNIQUE (`active_label_key`);--> statement-breakpoint
ALTER TABLE `event_target`
	ADD COLUMN `group_key` varchar(36) GENERATED ALWAYS AS (COALESCE(`group_id`, '')) VIRTUAL INVISIBLE,
	ADD COLUMN `voice_family_key` varchar(2) GENERATED ALWAYS AS (COALESCE(`voice_family`, '')) VIRTUAL INVISIBLE,
	ADD CONSTRAINT `event_target_unique` UNIQUE (`event_id`, `group_key`, `voice_family_key`);--> statement-breakpoint

-- (2) A Membership has a Voice exactly when its group is a Section, and that Voice is contained in
-- the Section's: B1 or B2 in KKB, which sings B; only B1 in MKB1. MariaDB has no UPDATE OF, so an
-- update is checked when the group or Voice changes.
CREATE PROCEDURE `group_member_voice_check`(IN p_group_id varchar(36), IN p_member_voice varchar(2))
BEGIN
	DECLARE group_type varchar(64) DEFAULT (SELECT g.`type` FROM `group` g WHERE g.`id` = p_group_id);
	DECLARE section_voice varchar(2) DEFAULT (SELECT s.`voice` FROM `section` s WHERE s.`group_id` = p_group_id);
	IF (group_type = 'Section') <> (p_member_voice IS NOT NULL) THEN
		SIGNAL SQLSTATE '23000' SET MESSAGE_TEXT = 'group_member_voice_section_check', MYSQL_ERRNO = 4025;
	END IF;
	IF group_type = 'Section'
		AND NOT COALESCE(p_member_voice = section_voice OR LEFT(p_member_voice, 1) = section_voice, FALSE) THEN
		SIGNAL SQLSTATE '23000' SET MESSAGE_TEXT = 'group_member_voice_containment_check', MYSQL_ERRNO = 4025;
	END IF;
END;--> statement-breakpoint
CREATE TRIGGER `group_member_voice_check_insert` BEFORE INSERT ON `group_member` FOR EACH ROW
CALL `group_member_voice_check`(NEW.`group_id`, NEW.`voice`);--> statement-breakpoint
CREATE TRIGGER `group_member_voice_check_update` BEFORE UPDATE ON `group_member` FOR EACH ROW
BEGIN
	IF NOT (OLD.`group_id` <=> NEW.`group_id` AND OLD.`voice` <=> NEW.`voice`) THEN
		CALL `group_member_voice_check`(NEW.`group_id`, NEW.`voice`);
	END IF;
END;--> statement-breakpoint

-- (3) The Events triggers of drizzle/20261008134757_events/migration.sql, numbered as there. Each
-- check lives in a procedure that the insert and update triggers share.
--
-- (3.1) An Event's Responses, Registrations and Registration questions exist only while its mode
-- collects them, so a mode change that would strand them is refused.
CREATE TRIGGER `event_participation_mode_change_check` BEFORE UPDATE ON `event` FOR EACH ROW
BEGIN
	IF NOT (OLD.`participation_mode` <=> NEW.`participation_mode`) THEN
		IF NEW.`participation_mode` NOT IN ('ResponseRequired', 'ResponseRequiredStrict')
			AND EXISTS (SELECT 1 FROM `event_response` WHERE `event_id` = NEW.`id`) THEN
			SIGNAL SQLSTATE '23000' SET MESSAGE_TEXT = 'event_participation_mode_change_check', MYSQL_ERRNO = 4025;
		END IF;
		IF NEW.`participation_mode` <> 'Registration'
			AND (EXISTS (SELECT 1 FROM `event_registration` WHERE `event_id` = NEW.`id`)
				OR EXISTS (SELECT 1 FROM `event_registration_question` WHERE `event_id` = NEW.`id`)) THEN
			SIGNAL SQLSTATE '23000' SET MESSAGE_TEXT = 'event_participation_mode_change_check', MYSQL_ERRNO = 4025;
		END IF;
	END IF;
END;--> statement-breakpoint
-- (3.2) A Response goes only to a Published Event in a response mode, and in ResponseRequiredStrict it is
-- Yes, or No with a reason. The Event row is share-locked so that a concurrent mode or status change
-- waits. A missing Event is left to the foreign key to report.
CREATE PROCEDURE `event_response_check`(IN p_event_id varchar(36), IN p_answer varchar(8), IN p_absence_reason_id varchar(36), IN p_reason_text text)
BEGIN
	DECLARE found boolean DEFAULT TRUE;
	DECLARE event_status varchar(16);
	DECLARE event_mode varchar(32);
	DECLARE CONTINUE HANDLER FOR NOT FOUND SET found = FALSE;
	SELECT e.`status`, e.`participation_mode` INTO event_status, event_mode
	FROM `event` e WHERE e.`id` = p_event_id LOCK IN SHARE MODE;
	IF found THEN
		IF event_status <> 'Published' OR event_mode NOT IN ('ResponseRequired', 'ResponseRequiredStrict') THEN
			SIGNAL SQLSTATE '23000' SET MESSAGE_TEXT = 'event_response_mode_check', MYSQL_ERRNO = 4025;
		END IF;
		IF event_mode = 'ResponseRequiredStrict' AND (p_answer = 'Maybe' OR (p_answer = 'No'
			AND p_absence_reason_id IS NULL AND COALESCE(TRIM(p_reason_text), '') = '')) THEN
			SIGNAL SQLSTATE '23000' SET MESSAGE_TEXT = 'event_response_strict_check', MYSQL_ERRNO = 4025;
		END IF;
	END IF;
END;--> statement-breakpoint
CREATE TRIGGER `event_response_check_insert` BEFORE INSERT ON `event_response` FOR EACH ROW
CALL `event_response_check`(NEW.`event_id`, NEW.`answer`, NEW.`absence_reason_id`, NEW.`reason_text`);--> statement-breakpoint
-- (3.2) and (3.6) on update: Erasure (user_id becoming null) wipes the free text and is not a new
-- Response, so it is not checked, as in PostgreSQL, where Erasure updates only user_id.
CREATE TRIGGER `event_response_update` BEFORE UPDATE ON `event_response` FOR EACH ROW
BEGIN
	IF OLD.`user_id` IS NOT NULL AND NEW.`user_id` IS NULL THEN
		SET NEW.`comment` = NULL, NEW.`reason_text` = NULL;
	ELSEIF NOT (OLD.`event_id` <=> NEW.`event_id` AND OLD.`answer` <=> NEW.`answer`
		AND OLD.`absence_reason_id` <=> NEW.`absence_reason_id` AND OLD.`reason_text` <=> NEW.`reason_text`) THEN
		CALL `event_response_check`(NEW.`event_id`, NEW.`answer`, NEW.`absence_reason_id`, NEW.`reason_text`);
	END IF;
END;--> statement-breakpoint
-- (3.3) A Registration belongs to an Event in Registration mode, and registering (status Registered)
-- needs the Event to be Published. Withdrawing is always possible.
CREATE PROCEDURE `event_registration_check`(IN p_event_id varchar(36), IN p_registration_status varchar(16))
BEGIN
	DECLARE found boolean DEFAULT TRUE;
	DECLARE event_status varchar(16);
	DECLARE event_mode varchar(32);
	DECLARE CONTINUE HANDLER FOR NOT FOUND SET found = FALSE;
	SELECT e.`status`, e.`participation_mode` INTO event_status, event_mode
	FROM `event` e WHERE e.`id` = p_event_id LOCK IN SHARE MODE;
	IF found AND (event_mode <> 'Registration' OR (p_registration_status = 'Registered' AND event_status <> 'Published')) THEN
		SIGNAL SQLSTATE '23000' SET MESSAGE_TEXT = 'event_registration_mode_check', MYSQL_ERRNO = 4025;
	END IF;
END;--> statement-breakpoint
CREATE TRIGGER `event_registration_check_insert` BEFORE INSERT ON `event_registration` FOR EACH ROW
CALL `event_registration_check`(NEW.`event_id`, NEW.`status`);--> statement-breakpoint
CREATE TRIGGER `event_registration_update` BEFORE UPDATE ON `event_registration` FOR EACH ROW
BEGIN
	IF OLD.`user_id` IS NOT NULL AND NEW.`user_id` IS NULL THEN
		SET NEW.`comment` = NULL;
		UPDATE `event_registration_answer` SET `text` = NULL WHERE `registration_id` = NEW.`id` AND `text` IS NOT NULL;
	ELSEIF NOT (OLD.`event_id` <=> NEW.`event_id` AND OLD.`status` <=> NEW.`status`) THEN
		CALL `event_registration_check`(NEW.`event_id`, NEW.`status`);
	END IF;
END;--> statement-breakpoint
-- (3.4) Registration questions belong to an Event in Registration mode, Draft or not.
CREATE PROCEDURE `event_registration_question_check`(IN p_event_id varchar(36))
BEGIN
	DECLARE found boolean DEFAULT TRUE;
	DECLARE event_mode varchar(32);
	DECLARE CONTINUE HANDLER FOR NOT FOUND SET found = FALSE;
	SELECT e.`participation_mode` INTO event_mode FROM `event` e WHERE e.`id` = p_event_id LOCK IN SHARE MODE;
	IF found AND event_mode <> 'Registration' THEN
		SIGNAL SQLSTATE '23000' SET MESSAGE_TEXT = 'event_registration_question_mode_check', MYSQL_ERRNO = 4025;
	END IF;
END;--> statement-breakpoint
CREATE TRIGGER `event_registration_question_check_insert` BEFORE INSERT ON `event_registration_question` FOR EACH ROW
CALL `event_registration_question_check`(NEW.`event_id`);--> statement-breakpoint
CREATE TRIGGER `event_registration_question_check_update` BEFORE UPDATE ON `event_registration_question` FOR EACH ROW
BEGIN
	IF NOT (OLD.`event_id` <=> NEW.`event_id`) THEN
		CALL `event_registration_question_check`(NEW.`event_id`);
	END IF;
END;--> statement-breakpoint
-- (3.5) An answered question belongs to the Registration's Event. A missing Registration or question
-- is left to the foreign keys to report.
CREATE PROCEDURE `event_registration_answer_check`(IN p_registration_id varchar(36), IN p_question_id varchar(36))
BEGIN
	DECLARE registration_event varchar(36) DEFAULT (SELECT r.`event_id` FROM `event_registration` r WHERE r.`id` = p_registration_id);
	DECLARE question_event varchar(36) DEFAULT (SELECT q.`event_id` FROM `event_registration_question` q WHERE q.`id` = p_question_id);
	IF registration_event <> question_event THEN
		SIGNAL SQLSTATE '23000' SET MESSAGE_TEXT = 'event_registration_answer_question_check', MYSQL_ERRNO = 4025;
	END IF;
END;--> statement-breakpoint
CREATE TRIGGER `event_registration_answer_check_insert` BEFORE INSERT ON `event_registration_answer` FOR EACH ROW
CALL `event_registration_answer_check`(NEW.`registration_id`, NEW.`question_id`);--> statement-breakpoint
CREATE TRIGGER `event_registration_answer_check_update` BEFORE UPDATE ON `event_registration_answer` FOR EACH ROW
BEGIN
	IF NOT (OLD.`registration_id` <=> NEW.`registration_id` AND OLD.`question_id` <=> NEW.`question_id`) THEN
		CALL `event_registration_answer_check`(NEW.`registration_id`, NEW.`question_id`);
	END IF;
END;--> statement-breakpoint

-- (4) Erasure. InnoDB fires no triggers for changes a foreign key cascades, so deleting a User would
-- set `user_id` to null without (3.6) wiping the free text. Clearing `user_id` here first, before the
-- User row goes, runs the Erasure branch of each update trigger; the foreign keys then find nothing left.
CREATE TRIGGER `user_erasure` BEFORE DELETE ON `user` FOR EACH ROW
BEGIN
	UPDATE `event_response` SET `user_id` = NULL WHERE `user_id` = OLD.`id`;
	UPDATE `event_registration` SET `user_id` = NULL WHERE `user_id` = OLD.`id`;
END;--> statement-breakpoint
-- (5) Deleting an Event deletes its Registrations, and with them their answers and choices, first.
-- InnoDB checks `no action` foreign keys row by row rather than at the end of the statement, so in
-- one cascade an answered question or chosen option could otherwise go before its answer and be refused.
CREATE TRIGGER `event_delete_registrations` BEFORE DELETE ON `event` FOR EACH ROW
DELETE FROM `event_registration` WHERE `event_id` = OLD.`id`;--> statement-breakpoint

-- (6) The rows `lockKey` in src/core/db/sql.ts locks, which stand in for PostgreSQL's
-- transaction-scoped advisory locks: InnoDB holds a row lock until the transaction ends. Keys are
-- SHA-256 hashes; a row is never deleted, so a key costs one small row for good.
CREATE TABLE `advisory_lock` (
	`lock_key` char(64) PRIMARY KEY
);
