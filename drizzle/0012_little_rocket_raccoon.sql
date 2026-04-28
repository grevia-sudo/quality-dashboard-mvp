CREATE TABLE `support_task_compensations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessDate` date NOT NULL,
	`userId` int NOT NULL,
	`supportTask` varchar(160) NOT NULL,
	`supportHours` decimal(6,2) NOT NULL,
	`notes` text,
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `support_task_compensations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `support_task_compensations` ADD CONSTRAINT `support_task_compensations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `support_task_compensations` ADD CONSTRAINT `support_task_compensations_createdByUserId_users_id_fk` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `support_task_compensations_user_date_idx` ON `support_task_compensations` (`userId`,`businessDate`);--> statement-breakpoint
CREATE INDEX `support_task_compensations_date_idx` ON `support_task_compensations` (`businessDate`);