CREATE TABLE `import_batch_backups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`poNumber` varchar(120) NOT NULL,
	`vendorName` varchar(160),
	`backupLabel` varchar(200),
	`productCount` int NOT NULL DEFAULT 0,
	`createdByUserId` int,
	`restoredAt` timestamp,
	`restoredByUserId` int,
	`snapshot` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `import_batch_backups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `import_batch_backups` ADD CONSTRAINT `import_batch_backups_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_batch_backups` ADD CONSTRAINT `import_batch_backups_restoredByUserId_users_id_fk` FOREIGN KEY (`restoredByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;