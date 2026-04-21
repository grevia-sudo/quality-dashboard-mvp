CREATE TABLE `defect_options` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stationCode` enum('A1','A2','B','C','D','E','STOCK') NOT NULL,
	`defectOptionType` enum('fault','appearance') NOT NULL,
	`label` varchar(160) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `defect_options_id` PRIMARY KEY(`id`)
);
