CREATE TABLE `engineer_daily_productivity` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessDate` date NOT NULL,
	`userId` int NOT NULL,
	`attendanceFlag` boolean NOT NULL DEFAULT true,
	`totalPoints` decimal(12,6) NOT NULL DEFAULT '0.000000',
	`rawAchievementRate` decimal(8,2) NOT NULL DEFAULT '0.00',
	`kpiAchievementRate` decimal(8,2) NOT NULL DEFAULT '0.00',
	`overAchievementRate` decimal(8,2) NOT NULL DEFAULT '0.00',
	`samplingFailRate` decimal(8,4) NOT NULL DEFAULT '0.0000',
	`reworkRate` decimal(8,4) NOT NULL DEFAULT '0.0000',
	`overdueCount` int NOT NULL DEFAULT 0,
	`avgProcessHours` decimal(8,2) NOT NULL DEFAULT '0.00',
	`attendanceFairnessFactor` decimal(8,4) NOT NULL DEFAULT '1.0000',
	`finalKpiScore` decimal(12,6) NOT NULL DEFAULT '0.000000',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `engineer_daily_productivity_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_archives` (
	`id` int AUTO_INCREMENT NOT NULL,
	`originalProductId` int NOT NULL,
	`productSnapshot` json NOT NULL,
	`archivedAt` timestamp NOT NULL DEFAULT (now()),
	`archiveMonth` varchar(7) NOT NULL,
	CONSTRAINT `product_archives_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`categoryName` varchar(120) NOT NULL,
	`subtypeCode` varchar(80) NOT NULL,
	`brandName` varchar(80),
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `productivity_score_details` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessDate` date NOT NULL,
	`userId` int NOT NULL,
	`stationEventId` int NOT NULL,
	`productId` int NOT NULL,
	`stationCode` enum('A1','A2','B','C','D','E','STOCK') NOT NULL DEFAULT 'C',
	`categoryId` int,
	`subtypeCode` varchar(80),
	`targetConfigId` int,
	`completedQty` int NOT NULL DEFAULT 1,
	`baseUnitPoints` decimal(12,6) NOT NULL,
	`reworkFactor` decimal(8,4) NOT NULL DEFAULT '1.0000',
	`qualityFactor` decimal(8,4) NOT NULL DEFAULT '1.0000',
	`earnedPoints` decimal(12,6) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `productivity_score_details_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `productivity_target_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stationCode` enum('A1','A2','B','C','D','E','STOCK') NOT NULL DEFAULT 'C',
	`categoryId` int,
	`subtypeCode` varchar(80) NOT NULL,
	`dailyTargetQty` int NOT NULL,
	`baseUnitPoints` decimal(12,6) NOT NULL,
	`qualityDeductionThreshold` decimal(8,4) DEFAULT '0.0000',
	`reworkFactor` decimal(8,4) NOT NULL DEFAULT '0.5000',
	`effectiveFrom` date NOT NULL,
	`effectiveTo` date,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `productivity_target_configs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productCode` varchar(120) NOT NULL,
	`batchNo` varchar(120),
	`serialNumber` varchar(120),
	`imei` varchar(120),
	`productName` varchar(160),
	`warrantyDate` date,
	`categoryId` int,
	`stationCode` enum('A1','A2','B','C','D','E','STOCK') NOT NULL DEFAULT 'A1',
	`productStatus` enum('pending_a1','pending_a2','pending_b','pending_c','pending_d','pending_e','pending_stock','completed','archived') NOT NULL DEFAULT 'pending_a1',
	`inspectionSummary` text,
	`wipeStatus` varchar(40) DEFAULT 'pending',
	`stockStatus` varchar(40) DEFAULT 'pending',
	`archivedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_productCode_unique` UNIQUE(`productCode`)
);
--> statement-breakpoint
CREATE TABLE `sampling_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`stationTaskId` int,
	`sampledByUserId` int,
	`sampleDate` date NOT NULL,
	`passed` boolean NOT NULL,
	`defectReason` text,
	`stationCode` enum('A1','A2','B','C','D','E','STOCK') NOT NULL DEFAULT 'C',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sampling_results_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sheet_sync_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobType` varchar(80) NOT NULL,
	`targetSheetName` varchar(160) NOT NULL,
	`syncJobStatus` enum('queued','processing','success','failed') NOT NULL DEFAULT 'queued',
	`queuedAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`finishedAt` timestamp,
	`errorMessage` text,
	CONSTRAINT `sheet_sync_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `station_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`stationTaskId` int,
	`stationCode` enum('A1','A2','B','C','D','E','STOCK') NOT NULL DEFAULT 'A1',
	`stationEventType` enum('enter','complete','return_to_hub','rework','sampling_pass','sampling_fail','wipe_complete','stock_ready','archived') NOT NULL,
	`operatorUserId` int,
	`businessDate` date NOT NULL,
	`categoryId` int,
	`subtypeCode` varchar(80),
	`isRework` boolean NOT NULL DEFAULT false,
	`reworkRound` int NOT NULL DEFAULT 0,
	`countForProductivity` boolean NOT NULL DEFAULT true,
	`payload` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `station_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `station_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stationCode` enum('A1','A2','B','C','D','E','STOCK') NOT NULL,
	`routeKey` varchar(80) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `station_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `station_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`stationCode` enum('A1','A2','B','C','D','E','STOCK') NOT NULL DEFAULT 'A1',
	`assignedUserId` int,
	`stationTaskStatus` enum('pending','in_progress','completed','returned','overdue','archived') NOT NULL DEFAULT 'pending',
	`dueDate` date,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`isOverdue` boolean NOT NULL DEFAULT false,
	`resultSummary` text,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `station_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin','manager','engineer','supervisor') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
ALTER TABLE `engineer_daily_productivity` ADD CONSTRAINT `engineer_daily_productivity_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `productivity_score_details` ADD CONSTRAINT `productivity_score_details_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `productivity_score_details` ADD CONSTRAINT `productivity_score_details_stationEventId_station_events_id_fk` FOREIGN KEY (`stationEventId`) REFERENCES `station_events`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `productivity_score_details` ADD CONSTRAINT `productivity_score_details_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `productivity_score_details` ADD CONSTRAINT `productivity_score_details_categoryId_product_categories_id_fk` FOREIGN KEY (`categoryId`) REFERENCES `product_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `productivity_target_configs` ADD CONSTRAINT `productivity_target_configs_categoryId_product_categories_id_fk` FOREIGN KEY (`categoryId`) REFERENCES `product_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_categoryId_product_categories_id_fk` FOREIGN KEY (`categoryId`) REFERENCES `product_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sampling_results` ADD CONSTRAINT `sampling_results_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sampling_results` ADD CONSTRAINT `sampling_results_stationTaskId_station_tasks_id_fk` FOREIGN KEY (`stationTaskId`) REFERENCES `station_tasks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sampling_results` ADD CONSTRAINT `sampling_results_sampledByUserId_users_id_fk` FOREIGN KEY (`sampledByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `station_events` ADD CONSTRAINT `station_events_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `station_events` ADD CONSTRAINT `station_events_stationTaskId_station_tasks_id_fk` FOREIGN KEY (`stationTaskId`) REFERENCES `station_tasks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `station_events` ADD CONSTRAINT `station_events_operatorUserId_users_id_fk` FOREIGN KEY (`operatorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `station_events` ADD CONSTRAINT `station_events_categoryId_product_categories_id_fk` FOREIGN KEY (`categoryId`) REFERENCES `product_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `station_tasks` ADD CONSTRAINT `station_tasks_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `station_tasks` ADD CONSTRAINT `station_tasks_assignedUserId_users_id_fk` FOREIGN KEY (`assignedUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;