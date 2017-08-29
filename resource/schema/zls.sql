-- 20160719

-- This file is derived from the IANA Language Subtag Registry

DROP TABLE IF EXISTS isoTagMap;
CREATE TABLE isoTagMap (
	iso TEXT PRIMARY KEY,
	iana TEXT
);

DROP TABLE IF EXISTS zlsSubtagData;
CREATE TABLE zlsSubtagData (
	id INTEGER PRIMARY KEY,
	value TEXT
);
INSERT INTO "zlsSubtagData" VALUES(6,'language');
INSERT INTO "zlsSubtagData" VALUES(16621,'region');
INSERT INTO "zlsSubtagData" VALUES(16335,'script');
INSERT INTO "zlsSubtagData" VALUES(17241,'variant');
INSERT INTO "zlsSubtagData" VALUES(20,'macrolanguage');
INSERT INTO "zlsSubtagData" VALUES(94,'en');
INSERT INTO "zlsSubtagData" VALUES(114,'fr');
INSERT INTO "zlsSubtagData" VALUES(178,'ja');
INSERT INTO "zlsSubtagData" VALUES(416,'zh');
INSERT INTO "zlsSubtagData" VALUES(16,'Latn');
INSERT INTO "zlsSubtagData" VALUES(225,'Latin');
INSERT INTO "zlsSubtagData" VALUES(179,'Jpan');
INSERT INTO "zlsSubtagData" VALUES(27,'Arab');
INSERT INTO "zlsSubtagData" VALUES(28,'Arabic');
INSERT INTO "zlsSubtagData" VALUES(95,'English');
INSERT INTO "zlsSubtagData" VALUES(17130,'US');
INSERT INTO "zlsSubtagData" VALUES(17131,'United States');
INSERT INTO "zlsSubtagData" VALUES(16805,'GB');
INSERT INTO "zlsSubtagData" VALUES(16806,'United Kingdom');
INSERT INTO "zlsSubtagData" VALUES(115,'French');
INSERT INTO "zlsSubtagData" VALUES(16798,'FR');
INSERT INTO "zlsSubtagData" VALUES(16799,'France');
INSERT INTO "zlsSubtagData" VALUES(180,'Japanese');
INSERT INTO "zlsSubtagData" VALUES(16883,'JP');
INSERT INTO "zlsSubtagData" VALUES(16884,'Japan');
INSERT INTO "zlsSubtagData" VALUES(17265,'alalc97');
INSERT INTO "zlsSubtagData" VALUES(17266,'ALA-LC Romanization, 1997 edition');
INSERT INTO "zlsSubtagData" VALUES(417,'Chinese');
INSERT INTO "zlsSubtagData" VALUES(8554,'min');
INSERT INTO "zlsSubtagData" VALUES(8555,'Minangkabau');
INSERT INTO "zlsSubtagData" VALUES(155,'ms');
INSERT INTO "zlsSubtagData" VALUES(16726,'CN');
INSERT INTO "zlsSubtagData" VALUES(16727,'China');

DROP TABLE IF EXISTS zlsSubtags;
CREATE TABLE zlsSubtags (
	seq INTEGER PRIMARY KEY,
	subtag INT,
	tag INT,
	type INT,
	suppressscript INT,
	scope INT,
	preferredvalue INT,
	macrolanguage INT,
	added INT,
	description INT,
	deprecated INT,
	comment INT,
	prefix INT
);
-- en language
INSERT INTO "zlsSubtags" VALUES(38,94,NULL,6,16,NULL,NULL,NULL,NULL,95,NULL,NULL,NULL);
-- fr language
INSERT INTO "zlsSubtags" VALUES(48,114,NULL,6,16,NULL,NULL,NULL,NULL,115,NULL,NULL,NULL);
-- ja language
INSERT INTO "zlsSubtags" VALUES(77,178,NULL,6,179,NULL,NULL,NULL,NULL,180,NULL,NULL,NULL);
-- CN region
INSERT INTO "zlsSubtags" VALUES(8812,16726,NULL,16621,NULL,NULL,NULL,NULL,NULL,16727,NULL,NULL,NULL);
-- FR region
INSERT INTO "zlsSubtags" VALUES(8846,16798,NULL,16621,NULL,NULL,NULL,NULL,NULL,16799,NULL,NULL,NULL);
-- GB region
INSERT INTO "zlsSubtags" VALUES(8849,16805,NULL,16621,NULL,NULL,NULL,NULL,NULL,16806,NULL,NULL,NULL);
-- JP region
INSERT INTO "zlsSubtags" VALUES(8887,16883,NULL,16621,NULL,NULL,NULL,NULL,NULL,16884,NULL,NULL,NULL);
-- US region
INSERT INTO "zlsSubtags" VALUES(9012,17130,NULL,16621,NULL,NULL,NULL,NULL,NULL,17131,NULL,NULL,NULL);
-- Arabic script
INSERT INTO "zlsSubtags" VALUES(8584,27,NULL,16335,NULL,NULL,NULL,NULL,NULL,28,NULL,NULL,NULL);
-- Japanese script
INSERT INTO "zlsSubtags" VALUES(8644,179,NULL,16335,NULL,NULL,NULL,NULL,NULL,16437,NULL,NULL,NULL);
-- Latin script
INSERT INTO "zlsSubtags" VALUES(8661,16,NULL,16335,NULL,NULL,NULL,NULL,NULL,225,NULL,NULL,NULL);
-- alalc97 variant
INSERT INTO "zlsSubtags" VALUES(9082,17265,NULL,17241,NULL,NULL,NULL,NULL,NULL,17266,NULL,NULL,NULL);
-- zh language
INSERT INTO "zlsSubtags" VALUES(189,416,NULL,6,NULL,20,NULL,NULL,NULL,417,NULL,NULL,NULL);
-- Mystery language (should NOT match in test of zh-min).
INSERT INTO "zlsSubtags" VALUES(4232,8554,NULL,6,NULL,NULL,NULL,155,NULL,8555,NULL,NULL,NULL);
