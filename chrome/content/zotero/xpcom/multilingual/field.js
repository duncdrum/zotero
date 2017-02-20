/*
 * Container object for multilingual field data.
 * Used by both hot Zotero items and translator data carriers.
 * Use accessors instead of direct reads or writes to the
 * JS primitives.
 * 
 * multi.set(fieldID, value, [lang])
 *   (value can be nil, but blocks on main entry if alternatives exist)
 *
 * multi.get(fieldID, langs, honorEmpty)
 */

Zotero.MultiField = function(parent){
	this.parent = parent;
	this.main = {};
	this._keys = {};
};

Zotero.MultiField.prototype._set = function (fieldID, value, lang, force_top, justLooking) {
	if (!fieldID) {
		throw "MultiField._set called without specifying fieldID";
	}
	if (lang) {
		// Async function, will eventually register tag if necessary
		Zotero.CachedLanguages.addTag(lang);
	}
	// Add or edit (if field is empty, deletion will be handled
	// in item.save())
	if (!lang || lang === this.main[fieldID] || force_top) {
		// MAIN mode
		if (this.hasLang(lang, fieldID, true)) {
			lang = undefined;
			Zotero.debug("JURISM: Attempt to save existing tag to main: " + lang + ", for field " + fieldID + " and value (" + value + ") on item " + this.parent.key + " with force_top=" + force_top + " and justLooking=" + justLooking);
		}
		if (value === this.parent._itemData[fieldID] && (!lang || lang === this.main[fieldID])) {
			// no action, in either mode
			return false;
		} else {
			// main
			if (justLooking) {
				return "MAIN";
			} else {
				// Set the field value
				this.parent._itemData[fieldID] = value;
				if (lang) {
					// If there is a lang value, set it; never unset the headline field lang
					this.main[fieldID] = lang;
				}
			}
		}
	} else {
		// ALT mode
		if (lang === this.main[fieldID]) {
			throw "Attempt to save main tag value to alt: " + lang;
		}
		if (this._keys[fieldID] && this._keys[fieldID] && this._keys[fieldID][lang] == value) {
			// No action in either mode
			return false;
		} else {
			if (justLooking) {
				return "ALT";
			} else {
				if (!this._keys[fieldID]) {
					this._keys[fieldID] = {};
				}
				this._keys[fieldID][lang] = value;
			}
		}
	}
};

Zotero.MultiField.prototype.get = function (fieldID, langs, forceTop) {
	var val = false, lang;
	var multiOnly = forceTop === false ? true : false;
/*
	if (!this.parent._itemDataLoaded) {
		// Safer path to initialisation, may avoid "itemID not set for object" error.
		if ((this.parent._id || this.parent._key) && !this.parent._primaryDataLoaded) {
			this.parent.loadPrimaryData(true);
		}
		if (this.parent.id) {
			this.parent._loadItemData();
		} else {
			return '';
		}
	}
*/
	fieldID = Zotero.ItemFields.getID(fieldID);
	if ("object" === typeof langs) {
		for (var i = 0, ilen = langs.length; i < ilen; i += 1) {
			if (this._keys[fieldID] && this._keys[fieldID][langs[i]]) {
				lang = langs[i];
				break;
			}
		}
	} else {
		lang = langs;
	}

	if (!multiOnly && (!lang || lang === this.main[fieldID])) {
		val = this.parent._itemData[fieldID];
	} else {
		if (lang && this._keys[fieldID] && this._keys[fieldID][lang]) {
			val = this._keys[fieldID][lang];
		} else if (!multiOnly) {
			val = this.parent._itemData[fieldID];
		}
	}
	return val ? val : '';
};

Zotero.MultiField.prototype.mainLang = function (fieldID) {
	if (!fieldID) {
		throw "MultiField.mainLang() called without fieldID"
	}
	fieldID = Zotero.ItemFields.getID(fieldID);
	if (this.main[fieldID]) {
		return this.main[fieldID];
	}
	return false;
};

Zotero.MultiField.prototype.langs = function (fieldID) {
	if (!fieldID) {
		throw "MultiField.langs() called without fieldID"
	}
	fieldID = Zotero.ItemFields.getID(fieldID);
	if (this._keys[fieldID]) {
		return Object.keys(this._keys[fieldID]);
	}
	return [];
};


Zotero.MultiField.prototype.hasLang = function (langTag, field, multiOnly) {
	var fieldID = Zotero.ItemFields.getID(field);
	if (!multiOnly && this.main[fieldID] === langTag) {
		return true;
	} else if (this._keys[fieldID] && this._keys[fieldID][langTag]) {
		return true;
	}
	return false;
};

Zotero.MultiField.prototype.setAltChange = function(fieldID, langTag) {
	if (!this.parent._changed.itemData) {
		this.parent._changed.itemData = {}
	}
	if (!this.parent._changed.itemData[fieldID]) {
		var changes = this.parent._changed.itemData[fieldID] = {
			field: false,
			mainLang: false,
			multiFields: {}
		}
	}
	this.parent._changed.itemData[fieldID].multiFields[langTag] = true;
}

Zotero.MultiField.prototype.setLangChange = function(fieldID, oldLang, newLang, forceTop) {
	// XXX Field changes are handled in item.js. Here, we deal
	// XXX   only with changes to language tags.
	// XXX This is meant to be executed after the field data is in its
	// XXX   new location.
	if (!this.parent._changed.itemData) {
		this.parent._changed.itemData = {}
	}
	if (!this.parent._changed.itemData[fieldID]) {
		var changes = this.parent._changed.itemData[fieldID] = {
			field: false,
			mainLang: false,
			multiFields: {}
		}
	}
	// Action only if language tags have changed somehow
	// Annulling language tags is not allowed
	if (newLang && oldLang !== newLang) {
		// Async function, will eventually register tag if necessary
		Zotero.CachedLanguages.addTag(newLang);
		if (oldLang) {
			if (oldLang === this.main[fieldID]) {
				// main to multi
				changes.mainLang = true;
				changes.field = true;
				changes.multiFields[oldLang] = true;
				changes.multiFields[newLang] = true;
			} else if (newLang === this.main[fieldID]) {
				// multi to main
				changes.mainLang = true;
				changes.field = true;
				changes.multiFields[oldLang] = true;
				changes.multiFields[newLang] = true;
			} else {
				// multi to multi
				changes.multiFields[oldLang] = true;
				changes.multiFields[newLang] = true;
			}
		} else {
			// add a single field or modify main
			if (forceTop) {
				changes.mainLang = true;
			} else {
				changes.multiFields[newLang] = true;
			}
		}
	}
}

Zotero.MultiField.prototype.changeLangTag = function (oldTag, newTag, field) {
	var fieldID = Zotero.ItemFields.getID(field);

	// Three possibilities here.
	// (1) oldTag is null, newTag has value
	// (2) oldTag is main, newTag value does not exist
	// (3) oldTag is main, newTag value exists
	// (4) oldTag is alt
	if (newTag) {
		// Async function, will eventually register tag if necessary
		Zotero.CachedLanguages.addTag(newTag);
	}
	if (!oldTag) {
		// (1) add tag to main, protecting against clash
		if (this._keys[fieldID] && this._keys[fieldID][newTag]) {
			throw "Attempt to change main to existing variant language tag (field.js)";
		}
		this.main[fieldID] = newTag;
		this.setLangChange(fieldID, oldTag, newTag, true);
	} else if (oldTag === this.main[fieldID]) {
		// Definitely doing this, at the very least
		// (2) set main field tag
		this.main[fieldID] = newTag;
		if (this._keys[fieldID] && this._keys[fieldID][newTag]) {
			// (3) swap main and alt fields and tags
			var oldMainValue = this.parent._itemData[fieldID];
			this.parent._itemData[fieldID] = this._keys[fieldID][newTag];
			this._keys[fieldID][newTag] = '';
			this._keys[fieldID][oldTag] = oldMainValue;
		}
		this.setLangChange(fieldID, oldTag, newTag);
	} else {
		// (4) set tag on alt, protecting against clash
		if (this._keys[fieldID] && this._keys[fieldID][newTag]) {
			throw "Attempt to change to existing alt language tag in alt (field.js)";
		}
		this._keys[fieldID][newTag] = this._keys[fieldID][oldTag];
		this._keys[fieldID][oldTag] = '';
		this.setLangChange(fieldID, oldTag, newTag);
	}
};

Zotero.MultiField.prototype.merge = function (otherItem, shy) {
	for (var fieldID in otherItem.multi._keys) {
		if (!this.parent._itemData[fieldID]) {
			continue;
		}
		if (!this._keys[fieldID]) {
			this._keys[fieldID] = {};
		}
		for (var langTag in otherItem.multi._keys[fieldID]) {
			if (!shy || (shy && !this._keys[fieldID][langTag])) {
				if (this._keys[fieldID][langTag] != otherItem.multi._keys[fieldID][langTag]) {
					this._keys[fieldID][langTag] = otherItem.multi._keys[fieldID][langTag];
					this.setAltChange(fieldID, langTag);
					//this.parent._changed = true;
				}
			}
		}
	}
}

Zotero.MultiField.prototype.data = function (fieldID) {
	if (!fieldID) {
		throw "MultiField.data() called without fieldID"
	}
	var fieldID = Zotero.ItemFields.getID(fieldID);
	if (this._keys[fieldID]) {
        var me = this;
		return Object.keys(me._keys[fieldID])
			.map(function(langTag) {
				return {
					languageTag: langTag,
					value: me._keys[fieldID][langTag]
				}
			})
	} else {
		return [];
	}
};


Zotero.MultiField.prototype.clone = function (parent) {
	var clone = new Zotero.MultiField(parent);
	for (var fieldID in this._keys) {
		clone._keys[fieldID] = {};
		for (var langTag in this._keys[fieldID]) {
			clone._keys[fieldID][langTag] = this._keys[fieldID][langTag];
			clone.setAltChange(fieldID, langTag);
		}
	}
	return clone;
};
