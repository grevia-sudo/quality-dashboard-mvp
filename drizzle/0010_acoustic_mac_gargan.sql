CREATE TABLE `category_station_flows` (
	`id` int AUTO_INCREMENT NOT NULL,
	`categoryId` int NOT NULL,
	`stationCode` enum('A1','A2','B','C','D','E','STOCK') NOT NULL,
	`stepOrder` int NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `category_station_flows_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `category_station_flows` ADD CONSTRAINT `category_station_flows_categoryId_product_categories_id_fk` FOREIGN KEY (`categoryId`) REFERENCES `product_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `category_station_flows_category_step_idx` ON `category_station_flows` (`categoryId`,`stepOrder`);--> statement-breakpoint
CREATE INDEX `category_station_flows_category_station_idx` ON `category_station_flows` (`categoryId`,`stationCode`);