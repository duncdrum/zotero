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
 * Small cache for jurisdiction and court names in use.
 */

Zotero.CachedJurisdictionData = new function() {
	var _jurisdictionIdToName = {};
	var _jurisdictionNameToId = {};
	var _courtIdToName = {};
	var _courtNameToId = {};
	var jurisdictionFieldID = null;
	var courtFieldID = null;

	this.jurisdictionNameFromId = jurisdictionNameFromId;
	this.jurisdictionIdFromName = jurisdictionIdFromName;
	this.courtNameFromId = courtNameFromId;
	this.courtIdFromName = courtIdFromName;
	this.remapCourtName = remapCourtName;
	
	this.init = function() {
		// Get jurisdiction and court fieldIDs
		jurisdictionFieldID = Zotero.ItemFields.getID('jurisdiction');
		courtFieldID = Zotero.ItemFields.getID('court');
	}

	this.load = Zotero.Promise.coroutine(function* (item) {
		let rawJID = item._itemData[jurisdictionFieldID];
		if (rawJID) {
			let offset = parseInt(rawJID.slice(0,3), 10);
			if (offset) {
				let JID = rawJID.slice(3, (offset + 3));
				yield this.setJurisdiction(JID);
				let courtID = item._itemData[courtFieldID];
				if (_jurisdictionIdToName[JID] && courtID) {
					yield this.setCourt(JID, courtID);
				}
			}
		}
	});
	
	this.setJurisdiction = Zotero.Promise.coroutine(function* (idOrName) {
		let sql = "SELECT jurisdictionName FROM jurisdictions WHERE jurisdictionID=?";
		let name = yield Zotero.DB.valueQueryAsync(sql, [
			idOrName
		]);
		if (name) {
			var shortName = name;
			if (name.split("|").length > 2) {
				shortName = name.slice(name.indexOf("|") + 1);
			}
			_jurisdictionIdToName[idOrName] = {
				name: name,
				shortName: shortName
			};
			_jurisdictionNameToId[shortName] = idOrName;
		}
	});

	function jurisdictionNameFromId (id, longForm) {
		if (_jurisdictionIdToName[id]) {
			if (longForm) {
				return _jurisdictionIdToName[id].name;
			} else {
				return _jurisdictionIdToName[id].shortName;
			}
		} else {
			return id;
		}
	};

	function jurisdictionIdFromName (name) {
		if (_jurisdictionNameToId[name]) {
			return _jurisdictionNameToId[name];
		} else {
			return name;
		}
	};

	this.setCourt = Zotero.Promise.coroutine(function* (jurisdictionID, courtIdOrName) {
		let sql = "SELECT courtName FROM jurisdictions JU "
			+ "JOIN courtJurisdictionLinks CJL USING(jurisdictionIdx) "
			+ "JOIN courts USING(courtIdx) "
			+ "JOIN countryCourtLinks CCL USING(countryCourtLinkIdx) "
			+ "JOIN courtNames CN USING(courtNameIdx) "
			+ "JOIN jurisdictions CO ON CO.jurisdictionIdx=CCL.countryIdx "
			+ "WHERE courtID=? AND JU.jurisdictionID=? AND CO.jurisdictionID=?"
		var countryID = jurisdictionID.split(':')[0];
		let name = yield Zotero.DB.valueQueryAsync(sql, [
			courtIdOrName,
			jurisdictionID,
			countryID
		]);
		if (name) {
			if (!_courtIdToName[jurisdictionID]) {
				_courtIdToName[jurisdictionID] = {};
			}
			_courtIdToName[jurisdictionID][courtIdOrName] = name;
			
			if (!_courtNameToId[jurisdictionID]) {
				_courtNameToId[jurisdictionID] = {};
			}
			_courtNameToId[jurisdictionID][name] = courtIdOrName;
		}
	});

	function courtNameFromId(JID, id) {
		if (_courtIdToName[JID] && _courtIdToName[JID][id]) {
			return _courtIdToName[JID][id];
		}
		return false;
	}

	function courtIdFromName(JID, name, strict) {
		if (_courtNameToId[JID] && _courtNameToId[JID][name]) {
			return _courtNameToId[JID][name];
		}
		else if (!strict) {
			return name;
		}
	}

	function remapCourtName(oldJurisdictionID,newJurisdictionID,courtIdOrName) {
		if (!courtIdOrName) {
			return "";
		}
		// Do we have an ID or a name
		var isId = false;
		if (courtIdOrName.match(/^[.a-z0-9]$/)) {
			isId = true;
		}
		var newValue = courtIdOrName;
		if (isId) {
			// Try for a name in the new jurisdiction
			var courtName = _courtIdToName[newJurisdictionID] ? _courtIdToName[newJurisdictionID][courtIdOrName] : "";
			if (!courtName) {
				// No luck, so try in the old jurisdiction, falling back to the bare ID
				newValue = _courtIdToName[oldJurisdictionID] ? _courtIdToName[oldJurisdictionID][courtIdOrName] : "";
				if (!newValue) {
					newValue = courtIdOrName;
				}
			}
			// If found in the new jurisdiction, reuse the ID
		} else {
			// Try to map to an ID in the new jurisdiction, falling back to the name
			newValue = _courtIdToName[newJurisdictionID] ? _courtIdToName[newJurisdictionID][courtIdOrName] : "";
			if (!newValue) {
				newValue = courtIdOrName;
			}
		}
		return newValue;
	}

}
