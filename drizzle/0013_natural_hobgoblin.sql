CREATE TABLE `product_name_catalog_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(191) NOT NULL,
	`categoryName` varchar(120) NOT NULL,
	`brandName` varchar(120) NOT NULL,
	`sourceRowNumber` int NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_name_catalog_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `product_name_catalog_category_brand_label_idx` ON `product_name_catalog_entries` (`categoryName`,`brandName`,`label`);--> statement-breakpoint
CREATE INDEX `product_name_catalog_active_sort_idx` ON `product_name_catalog_entries` (`active`,`sortOrder`,`id`);