CREATE INDEX `products_a1_imei_lookup_idx` ON `products` (`stationCode`,`archivedAt`,`imei`);--> statement-breakpoint
CREATE INDEX `products_a1_serial_lookup_idx` ON `products` (`stationCode`,`archivedAt`,`serialNumber`);--> statement-breakpoint
CREATE INDEX `products_a1_batch_lookup_idx` ON `products` (`stationCode`,`archivedAt`,`batchNo`);--> statement-breakpoint
CREATE INDEX `products_station_status_idx` ON `products` (`stationCode`,`productStatus`,`archivedAt`);--> statement-breakpoint
CREATE INDEX `station_tasks_product_station_status_idx` ON `station_tasks` (`productId`,`stationCode`,`stationTaskStatus`);--> statement-breakpoint
CREATE INDEX `station_tasks_station_queue_idx` ON `station_tasks` (`stationCode`,`stationTaskStatus`,`isOverdue`,`id`);