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

-- Brand Kit — logos, fonts, colours, templates and icons.
-- Deliberately NOT scoped per user: the point of a brand library is that
-- everyone draws on the same approved set. Short links are the opposite,
-- and are scoped by created_by.
CREATE TABLE IF NOT EXISTS `assets` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `kind`       VARCHAR(16)  NOT NULL,               -- logo|font|colour|template|icon
  `name`       VARCHAR(160) NOT NULL,
  `value`      VARCHAR(64)  NOT NULL DEFAULT '',    -- hex, for colours
  `file`       VARCHAR(160) NOT NULL DEFAULT '',    -- stored (randomised) filename
  `original`   VARCHAR(200) NOT NULL DEFAULT '',    -- name it was uploaded under
  `mime`       VARCHAR(100) NOT NULL DEFAULT '',
  `bytes`      INT UNSIGNED NOT NULL DEFAULT 0,
  `notes`      VARCHAR(255) NOT NULL DEFAULT '',
  `created_at` DATETIME     NOT NULL,
  `created_by` VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `kind` (`kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
