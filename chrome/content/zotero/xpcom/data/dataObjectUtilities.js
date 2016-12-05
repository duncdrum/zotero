/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2009 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/


Zotero.DataObjectUtilities = {
	/**
	 * Get all DataObject types
	 *
	 * @return {String[]} - An array of DataObject types
	 */
	getTypes: function () {
		return ['collection', 'search', 'item'];
	},
	
	/**
	 * Get DataObject types that are valid for a given library
	 *
	 * @param {Integer} libraryID
	 * @return {String[]} - An array of DataObject types
	 */
	getTypesForLibrary: function (libraryID) {
		switch (Zotero.Libraries.get(libraryID).libraryType) {
		case 'publications':
			return ['item'];
		
		default:
			return this.getTypes();
		}
	},
	
	"checkLibraryID": function (libraryID) {
		if (!libraryID) {
			throw new Error("libraryID not provided");
		}
		var intValue = parseInt(libraryID);
		if (libraryID != intValue || intValue <= 0) {
			throw new Error("libraryID must be a positive integer");
		}
		return intValue;
	},
	
	"checkDataID": function(dataID) {
		var intValue = parseInt(dataID);
		if (dataID != intValue || dataID <= 0)
			throw new Error("id must be a positive integer");
		return intValue;
	},
	
	
	generateKey: function () {
		return Zotero.Utilities.generateObjectKey();
	},
	
	
	"checkKey": function(key) {
		if (!key && key !== 0) return null;
		if (!Zotero.Utilities.isValidObjectKey(key)) {
			throw new Error("key is not valid");
		}
		return key;
	},
	
	
	getObjectTypeSingular: function (objectTypePlural) {
		return objectTypePlural.replace(/(s|es)$/, '');
	},
	
	
	"getObjectTypePlural": function(objectType) {
		switch(objectType) {
			case 'search':
				return 'searches';
			break;
			case 'library':
				return 'libraries';
			break;
			default:
				return objectType + 's';
		}
	},
	
	
	"getObjectsClassForObjectType": function(objectType) {
		if (objectType == 'setting') objectType = 'syncedSetting';
		
		var objectTypePlural = this.getObjectTypePlural(objectType);
		var className = objectTypePlural[0].toUpperCase() + objectTypePlural.substr(1);
		return Zotero[className]
	},
	
	
	patch: function (base, obj) {
		if (base.multi || obj.multi) {
			Zotero.DataObjectUtilities.encodeMlzContent(base);
			Zotero.DataObjectUtilities.encodeMlzContent(obj);
		}
		var target = {};
		for (let key in obj) {
			target[key] = obj[key];
		}
		
		for (let i in base) {
			switch (i) {
			case 'key':
			case 'version':
			case 'dateModified':
				continue;
			}
			
			// If field from base exists in the new version, delete it if it's the same
			if (i in target) {
				if (!this._fieldChanged(i, base[i], target[i]) && i !== 'multi') {
					delete target[i];
				}
			}
			// If field from base doesn't exist in new version, clear it
			else {
				switch (i) {
				// When changing an item from top-level to child, the collections property is
				// no valid, so it doesn't need to be cleared
				case 'collections':
					break;
				
				case 'deleted':
				case 'parentItem':
				case 'inPublications':
					target[i] = false;
					break;
				
				default:
					target[i] = '';
				}
			}
		}
		
		return target;
	},
	
	
	/**
	 * Determine whether two API JSON objects are equivalent
	 *
	 * Note: Currently unused
	 *
	 * @param {Object} data1 - API JSON of first object
	 * @param {Object} data2 - API JSON of second object
	 * @param {Array} [ignoreFields] - Fields to ignore
	 * @return {Boolean} - True if objects are the same, false if not
	 */
	equals: function (data1, data2, ignoreFields) {
		var skipFields = {};
		for (let field of ['key', 'version', 'multi'].concat(ignoreFields || [])) {
			skipFields[field] = true;
		}
		
		var me = this;

		function _equals(skipFields, checkFieldContent, data1, data2) {

			for (let field in data1) {
				
				if (skipFields[field]) {
					continue;
				}
				
				let val1 = data1[field];
				let val2 = data2[field];
				let val1HasValue = val1 || val1 === 0;
				let val2HasValue = val2 || val2 === 0;
				
				if (!val1HasValue && !val2HasValue) {
					continue;
				}

				if (checkFieldContent) {
					let changed = me._fieldChanged(field, val1, val2);
					if (changed) {
						return false;
					}
				} else {
					if (val1HasValue !== val2HasValue) {
						return false;
					}
				}
				
				skipFields[field] = true;
			}
			
			for (let field in data2) {
				
				// Skip ignored fields and fields we've already compared
				if (skipFields[field]) {
					continue;
				}
				
				// All remaining fields don't exist in data1
				// (will only be reached in checkFieldContent mode)
				
				//if (data2[field]) {
				// Try this instead
				let val2 = data2[field];
				let val2HasValue = val2 || val2 === 0;
				if (!val2HasValue) {
					continue;
				}
				
				return false;
			}
			
			return true;
		}
		

		if (!_equals(skipFields, true, data1, data2)) {
			return false;
		}
		if (data1.multi) {
			if (data1.multi._keys) {
				let fieldMains1 = data1.multi.main;
				let fieldMains2 = data2.multi.main;
				skipFieldsCopy = skipFields.slice();
				if (!_equals(skipFieldsCopy, false, fieldMains1, fieldMains2)) {
					return false;
				}
				for (let fieldMain in fieldMains1) {
					if (!_equals(skipFieldsCopy, true, fieldMains1[fieldMain], fieldMains2[fieldMain])) {
						return false;
					}
				}
				let fieldKeys1 = data1.multi._keys;
				let fieldKeys2 = data2.multi._keys;
				if (!_equals(skipFieldsCopy, false, fieldKeys1, fieldKeys2)) {
					return false;
				}
				for (let fieldKey in fieldKeys1) {
					if (!_equals(skipFieldsCopy, false, fieldKeys1[fieldKey], fieldKeys2[fieldKey])) {
						return false;
					}

					for (let fieldLang in fieldKeys1[fieldKey]) {
						if (!_equals(skipFieldsCopy, true, fieldKeys1[fieldKey][fieldLang], fieldKeys2[fieldKey][fieldLang])) {
							return false;
						}
					}

				}
			} else if (data1.multi._key) {
				if (data1.multi.main !== data2.multi.main) {
					return false;
				}
				let langKeys1 = data1.multi._key;
				let langKeys2 = data2.multi._key;
				if (!_equals(skipFieldsCopy, false, langKeys1, langKeys2)) {
					return false;
				}
				for (let langKey in langKeys1) {
					if (!_equals(skipFieldsCopy, true, langKeys1[langKey], langKeys2[langKey])) {
						return false;
					}
				}
			}
		}
		
		return true;
	},
	
	_fieldChanged: function (fieldName, field1, field2) {
		switch (fieldName) {
		case 'collections':
		case 'conditions':
		case 'creators':
		case 'tags':
		case 'relations':
			return this["_" + fieldName + "Changed"](field1, field2);
		
		default:
			return field1 !== field2;
		}
	},
	
	_creatorsChanged: function (data1, data2) {
		if (!data2 || data1.length != data2.length) return true;
		for (let i = 0; i < data1.length; i++) {
			if (!Zotero.Creators.equals(data1[i], data2[i])) {
				return true;
			}
		}
		return false;
	},
	
	_conditionsChanged: function (data1, data2) {
		if (!data2) return true;
		var pred1 = Object.keys(data1);
		pred1.sort();
		var pred2 = Object.keys(data2);
		pred2.sort();
		if (!Zotero.Utilities.arrayEquals(pred1, pred2)) return false;
		for (let i in pred1) {
			if (!Zotero.Utilities.arrayEquals(pred1[i], pred2[i])) {
				return true;
			}
		}
		return false;
	},
	
	_collectionsChanged: function (data1, data2) {
		if (!data2 || data1.length != data2.length) return true;
		let c1 = data1.concat();
		let c2 = data2.concat();
		c1.sort();
		c2.sort();
		return !Zotero.Utilities.arrayEquals(c1, c2);
	},
	
	_tagsChanged: function (data1, data2) {
		if (!data2 || data1.length != data2.length) return true;
		for (let i = 0; i < data1.length; i++) {
			if (!Zotero.Tags.equals(data1[i], data2[i])) {
				return true;
			}
		}
		return false;
	},
	
	_relationsChanged: function (data1, data2) {
		if (!data2) return true;
		var pred1 = Object.keys(data1);
		pred1.sort();
		var pred2 = Object.keys(data2);
		pred2.sort();
		if (!Zotero.Utilities.arrayEquals(pred1, pred2)) return true;
		for (let pred in pred1) {
			let vals1 = typeof data1[pred] == 'string' ? [data1[pred]] : data1[pred];
			let vals2 = (!data2[pred] || data2[pred] === '')
				? []
				: typeof data2[pred] == 'string' ? [data2[pred]] : data2[pred];
			
			if (!Zotero.Utilities.arrayEquals(vals1, vals2)) {
				return true;
			}
		}
		return false;
	},
	
	
	/**
	 * Compare two API JSON objects and generate a changeset
	 *
	 * @param {Object} data1
	 * @param {Object} data2
	 * @param {String[]} [ignoreFields] - Fields to ignore
	 */
	diff: function (origData1, origData2, ignoreFields) {
		var changeset = [];
		
		var skipFields = {};
		for (let field of ['key', 'version', 'multi'].concat(ignoreFields || [])) {
			skipFields[field] = true;
		}

		// Flatten and clone an API JSON object
		function _clone(data) {
			var newdata = {};
			for (let field in data) {
				if (skipFields[field]) {
					continue;
				}
				newdata[field] = data[field];
			}
			if (data.multi) {
				if (data.multi._keys) {
					if (data.multi.main) {
						for (let field in data.multi.main) {
							let altName = '|multi|main|' + field;
							newdata[altName] = data.multi.main[field];
						}
					}
					for (let field in data.multi._keys) {
						for (let langTag in data.multi._keys[field]) {
							let altName = '|multi|_keys|' + field + '|' + langTag;
							newdata[altName] = data.multi._keys[field][langTag];
						}
					}
				}
			}
			return newdata;
		}
		
		var data1 = _clone(origData1);
		var data2 = _clone(origData2);
		
		for (let field in data1) {
			if (skipFields[field]) {
				continue;
			}
			
			let val1 = data1[field];
			let val2 = data2[field];
			let val1HasValue = (val1 && val1 !== "") || val1 === 0;
			let val2HasValue = (val2 && val2 !== "") || val2 === 0;
			
			if (!val1HasValue && !val2HasValue) {
				continue;
			}
			
			switch (field) {
			case 'creators':
			case 'collections':
			case 'conditions':
			case 'relations':
			case 'tags':
				let changes = this["_" + field + "Diff"](val1, val2);
				if (changes.length) {
					changeset = changeset.concat(changes);
				}
				break;
			
			case 'note':
				let change = this._htmlDiff(field, val1, val2);
				if (change) {
					changeset.push(change);
				}
				break;
			
			default:
				var changed = val1 !== val2;
				if (changed) {
					if (val1HasValue && !val2HasValue) {
						changeset.push({
							field: field,
							op: 'delete'
						});
					}
					else if (!val1HasValue && val2HasValue) {
						changeset.push({
							field: field,
							op: 'add',
							value: val2
						});
					}
					else {
						changeset.push({
							field: field,
							op: 'modify',
							value: val2
						});
					}
				}
			}
			
			skipFields[field] = true;
		}
		
		for (let field in data2) {
			// Skip ignored fields and fields we've already compared
			if (skipFields[field]) {
				continue;
			}
			
			// All remaining fields don't exist in data1
			
			let val = data2[field];
			if (val === false || val === "" || val === null
					|| (typeof val == 'object' && Object.keys(val).length == 0)) {
				continue;
			}
			
			changeset.push({
				field: field,
				op: "add",
				value: data2[field]
			});
		}
		
		return changeset;
	},
	
	/**
	 * For creators, just determine if changed, since ordering makes a full diff too complicated
	 */
	_creatorsDiff: function (data1, data2) {
		if (!data2 || !data2.length) {
			if (!data1.length) {
				return [];
			}
			return [{
				field: "creators",
				op: "delete"
			}];
		}
		if (this._creatorsChanged(data1, data2)) {
			return [{
				field: "creators",
				op: "modify",
				value: data2
			}];
		}
		return [];
	},
	
	_collectionsDiff: function (data1, data2 = []) {
		var changeset = [];
		var removed = Zotero.Utilities.arrayDiff(data1, data2);
		for (let i = 0; i < removed.length; i++) {
			changeset.push({
				field: "collections",
				op: "member-remove",
				value: removed[i]
			});
		}
		let added = Zotero.Utilities.arrayDiff(data2, data1);
		for (let i = 0; i < added.length; i++) {
			changeset.push({
				field: "collections",
				op: "member-add",
				value: added[i]
			});
		}
		return changeset;
	},
	
	_conditionsDiff: function (data1, data2 = {}) {
		var changeset = [];
		outer:
		for (let i = 0; i < data1.length; i++) {
			for (let j = 0; j < data2.length; j++) {
				if (Zotero.SearchConditions.equals(data1[i], data2[j])) {
					continue outer;
				}
			}
			changeset.push({
				field: "conditions",
				op: "member-remove",
				value: data1[i]
			});
		}
		outer:
		for (let i = 0; i < data2.length; i++) {
			for (let j = 0; j < data1.length; j++) {
				if (Zotero.SearchConditions.equals(data2[i], data1[j])) {
					continue outer;
				}
			}
			changeset.push({
				field: "conditions",
				op: "member-add",
				value: data2[i]
			});
		}
		return changeset;
	},
	
	_htmlDiff: function (field, html1, html2 = "") {
		if (html1 == "" && html2 != "") {
			return {
				field,
				op: "add",
				value: html2
			};
		}
		if (html1 != "" && html2 == "") {
			return {
				field,
				op: "delete"
			};
		}
		
		// Until we have a consistent way of sanitizing HTML on client and server, account for differences
		var mods = [
			['<p>&nbsp;</p>', '<p>\u00a0</p>']
		];
		var a = html1;
		var b = html2;
		for (let mod of mods) {
			a = a.replace(new RegExp(mod[0], 'g'), mod[1]);
			b = b.replace(new RegExp(mod[0], 'g'), mod[1]);
		}
		if (a != b) {
			Zotero.debug("HTML diff:");
			Zotero.debug(a);
			Zotero.debug(b);
			return {
				field,
				op: "modify",
				value: html2
			};
		}
		
		return false;
	},
	
	_tagsDiff: function (data1, data2 = []) {
		var changeset = [];
		outer:
		for (let i = 0; i < data1.length; i++) {
			for (let j = 0; j < data2.length; j++) {
				if (Zotero.Tags.equals(data1[i], data2[j])) {
					continue outer;
				}
			}
			changeset.push({
				field: "tags",
				op: "member-remove",
				value: data1[i]
			});
		}
		outer:
		for (let i = 0; i < data2.length; i++) {
			for (let j = 0; j < data1.length; j++) {
				if (Zotero.Tags.equals(data2[i], data1[j])) {
					continue outer;
				}
			}
			changeset.push({
				field: "tags",
				op: "member-add",
				value: data2[i]
			});
		}
		return changeset;
	},
	
	_relationsDiff: function (data1, data2 = {}) {
		var changeset = [];
		for (let pred in data1) {
			let vals1 = typeof data1[pred] == 'string' ? [data1[pred]] : data1[pred];
			let vals2 = (!data2[pred] || data2[pred] === '')
				? []
				: typeof data2[pred] == 'string' ? [data2[pred]] : data2[pred];
			
			var removed = Zotero.Utilities.arrayDiff(vals1, vals2);
			for (let i = 0; i < removed.length; i++) {
				changeset.push({
					field: "relations",
					op: "property-member-remove",
					value: {
						key: pred,
						value: removed[i]
					}
				});
			}
			let added = Zotero.Utilities.arrayDiff(vals2, vals1);
			for (let i = 0; i < added.length; i++) {
				changeset.push({
					field: "relations",
					op: "property-member-add",
					value: {
						key: pred,
						value: added[i]
					}
				});
			}
		}
		for (let pred in data2) {
			// Property in first object has already been handled
			if (data1[pred]) continue;
			
			let vals = typeof data2[pred] == 'string' ? [data2[pred]] : data2[pred];
			for (let i = 0; i < vals.length; i++) {
				changeset.push({
					field: "relations",
					op: "property-member-add",
					value: {
						key: pred,
						value: vals[i]
					}
				});
			}
		}
		return changeset;
	},
	
	
	/**
	 * Apply a set of changes generated by Zotero.DataObjectUtilities.diff() to an API JSON object
	 *
	 * @param {Object} json - API JSON object to modify
	 * @param {Object[]} changeset - Change instructions, as generated by .diff()
	 */
	applyChanges: function (json, changeset) {
		function _isMulti(field) {
			return (field.slice(0, 6) === 'multi|');
		}
		function _multiDelete(json, c) {
			var myjson = json.multi;
			var stack = [myjson];
			var keylst = c.field.split('|');
			for (var i=1,ilen=keylst.length-1;i<ilen;i++) {
				myjson = myjson[keylst[i]];
				stack.push(myjson);
			}
			var prop = stack.pop();
			var key = keylst.pop();
			delete prop[key];
			while (keylst.length > 2) {
				if (Object.keys(prop).length === 0) {
					prop = stack.pop();
					key = keylst.pop();
					delete prop[key];
				} else {
					break;
				}
			}
		}
		function _multiAdd(json, c) {
			var myjson = json.multi;
			var stack = [myjson];
			var keylst = c.field.split('|');
			for (var i=1,ilen=keylst.length-1;i<ilen;i++) {
				if (!myjson[keylst[i]]) {
					myjson[keylst[i]] = {};
				}
				myjson = myjson[keylst[i]];
				stack.push(myjson);
			}
			var prop = stack.pop();
			var key = keylst.pop();
			prop[key] = c.value;
		}
		function _multiModify(json, c) {
			var myjson = json.multi;
			var keylst = c.field.split('|');
			for (var i=1,ilen=keylst.length-1;i<ilen;i++) {
				myjson = myjson[keylst[i]];
			}
			var key = keylst.pop();
			myjson[key] = c.value;
		}
		for (let i = 0; i < changeset.length; i++) {
			let c = changeset[i];
			if (c.op == 'delete') {
				if (_isMulti(c.field)) {
					_multiDelete(json, c);
				} else {
					delete json[c.field];
				}
			}
			else if (c.op == 'add') {
				if (_isMulti(c.field)) {
					_multiAdd(json, c);
				} else {
					json[c.field] = c.value;
				}
			}
			else if (c.op == 'modify') {
				if (_isMulti(c.field)) {
					_multiModify(json, c);
				} else {
					json[c.field] = c.value;
				}
			}
			else if (c.op == 'member-add') {
				switch (c.field) {
				case 'collections':
					if (json[c.field].indexOf(c.value) == -1) {
						json[c.field].push(c.value);
					}
					break;
				
				case 'creators':
					throw new Error("Unimplemented");
					break;
				
				case 'conditions':
				case 'tags':
					let found = false;
					let f = c.field == 'conditions' ? Zotero.SearchConditions : Zotero.Tags;
					for (let i = 0; i < json[c.field].length; i++) {
						if (f.equals(json[c.field][i], c.value)) {
							found = true;
							break;
						}
					}
					if (!found) {
						json[c.field].push(c.value);
					}
					break;
					
				default:
					throw new Error("Unexpected field '" + c.field + "'");
				}
			}
			else if (c.op == 'member-remove') {
				switch (c.field) {
				case 'collections':
					let pos = json[c.field].indexOf(c.value);
					if (pos == -1) {
						continue;
					}
					json[c.field].splice(pos, 1);
					break;
				
				case 'creators':
					throw new Error("Unimplemented");
					break;
				
				case 'conditions':
				case 'tags':
					let f = c.field == 'conditions' ? Zotero.SearchConditions : Zotero.Tags;
					for (let i = 0; i < json[c.field].length; i++) {
						if (f.equals(json[c.field][i], c.value)) {
							json[c.field].splice(i, 1);
							break;
						}
					}
					break;
					
				default:
					throw new Error("Unexpected field '" + c.field + "'");
				}
			}
			else if (c.op == 'property-member-add') {
				switch (c.field) {
				case 'relations':
					let obj = json[c.field];
					let prop = c.value.key;
					let val = c.value.value;
					if (!obj) {
						obj = json[c.field] = {};
					}
					if (!obj[prop]) {
						obj[prop] = [];
					}
					// Convert string to array
					if (typeof obj[prop] == 'string') {
						obj[prop] = [obj[prop]];
					}
					if (obj[prop].indexOf(val) == -1) {
						obj[prop].push(val);
					}
					break;
					
				default:
					throw new Error("Unexpected field '" + c.field + "'");
				}
			}
			else if (c.op == 'property-member-remove') {
				switch (c.field) {
				case 'relations':
					let obj = json[c.field];
					let prop = c.value.key;
					let val = c.value.value;
					if (!obj || !obj[prop]) {
						continue;
					}
					if (typeof obj[prop] == 'string') {
						// If propetty was the specified string, remove property
						if (obj[prop] === val) {
							delete obj[prop];
						}
						continue;
					}
					let pos = obj[prop].indexOf(val);
					if (pos == -1) {
						continue;
					}
					obj[prop].splice(pos, 1);
					// If no more members in property array, remove property
					if (obj[prop].length == 0) {
						delete obj[prop];
					}
					break;
					
				default:
					throw new Error("Unexpected field '" + c.field + "'");
				}
			}
			else {
				throw new Error("Unexpected change operation '" + c.op + "'");
			}
		}
	},

	decodeMlzContent: function (json) {
		if (!json) return;
		// Add multi properties
		json.multi = {
			main: {},
			_keys: {}
		}
		// Extract extradata
		if (json.extra) {
			var noteMatch = json.extra.match(/mlzsync1:([0-9][0-9][0-9][0-9])(.*)/);
			if (noteMatch) {
				var offset = parseInt(noteMatch[1], 10);
				var extradata = JSON.parse(noteMatch[2].slice(0, offset))
				json.extra = json.extra.slice((offset+13));
				
				if (extradata.xtype) {
					json.itemType = extradata.xtype;
				}
				if (extradata.extrafields) {
					for (var zFieldName in extradata.extrafields) {
						json[zFieldName] = extradata.extrafields[zFieldName];
					}
				}
				if (extradata.multifields) {
					for (zFieldName in extradata.multifields.main) {
						json.multi.main[zFieldName] = extradata.multifields.main[zFieldName];
					}
					for (zFieldName in extradata.multifields._keys) {
						json.multi._keys[zFieldName] = {};
						for (zLang in extradata.multifields._keys[zFieldName]) {
							json.multi._keys[zFieldName][zLang] = extradata.multifields._keys[zFieldName][zLang];
						}
					}
				}
				if (extradata.extracreators) {
					for (var pos in extradata.extracreators) {
						var extraCreator = extradata.extracreators[pos];
						var creator = {
							creatorType: extraCreator.creatorType
						}
						if (extraCreator.name) {
							creator.name = extraCreator.name;
						} else if (extraCreator.fieldMode == "1") {
							creator.name = extraCreator.lastName;
						} else {
							if (extraCreator.lastName) {
								creator.lastName = extraCreator.lastName;
							}
							if (extraCreator.firstName) {
								creator.firstName = extraCreator.firstName;
							}
						}
						json.creators.push(extraCreator);
					}
				}
				for (var pos in json.creators) {
					var creator = json.creators[pos];
					creator.multi = {
						main: false,
						_key: {}
					}
				}
				if (extradata.multicreators) {
					for (var pos in extradata.multicreators) {
						var creator = json.creators[pos];
						var multiObj = extradata.multicreators[pos];
						if (multiObj.main) {
							creator.multi.main = multiObj.main;
						}
						if (multiObj._key) {
							for (var langTag in multiObj._key) {
								var nameObj = multiObj._key[langTag];
								creator.multi._key[langTag] = {};
								if (nameObj.name) {
									creator.multi._key[langTag].name = nameObj.name;
								} else if (creator.name) {
									creator.multi._key[langTag].name = nameObj.lastName;
								} else {
									if (nameObj.firstName) {
										creator.multi._key[langTag].firstName = nameObj.firstName;
									}
									if (nameObj.lastName) {
										creator.multi._key[langTag].lastName = nameObj.lastName;
									}
								}
							}
						}
					}
				}
			}
		}
		return json;
	},
	
	encodeMlzContent: function (json) {
		var extradata = {};
		if (!json.multi) {
			throw "No multi segment on item JSON. What happened?";
		}
		
		// multifields
		if (Object.keys(json.multi.main).length > 0 || Object.keys(json.multi._keys).length > 0) {
			extradata.multifields = json.multi;
		}
		delete json.multi;
		
		// extrafields
		if (Zotero.EXTENDED_FIELDS[json.itemType]) {
			for (var fieldName in json) {
				if (fieldName === "creators") continue;
				if (fieldName === "multi") continue;
				if (Zotero.EXTENDED_FIELDS[json.itemType][fieldName]) {
					if (json[fieldName]) {
						if (!extradata.extrafields) {
							extradata.extrafields = {};
						}
						extradata.extrafields[fieldName] = json[fieldName];
						delete json[fieldName];
					}
				}
			}
		}

		if (json.creators) {
			// extracreators [1]
			// Move extended creators to the end of the line
			if (Zotero.EXTENDED_CREATORS[json.itemType]) {
				var extendedcreators = [];
				for (var i=json.creators.length-1;i > -1; i--) {
					var creator = json.creators[i];
					if (Zotero.EXTENDED_CREATORS[json.itemType][creator.creatorType]) {
						extendedcreators.push(creator);
						json.creators = json.creators.slice(0, i).concat(json.creators.slice(i+1))
					}
				}
				json.creators = json.creators.concat(extendedcreators);
			}
			
			// multicreators
			for (var pos in json.creators) {
				var creator = json.creators[pos];
				if (creator.multi.main || Object.keys(creator.multi._key).length > 0) {
					if (!extradata.multicreators) {
						extradata.multicreators = {};
					}
					extradata.multicreators[pos] = creator.multi;
				}
				delete creator.multi;
			}
			
			// extracreators [2]
			// Move extended creators to extradata property
			if (Zotero.EXTENDED_CREATORS[json.itemType]) {
				if (extendedcreators.length) {
					extradata.extracreators = extendedcreators;
					var creatorsLength = (json.creators.length - extendedcreators.length);
					json.creators = json.creators.slice(0, creatorsLength)
				}
			}
		}

		// xtype
		if (Zotero.EXTENDED_TYPES[json.itemType]) {
			extradata.xtype = itemType;
			json.itemType = Zotero.EXTENDED_TYPES[json.itemType];
		}

		// Bundle it
		if (Object.keys(extradata).length > 0) {
			extradata = JSON.stringify(extradata);
			var extradataLength = ("" + extradata.length);
			while (extradataLength.length < 4) {
				extradataLength = "0" + extradataLength;
			}
			// Check if content exists on extra
			if (json.extra) {
				// Remove any preexisting sync object in extra (should never happen, but hey)
				var m = json.extra.match(/^mlzsync[1-9]:([0-9][0-9][0-9][0-9])/);
				if (m) {
					var totalOffset = parseInt(m[1]) + 13;
					json.extra = json.extra.slice(totalOffset);
				}
			} else {
				json.extra = "";
			}
			// Prepend sync object to extra
			json.extra = 'mlzsync1:' + extradataLength + extradata + json.extra;
			// Done!
		}
	}
};
