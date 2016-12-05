#!/usr/bin/python

import os,sys,re
import csv
import json

obj = {}

reader = csv.reader(open('translators.index'))
for row in reader:
	obj[row[1]] = {
		"lastUpdated": row[3],
		"label": row[2],
		"fileName": row[0]
	}

open('translators.json', 'w+').write(json.dumps(obj, ensure_ascii=False, indent=2))
