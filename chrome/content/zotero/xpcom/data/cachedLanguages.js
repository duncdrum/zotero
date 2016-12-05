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


/*
 * Small cache for language preferences.
 * Run init() method on this object after update to DB.
 */

/*

    (1) an object with all languages and their nicknames
    (2) an object with all default preferences
    (3) a bunch of async (?) helper functions
    (4) a few sync helper functions

*/

Zotero.CachedLanguages = new function() {
	var _languages = {};
	var _nicknames = {};
	var _prefs = {
		zoteroSort: {},
 		zoteroDisplay: {},
 		citationTransliteration: {},
 		citationTranslation: {},
 		citationSort: {}
	};

    this.langPrefIsSet = langPrefIsSet;
    this.nicknameExists = nicknameExists;
    this.getDisplayLang = getDisplayLang;
    this.hasTag = hasTag;
    this.getLangPrefsForParam = getLangPrefsForParam;
    this.getAllLangPrefs = getAllLangPrefs;
    this.getLangTags = getLangTags;
    this.hasTagDependents = hasTagDependents;
    this.getAllLangTagData = getAllLangTagData;

	this.init = Zotero.Promise.coroutine(function* () {
		_languages = {};
		_nicknames = {};
		_prefs = {
			zoteroSort: {},
 			zoteroDisplay: {},
 			citationTransliteration: {},
 			citationTranslation: {},
 			citationSort: {}
		};

        // Get all the langTag and prefs data into memory.
		var sql = 'SELECT tag,nickname FROM zlsTags';
		var tags = yield Zotero.DB.queryAsync(sql);
		for (var i = 0, ilen = tags.length; i < ilen; i += 1) {
            var tag = tags[i].tag;
			var nickname = tags[i].nickname;
            var tagdata = yield Zotero.subtagRegistry.validate(tag);
			_languages[tag] = {
                nickname: nickname,
                tagdata: tagdata,
				tag: Zotero.subtagRegistry.makeTag(tagdata)
            };
			_nicknames[nickname] = tag;
		}
        for (var prefName in _prefs) {
		    var sql = "SELECT tag FROM zlsPreferences WHERE profile=? AND param=?";
            var langTags = yield Zotero.DB.columnQueryAsync(sql,['default', prefName]);
            for (var i = 0, ilen = langTags.length; i < ilen; i++) {
                var langTag = langTags[i];
                _prefs[prefName][langTag] = true; 
            }
        }
	});

	this.usesTag = function(tag) {
		for (var key in _prefs) {
			if (_prefs[key][tag]) {
				return true;
			}
		}
		return false;
	};
	
    this.changePref = Zotero.Promise.coroutine(function* (profile, param, langTag, checked) {
 	    if (checked) {
 		    var sql = 'INSERT INTO zlsPreferences VALUES (?,?,?)';
 		    yield Zotero.DB.queryAsync(sql,[profile,param,langTag]);
            _prefs[param][langTag] = true;
 	    } else {
 		    var sql = 'DELETE FROM zlsPreferences WHERE profile=? AND param=? and tag=?';
 		    yield Zotero.DB.queryAsync(sql,[profile,param,langTag]);
            delete _prefs[param][langTag];
 	    }
        return true;
    });
    
    this.addTag = Zotero.Promise.coroutine(function* (tag, nickname) {
		// Return cache value of tag directly if available
		if (_languages[tag]) return _languages[tag];
		
		// Check validity of the tag, get its valid elements
		var tagdata = yield Zotero.subtagRegistry.validate(tag);
		
		// Abort if there's nothing to be done
		if (!tagdata) return false;

		// Get normalized form of tag, excluding invalid elements
		tag = Zotero.subtagRegistry.makeTag(tagdata);

		// Return cache value of normalized tag if available
		if (_languages[tag]) return _languages[tag];
		
		// If no nickname given, use raw tag value
		if (!nickname || (_nicknames[nickname] && _nicknames[nickname].tag !== tag)) {
			nickname = tag;
		}
		
		// Register tag
        if (tagdata.length > 1) {
			var parentTag = Zotero.subtagRegistry.makeTag(tagdata.slice(0, -1));
 	        var params = [tag, nickname, parentTag];
 	        var sql = "INSERT INTO zlsTags VALUES (?,?,?)";
        } else {
 	        var params = [tag, nickname];
 	        var sql = "INSERT INTO zlsTags VALUES (?,?,NULL)";
        }
 	    yield Zotero.DB.queryAsync(sql, params);
		
		// Set cache value and return
        _languages[tag] = {
            nickname: nickname,
            tagdata: tagdata,
			tag: Zotero.subtagRegistry.makeTag(tagdata)
        }
        _nicknames[nickname] = _languages[tag];
		return _languages[tag];
    });

    this.deleteTag = Zotero.Promise.coroutine(function* (tag) {
		if (!_languages[tag]) return;
 		var sql = "SELECT COUNT(*) FROM zlsPreferences WHERE tag=?";
 		var hasDependents = yield Zotero.DB.valueQueryAsync(sql, [tag]);
 		delete _nicknames[_languages[tag].nickname];
        delete _languages[tag];
		if (!hasDependents) {
 		    var sql = "DELETE FROM zlsTags WHERE tag=?";
 		    yield Zotero.DB.queryAsync(sql,[tag]);
 	    }
	});

    this.nicknameReset = Zotero.Promise.coroutine(function* (oldNickname, newNickname) {
        var data = _nicknames[oldNickname];
		if (!data) return false;
		tag = data.tag;
        if (!newNickname) {
            newNickname = oldNickname;
        } else if (_nicknames[newNickname]) {
			return false;
		}
        var sql = 'UPDATE zlsTags SET nickname=? WHERE nickname=?';
 	    yield Zotero.DB.queryAsync(sql,[newNickname,oldNickname]);
        delete _nicknames[oldNickname];
        _nicknames[newNickname] = tag;
        _languages[tag].nickname = newNickname;
        return newNickname;
    });

	this.getLanguageList = function(item, fieldNameOrIndex, isMulti) {
		return _languageList(item, fieldNameOrIndex, null, true, isMulti);
	};
    
    this.getVariantList = function(item, fieldNameOrIndex, tag) {
		return _languageList(item, fieldNameOrIndex, tag);
	};

    function hasTagDependents(tag) {
        for (var key in _languages) {
            var keyStart = key.slice(0, tag.length);
            var nextChar = key.slice(tag.length, tag.length+1);
            if (keyStart === tag && (nextChar === '-')) {
                return true;
            }
        }
        return false;
    }

    function langPrefIsSet(profile,param,langTag) {
        return !!_prefs[param][langTag];
    }

    function nicknameExists(nickname) {
        return !!_nicknames[nickname];
    }
    
    function getDisplayLang() {
        var langTags = Object.keys(_prefs.zoteroDisplay);
        if (langTags.length) {
            return langTags[0];
        }
        return false;
    }
    
	function hasTag(langTag) {
        return !!_languages[langTag];
	}

    function getLangPrefsForParam(param, asArray) {
		var ret;
		if (!_prefs[param]) {
			throw "Attempt to set invalid language param \"" + param + "\"";
		}
		if (asArray) {
			ret = Object.keys(_prefs[param]);
		} else {
			ret = _params[param];
		}
        return ret;
    };
	
	function getAllLangTagData() {
		return Object.keys(_languages).map(function(key){
			return _languages[key];
		});
	}

	function getAllLangPrefs(asArray) {
		var obj = {};
		for (var param in _prefs) {
			obj[param] = getLangPrefsForParam(param, asArray);
		}
		return obj;
	}

    function getLangTags() {
        var ret = [];
        var langs = Object.keys(_languages);
        langs.sort();
        for (var i = 0, ilen = langs.length; i < ilen; i++) {
            var item = {
                nickname: _languages[langs[i]].nickname,
                tagdata: _languages[langs[i]].tagdata,
                tag: langs[i]
            }
            ret.push(item);
        }
        return ret;
    };

	this.getNickname = function(tag) {
		if (_languages[tag]) {
			return _languages[tag].nickname;
		} else {
			return tag;
		}
	};

	function _languageList (item, fieldNameOrIndex, variantsOnly, languagesOnly, multiField) {
		var item, isItem, fieldName, creator;
		if ('number' === typeof fieldNameOrIndex) {
			creator = item.getCreator(fieldNameOrIndex);
			isItem = false;
		} else {
			fieldName = fieldNameOrIndex;
			isItem = true;
		}
		var mainLang = null;
		if (item) {
			if (isItem) {
				if (fieldName) {
					mainLang = item.multi.mainLang(fieldName);
				}
			} else if (creator) {
				fieldName = true;
				mainLang = creator.multi.main;
			}
			var checkLanguages = {};
			for (var fieldID in item.multi._keys) {
				for (var langTag in item.multi._keys[fieldID]) {
					checkLanguages[langTag] = true;
				}
				if (item.multi.main[fieldID]) {
					checkLanguages[item.multi.main[fieldID]] = true;
				}
			}
			for (var tag in checkLanguages) {
				if (!_languages[tag]) {
                    validateTagAndAdd(tag);
				}
			}
		}
		var mainLangRex;
		if (mainLang) {
			mainLangStub = mainLang.replace(/^([a-z]+)-.*/, "$1");
			mainLangRex = new RegExp("^(" + mainLangStub + "(-.+)*|[a-z]{2,3}(?:-[A-Z]{2})*)$")
		} else {
			mainLangRex = new RegExp("^([a-z]{2,3}(?:-[A-Z]{2})*)$")
		}
		var result = [];
		var itemMultiLangs;
		// Ugh.
		if (item) {
			if (isItem && fieldName) {
				itemMultiLangs = item.multi.langs(fieldName);
			} else if (!isItem && creator) {
				itemMultiLangs = Object.keys(creator.multi._key);
			} else {
				itemMultiLangs = [];
			}
		} else {
			itemMultiLangs = [];
		}
		for (var tag in _languages) {
		
			// Check tags on the item for this field.

			if (item && !mainLang && languagesOnly) {
				// For languagesOnly (i.e. main language selections), skip
				// tags that already exist on the item for this field,
				// IFF the main language is not yet set.
				if (itemMultiLangs.indexOf(tag) > -1) {
					continue;
				}
			}

			if (languagesOnly && !tag.match(/^[a-z]{2,3}(?:-[A-Z]{2})*$/)) {
				continue;
			}

			if (languagesOnly && multiField && (mainLang === tag || itemMultiLangs.indexOf(tag) > -1)) {
				continue;
			}

			if (variantsOnly && (mainLang === tag || !mainLangRex.exec(tag) || itemMultiLangs.indexOf(tag) > -1)) {
				continue;
			}
			result.push({tag:tag, nickname:_languages[tag].nickname})
		}
		if (item) {
			// If we have no main language, and we are returning for baseTag
			// (i.e. language variants), return only if there are two or more
			// items in the menu, to (try to) leave some room for maneuver.
			if (variantsOnly && !mainLang && result.length < 2) {
				result = [];
			}
		}
		result.sort(function(a,b){
			return a.nickname.localeCompare(b.nickname);
		});
		return result;
	};
}
