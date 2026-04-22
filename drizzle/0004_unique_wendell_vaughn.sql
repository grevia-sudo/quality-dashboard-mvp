ALTER TABLE `products` ADD `poNumber` varchar(120);--> statement-breakpoint
ALTER TABLE `products` ADD `vendorName` varchar(160);--> statement-breakpoint
ALTER TABLE `products` ADD `arrivalAt` timestamp;--> statement-breakpoint
ALTER TABLE `products` ADD `sheetRowNumber` int;--> statement-breakpoint
ALTER TABLE `products` ADD `lastSheetSyncedAt` timestamp;