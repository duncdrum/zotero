/*
 * Container object for multilingual creator data.
 * Used in both hot Zotero items and translator data carriers.
 */

Zotero.MultiCreator = function(parent, langTag){
	this.parent = parent;
	this.main = langTag;
	this._key = {};
};

Zotero.MultiCreator.prototype.setFields = function (fields, lang) {
	if (!lang || lang === this.main) {
		this.parent.firstName = fields.firstName;
		this.parent.lastName = fields.lastName;
		this.parent.shortName = fields.shortName;
		if ("undefined" !== typeof fields.fieldMode) {
			this.parent.fieldMode = fields.fieldMode;
		}
		if ("undefined" !== typeof fields.birthYear) {
			this.parent.birthYear = fields.birthYear;
		}
	} else {
		if (!this._key[lang]) {
			this._key[lang] = new Zotero.Creator;
			this._key[lang].libraryID = this.parent.libraryID;
		}
		this._key[lang].firstName = Zotero.MultiCreator.tidy(fields.firstName);
		this._key[lang].lastName = Zotero.MultiCreator.tidy(fields.lastName);
		this._key[lang].shortName = Zotero.MultiCreator.tidy(fields.shortName);
		if ("undefined" !== typeof this.parent.fieldMode) {
			this._key[lang].fieldMode = this.parent.fieldMode;
		}
		if ("undefined" !== typeof fields.birthYear) {
			this._key[lang].birthYear = this.parent.birthYear;
		}

		// ??? What about altCreatorsChanged (which does work)

		this._key[lang]._changed = true;
	}
	this.parent._changed = true;
}

Zotero.MultiCreator.prototype.get = function (field, langs) {
	var lang = false;
	if ("object" === typeof langs) {
		for (var i = 0, ilen = langs.length; i < ilen; i += 1) {
			if (this._key[langs[i]]) {
				lang = langs[i];
				break;
			}
		}
	} else {
		lang = langs;
	}

	if (lang 
		&& lang !== this.main 
		&& this._key[lang]
		&& (field === 'firstName' || field === 'lastName' || field === 'shortName')) {
		return this._key[lang][field] ? this._key[lang][field] : '';
	} else {
		return this.parent[field] ? this.parent[field] : '';
	}
};

Zotero.MultiCreator.prototype.getCreator = function (langTag, strictMode) {
	if (langTag === this.main && !strictMode) {
		return this.parent;
	} else {
		return this._key[langTag];
	}
};

Zotero.MultiCreator.prototype.removeCreator = function (langTag) {
	var creator = null;
	if (!langTag) {
		throw "Attempt to remove multi creator without langTag"
	}
	if (this._key[langTag]) {
		var creator = this._key[langTag];
		delete this._key[langTag];
		// Save must be done separately.
	}
	return creator;
}

Zotero.MultiCreator.prototype.mainLang = function () {
	return this.main;
};


Zotero.MultiCreator.prototype.langs = function () {
	if (!this.parent._loaded) {
		this.parent.load();
	}
    var lst = [];
    for (var lang in this._key) {
        lst.push(lang);
    }
	return lst;
};


Zotero.MultiCreator.prototype.data = function () {
    var lst = [];
    for (var langTag in this._key) {
        lst.push({
            languageTag: langTag,
            value: this._key[langtag]
        });
    }
	return lst;
};


Zotero.MultiCreator.prototype.hasLang = function (langTag, multiOnly) {
	if ((!multiOnly && this.main === langTag) || this._key[langTag]) {
		return true;
	}
	return false;
};


Zotero.MultiCreator.prototype.changeLangTag = function (oldTag, newTag) {
	if (this.main === newTag || this._key[newTag]) {
		throw "Attempt to change to existing language tag in creator";
	}
	if (!oldTag || oldTag === this.main) {
		this.main = newTag;
		this.parent._changed = true;
	} else if (this._key[oldTag]) {
		this._key[newTag] = this._key[oldTag];
		delete this._key[oldTag];
		this._key[newTag]._changed = true;
	}
};

Zotero.MultiCreator.prototype.merge = function (item, orderIndex, otherCreator, shy) {
	if (!item._changedAltCreators) {
		item._changedAltCreators = {};
	}
	if (!item._changedAltCreators[orderIndex]) {
		item._changedAltCreators[orderIndex] = {};
	}
	for (var langTag in otherCreator.multi._key) {
		if (otherCreator.multi._key[langTag].fieldMode == this.parent.fieldMode) {
			if (!shy || (shy && !this._key[langTag])) {
				var newCreator = new Zotero.Creator;
				newCreator.libraryID = this.parent.libraryID;
				if (this._key[langTag]) {
					var fields = {};
					fields.lastName = this._key[langTag].lastName;
					fields.firstName = this._key[langTag].firstName;
					fields.birthYear = this._key[langTag].birthYear;
					fields.fieldMode = this._key[langTag].fieldMode;
					newCreator.setFields(fields);
				}
				newCreator.setFields(otherCreator.multi._key[langTag]);
				this._key[langTag] = newCreator;
				item._changedAltCreators[orderIndex][langTag] = true;
				this.parent._changed = true;
			}
		}
	}
};

Zotero.MultiCreator.prototype.clone = function (parent, parentLang, item, orderIndex) {
	var clone = new Zotero.MultiCreator(parent, parentLang);
	if (!item._changedAltCreators) {
		item._changedAltCreators = {};
	}
	if (!item._changedAltCreators[orderIndex]) {
		item._changedAltCreators[orderIndex] = {};
	}
	for (var langTag in this._key) {
		clone._key[langTag] = new Zotero.Creator;
		clone._key[langTag].libraryID = parent.libraryID;
		clone._key[langTag].lastName = this._key[langTag].lastName;
		clone._key[langTag].firstName = this._key[langTag].firstName;
		clone._key[langTag].shortName = this._key[langTag].shortName;
		clone._key[langTag].birthYear = this._key[langTag].birthYear;
		item._changedAltCreators[orderIndex][langTag] = true;
	}
	return clone;
};


Zotero.MultiCreator.prototype.equals = function (fields, languageTag) {
	return (fields.firstName == this._key[languageTag].firstName) &&
		(fields.lastName == this._key[languageTag].lastName) &&
		(fields.shortName == this._key[languageTag].shortName);
}


// Same treatment as provided by the setter method of Zotero.Creator.
Zotero.MultiCreator.tidy = function (val) {
	if (val) {
		val = Zotero.Utilities.trim(val);
	} else {
		val = '';
	}
	return val;
}
