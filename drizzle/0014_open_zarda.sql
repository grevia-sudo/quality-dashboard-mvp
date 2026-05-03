CREATE TABLE `purchase_order_deletion_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`poNumber` varchar(120) NOT NULL,
	`vendorName` varchar(160),
	`deletedProducts` int NOT NULL DEFAULT 0,
	`deletedTasks` int NOT NULL DEFAULT 0,
	`deletedByUserId` int,
	`deletedByName` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `purchase_order_deletion_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `purchase_order_deletion_logs` ADD CONSTRAINT `purchase_order_deletion_logs_deletedByUserId_users_id_fk` FOREIGN KEY (`deletedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `purchase_order_deletion_logs_po_idx` ON `purchase_order_deletion_logs` (`poNumber`);--> statement-breakpoint
CREATE INDEX `purchase_order_deletion_logs_created_at_idx` ON `purchase_order_deletion_logs` (`createdAt`);