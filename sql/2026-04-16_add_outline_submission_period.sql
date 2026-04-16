CREATE TABLE IF NOT EXISTS `outline_submission_period` (
  `id` tinyint unsigned NOT NULL,
  `open_at` datetime NOT NULL,
  `close_at` datetime NOT NULL,
  `created_by_user_id` bigint unsigned DEFAULT NULL,
  `updated_by_user_id` bigint unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_outline_submission_period_created_by` (`created_by_user_id`),
  KEY `idx_outline_submission_period_updated_by` (`updated_by_user_id`),
  CONSTRAINT `fk_outline_submission_period_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_outline_submission_period_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
