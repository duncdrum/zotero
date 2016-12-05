// Some changes needed to move to a new, purely
// tables-based data model suitable for syncing.
//
// - Add three tables
//   o creatorsMulti (reference table)
//   o fieldsMulti (reference table)
//   o languageTagData (data table)
//
// - Treat languageTagData as a pool of pre-validated
//   tags in Zotero.ZlsValidator() (i.e. return
//   ASAP with proper values in the validator
//   if the tag is known (not required, but might
//   save a few cycles).
//
// - Provide a method for purging unused language
//   tags, and invoke it where unused creators
//   are purged, which should be safe.
//
// - Provide utility methods for retrieval and
//   storage, as needed to support the UI.
// 
// - Set up a mapping layer for 639-2 tags not
//   known to IANA Language Subtag Registry.

Zotero.subtagRegistry = new function () {
	if ("undefined" === typeof _cache) {
		var _cache = {};
	}
	
	this.makeTag = function(tagdata) {
		return tagdata.map(function(elem, i, obj){
			return elem.subtag;
		}).join('-');
	}

	this.validate = Zotero.Promise.coroutine(function* (tag) {
		//Zotero.debug("zls: Zotero.ZlsValidator.validate: "+tag, 3);
		var data = {
			tag: tag,
			tagdata: false,
			remnant: []
		}
		if (_cache[tag.toLowerCase()]) {
			data.tagdata = _cache[tag.toLowerCase()].slice();
			//Zotero.debug("zls: Tagdata from cache:"+data.tagdata, 3);
			return data.tagdata;
		}
		
		try {
			yield getPrimary(data)
			yield getScript(data)
			yield getRegion(data)

			// Need to use a loop here, but it must
			// always terminate, even if unmatched
			// items remain. Loop within getVariant()
			// itself seems safest.

			yield getVariant(data);

			_cache[tag.toLowerCase()] = data.tagdata.slice();
			return _cache[tag.toLowerCase()];
		} catch (e) {
			Zotero.debug("zls: Language tag validation failed: "+e);
			return false;
		}
	});
	
	var getPrimary = Zotero.Promise.coroutine(function* (data) {

		var primary_subtag = false, invalid = false;
		var grandpaws = [
			"en-GB-oed","i-ami","i-bnn","i-default","i-enochian","i-hak",
			"i-klingon","i-lux","i-mingo","i-navajo","i-pwn","i-tao","i-tay",
			"i-tsu","sgn-BE-FR","sgn-BE-NL","sgn-CH-DE","art-lojban",
			"cel-gaulish","no-bok","no-nyn","zh-guoyu","zh-hakka","zh-min",
			"zh-min-nan","zh-xiang"
		];
		for (var i = 0, ilen = grandpaws.length; i < ilen; i += 1) {
			if (data.tag.slice(0,grandpaws[i].length).toLowerCase()===grandpaws[i].toLowerCase()) {
				primary_subtag = grandpaws[i];
				var frag = data.tag.slice(grandpaws[i].length);
				if (frag.length === 0) {
					data.remnant = [];
				} else if (frag.slice(0,1) === "-") {
					data.remnant = frag.slice(1).split("-");
				} else {
					throw "Invalid primary language tag (corrupt grandfathered stub)";
				}
				data.tagdata = [
					{
						type:'primary',
						subtag:grandpaws[i].toLowerCase(),
						description: 'Legacy tag grandfathered into BCP47'
					}
				];
				break;
			}
		}
		if (!primary_subtag) {
			data.remnant = data.tag.split("-");
			if (data.remnant.length && data.remnant[0]) {
				data.remnant[0] = data.remnant[0].toLowerCase();
				// Fix up ISO 639-2 codes that may not appear in
				// the IANA Subtag Registry.  Fault reported by
				// Avram Lyon in connection with MARC translators.
				//
				// Need to continue processing for script tags
				// pointed out by Florian Ziche.
				var sql = 'SELECT iana FROM isoTagMap WHERE iso=?';
				var res = yield Zotero.DB.valueQueryAsync(sql, [data.remnant[0]]);
				if (res) {
					data.remnant[0] = res;
				}
				var testlen = data.remnant[0].length;
			}
			yield testPrimary(data, 2);
			while (yield testPrimary(data,3)) {
				// ZZZ Nothing to see here
			};
		};
		if (!data.tagdata) {
			throw "Invalid primary language tag (no conformant tag found in first position)";
		};
	});

	/*
	 * Take a number representing a required tag length (2 or 3, by the
	 * current standard) as argument.
	 * 
	 * Return true if a valid tag is found 
	 */
	var testPrimary = Zotero.Promise.coroutine(function* (data, len) {
		var primary_subtag;
		if (!data.remnant.length) {
			return false;
		}
		primary_subtag = data.remnant[0];
		if (primary_subtag.match(/^[0-9]{3}$/)) {
			return false;
		}
		if (primary_subtag.length === len) {
			yield checkPrimarySql(data, primary_subtag);
			if (data.tagdata) {
				data.remnant = data.remnant.slice(1);
				return true;
			} else {
				return false;
			}
		} else {
			return false;
		}
	});

	/*
	 * Take a string representing a subtag as argument.
	 * 
	 * Set the subtag object as the first-position value in
	 * self.tagdata if found.  Otherwise, set self.tagdata
	 * to false.
	 */
	var checkPrimarySql = Zotero.Promise.coroutine(function* (data, primary) {
		var sql = 'SELECT TA.value AS subtag, D.value AS description FROM zlsSubtags S '
			+ 'LEFT JOIN zlsSubTagData TA ON S.subtag=TA.id '
			+ 'LEFT JOIN zlsSubtagData TY ON S.type=TY.id '
			+ 'LEFT JOIN zlsSubtagData D ON S.description=D.id '
			+ 'LEFT JOIN zlsSubtagData SC ON S.scope=SC.id '
			+ 'WHERE TA.value=? '
			+ 'AND TY.value=? '
			+ 'AND ('
			+ 'S.scope IS NULL '
			+ 'OR NOT SC.value=?'
			+ ')';
		var res = yield Zotero.DB.rowQueryAsync(sql, [primary,'language','collection']);
		if (res) {
			data.tagdata = [{type:'primary',subtag:res.subtag,description:res.description}];
		} else {
			data.tagdata = false;
		}
	});

	var getScript = Zotero.Promise.coroutine(function* (data) {
		if (!data.remnant.length) {
			return;
		}
		data.remnant[0] = data.remnant[0][0].toUpperCase() + data.remnant[0].slice(1).toLowerCase();
		var sql = 'SELECT TA.value AS subtag, D.value AS description FROM zlsSubtags S '
			+ 'LEFT JOIN zlsSubTagData TA ON S.subtag=TA.id '
			+ 'LEFT JOIN zlsSubTagData TY ON S.type=TY.id '
			+ 'LEFT JOIN zlsSubTagData D ON S.description=D.id '
			+ 'WHERE TY.value=? AND TA.value=?';
		var res = yield Zotero.DB.rowQueryAsync(sql,['script', data.remnant[0]]);
		if (res) {
			data.tagdata.push({type:'script',subtag:res.subtag,description:res.description});
			data.remnant = data.remnant.slice(1);
		};
	});


	var getRegion = Zotero.Promise.coroutine(function* (data) {
		if (!data.remnant.length) {
			return;
		}
		data.remnant[0] = data.remnant[0].toUpperCase();
		var sql = 'SELECT TA.value AS subtag, D.value AS description FROM zlsSubtags S '
			+ 'LEFT JOIN zlsSubTagData TA ON S.subtag=TA.id '
			+ 'LEFT JOIN zlsSubTagData TY ON S.type=TY.id '
			+ 'LEFT JOIN zlsSubTagData D ON S.description=D.id '
			+ 'WHERE TY.value=? AND TA.value=?';
		var res = yield Zotero.DB.rowQueryAsync(sql,['region', data.remnant[0]]);
		if (res) {
			//res.type = 'region';
			data.tagdata.push({type:'region',subtag:res.subtag,description:res.description});
			data.remnant = data.remnant.slice(1);
		}
	});


	var getVariant = Zotero.Promise.coroutine(function* (data) {
		if (!data.remnant.length) {
			return;
		}
		// This will cause a small amount of thrashing when invalid
		// tags interfere with further processing. The overhead is
		// probably acceptable, though.
		for (var i = 0, ilen = data.remnant.length; i < ilen; i += 1) {
			yield _getVariant(data);
		}
	});
	
	var _getVariant = Zotero.Promise.coroutine(function* (data) {
		var myprefix = [];
		for (var i = 0, ilen = data.tagdata.length; i < ilen; i += 1) {
			if (data.tagdata[i].type === 'variant') {
				if (data.tagdata[i].subtag.toLowerCase() === data.remnant[0].toLowerCase()) {
					throw "Repeat use of variant subtag";
				}
			}
			// If relaxing of prefix restraint works out well, we won't
			// need to do this.
			if (data.tagdata[i].type !== 'region') {
				myprefix.push(data.tagdata[i].subtag);
			}
		}
		myprefix = myprefix.join("-");
		data.remnant[0] = data.remnant[0].toLowerCase();
		var sql = 'SELECT TA.value AS subtag, D.value AS description FROM zlsSubtags S '
			+ 'LEFT JOIN zlsSubTagData TA ON S.subtag=TA.id '
			+ 'LEFT JOIN zlsSubTagData TY ON S.type=TY.id '
			+ 'LEFT JOIN zlsSubTagData PR ON S.prefix=PR.id '
			+ 'LEFT JOIN zlsSubTagData D ON S.description=D.id '
			+ 'WHERE TY.value=? AND TA.value=?';
		// Releasing prefix restraint to align this with UI menus
		// + 'WHERE TY.value=? AND TA.value=? AND (S.prefix IS NULL OR PR.value=?)';
		var res = yield Zotero.DB.rowQueryAsync(sql,['variant',data.remnant[0]]);
		if (res) {
			data.tagdata.push({type:'variant',subtag:res.subtag,description:res.description});
			data.remnant = data.remnant.slice(1);
		};
	});
}
