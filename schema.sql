-- OMQ Short Links — MySQL schema.
-- Run once in cPanel → phpMyAdmin against the database you created.
-- db.php also creates this table on demand, so importing it is optional.

CREATE TABLE IF NOT EXISTS `links` (
  `code`        VARCHAR(64)  NOT NULL,
  `url`         TEXT         NOT NULL,
  `label`       VARCHAR(255) NOT NULL DEFAULT '',
  `created_at`  DATETIME     NOT NULL,
  `created_by`  VARCHAR(255) NOT NULL DEFAULT '',
  `updated_at`  DATETIME         NULL DEFAULT NULL,
  `updated_by`  VARCHAR(255) NOT NULL DEFAULT '',
  `hits`        INT UNSIGNED NOT NULL DEFAULT 0,
  `last_hit_at` DATETIME         NULL DEFAULT NULL,
  PRIMARY KEY (`code`),
  KEY `created_at` (`created_at`),
  KEY `created_by` (`created_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
