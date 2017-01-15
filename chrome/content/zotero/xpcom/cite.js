"use strict";

/**
 * Utility functions for dealing with citations
 * @namespace
 */
Zotero.Cite = {
	/**
	 * Locator labels
	 */
	"labels":["page", "book", "chapter", "column", "figure", "folio",
		"issue", "line", "note", "opus", "paragraph", "part", "section", "sub verbo",
		"volume", "verse"],
	
	/**
	 * Remove specified item IDs in-place from a citeproc-js bibliography object returned
	 * by makeBibliography()
	 * @param {bib} citeproc-js bibliography object
	 * @param {Array} itemsToRemove Array of items to remove
	 */
	"removeFromBibliography":function(bib, itemsToRemove) {
		var removeItems = [];
		for(let i in bib[0].entry_ids) {
			for(let j in bib[0].entry_ids[i]) {
				if(itemsToRemove[bib[0].entry_ids[i][j]]) {
					removeItems.push(i);
					break;
				}
			}
		}
		for(let i=removeItems.length-1; i>=0; i--) {
			bib[0].entry_ids.splice(removeItems[i], 1);
			bib[1].splice(removeItems[i], 1);
		}
	},

	/**
	 * Convert formatting data from citeproc-js bibliography object into explicit format
	 * parameters for RTF or word processors
	 * @param {bib} citeproc-js bibliography object
	 * @return {Object} Bibliography style parameters.
	 */
	"getBibliographyFormatParameters":function getBibliographyFormatParameters(bib) {
		var bibStyle = {"tabStops":[], "indent":0, "firstLineIndent":0,
						"lineSpacing":(240*bib[0].linespacing),
						"entrySpacing":(240*bib[0].entryspacing)};
		if(bib[0].hangingindent) {
			bibStyle.indent = 720;				// 720 twips = 0.5 in
			bibStyle.firstLineIndent = -720;	// -720 twips = -0.5 in
		} else if(bib[0]["second-field-align"]) {
			// this is a really sticky issue. the below works for first fields that look like "[1]"
			// and "1." otherwise, i have no idea. luckily, this will be good enough 99% of the time.
			var alignAt = 24+bib[0].maxoffset*120;
			bibStyle.firstLineIndent = -alignAt;
			if(bib[0]["second-field-align"] == "margin") {
				bibStyle.tabStops = [0];
			} else {
				bibStyle.indent = alignAt;
				bibStyle.tabStops = [alignAt];
			}
		}
		
		return bibStyle;
	},

	/**
	 * Makes a formatted bibliography, if the style defines one; otherwise makes a 
	 * formatted list of items
	 * @param {Zotero.Style} style The style to use
	 * @param {Zotero.Item[]} items An array of items
	 * @param {String} format The format of the output (html, text, or rtf)
	 * @return {String} Bibliography or item list in specified format
	 */
	"makeFormattedBibliographyOrCitationList":function(cslEngine, items, format, asCitationList) {
		cslEngine.setOutputFormat(format);
		cslEngine.updateItems(items.map(item => item.id));
		 		
		if(!asCitationList) {
			var bibliography = Zotero.Cite.makeFormattedBibliography(cslEngine, format);
			if(bibliography) return bibliography;
		}
		
		var styleClass = cslEngine.opt.class;
		var citations=[];
		for (var i=0, ilen=items.length; i<ilen; i++) {
			var item = items[i];
			var outList = cslEngine.appendCitationCluster({"citationItems":[{"id":item.id}], "properties":{}}, true);
			for (var j=0, jlen=outList.length; j<jlen; j++) {
				var citationPos = outList[j][0];
				citations[citationPos] = outList[j][1];
			}
		}
		
		if(styleClass == "note") {
			if(format == "html") {
				return "<ol>\n\t<li>"+citations.join("</li>\n\t<li>")+"</li>\n</ol>";
			} else if(format == "text") {
				var output = [];
				for(var i=0; i<citations.length; i++) {
					output.push((i+1)+". "+citations[i]+"\r\n");
				}
				return output.join("");
			} else if(format == "rtf") {
				var output = ["{\\rtf \n{\\*\\listtable{\\list\\listtemplateid1\\listhybrid{\\listlevel"+
					"\\levelnfc0\\levelnfcn0\\leveljc0\\leveljcn0\\levelfollow0\\levelstartat1"+
					"\\levelspace360\\levelindent0{\\*\\levelmarker \\{decimal\\}.}{\\leveltext"+
					"\\leveltemplateid1\\'02\\'00.;}{\\levelnumbers\\'01;}\\fi-360\\li720\\lin720 }"+
					"{\\listname ;}\\listid1}}\n{\\*\\listoverridetable{\\listoverride\\listid1"+
					"\\listoverridecount0\\ls1}}\n\\tx720\\li720\\fi-480\\ls1\\ilvl0\n"];
				for(var i=0; i<citations.length; i++) {
					output.push("{\\listtext "+(i+1)+".	}"+citations[i]+"\\\n");
				}
				output.push("}");
				return output.join("");
			} else {
				throw "Unimplemented bibliography format "+format;
			}
		} else {
			if(format == "html") {
				return citations.join("<br />");
			} else if(format == "text") {
				return citations.join("\r\n");
			} else if(format == "rtf") {
				return "<\\rtf \n"+citations.join("\\\n")+"\n}";
			}
		}
	},
	
	/**
	 * Makes a formatted bibliography
	 * @param {Zotero.Style} style The style
	 * @param {String} format The format of the output (html, text, or rtf)
	 * @return {String} Bibliography in specified format
	 */
	"makeFormattedBibliography":function makeFormattedBibliography(cslEngine, format) {
		cslEngine.setOutputFormat(format);
		var bib = cslEngine.makeBibliography();
		if(!bib) return false;
		
		if(format == "html") {
			var output = [bib[0].bibstart];
			for(var i in bib[1]) {
				output.push(bib[1][i]);
				
				// add COinS
				for each(var itemID in bib[0].entry_ids[i]) {
					try {
						var co = Zotero.OpenURL.createContextObject(Zotero.Items.get(itemID), "1.0");
						if(!co) continue;
						output.push('  <span class="Z3988" title="'+
							co.replace("&", "&amp;", "g").replace("<", "&lt;", "g").replace(">", "&gt;", "g")+
							'"></span>\n');
					} catch(e) {
						Zotero.logError(e);
					}
				}
			}
			output.push(bib[0].bibend);
			var html = output.join("");
			
			var inlineCSS = true;
			if (!inlineCSS) {
				return html;
			}
			
			//Zotero.debug("maxoffset: " + bib[0].maxoffset);
			//Zotero.debug("entryspacing: " + bib[0].entryspacing);
			//Zotero.debug("linespacing: " + bib[0].linespacing);
			//Zotero.debug("hangingindent: " + bib[0].hangingindent);
			//Zotero.debug("second-field-align: " + bib[0]["second-field-align"]);
			
			var maxOffset = parseInt(bib[0].maxoffset);
			var entrySpacing = parseInt(bib[0].entryspacing);
			var lineSpacing = parseInt(bib[0].linespacing);
			var hangingIndent = parseInt(bib[0].hangingindent);
			var secondFieldAlign = bib[0]["second-field-align"];
			
			// Validate input
			if(maxOffset == NaN) throw "Invalid maxoffset";
			if(entrySpacing == NaN) throw "Invalid entryspacing";
			if(lineSpacing == NaN) throw "Invalid linespacing";
			
			var str;
			var parser = Components.classes["@mozilla.org/xmlextras/domparser;1"]
					.createInstance(Components.interfaces.nsIDOMParser),
				doc = parser.parseFromString("<!DOCTYPE html><html><body></body></html>", "text/html");
			doc.body.insertAdjacentHTML("afterbegin", html);
			var div = doc.body.firstChild,
				leftMarginDivs = Zotero.Utilities.xpath(doc, '//div[@class="csl-left-margin"]'),
				multiField = !!leftMarginDivs.length,
				clearEntries = multiField;
			
			// One of the characters is usually a period, so we can adjust this down a bit
			maxOffset = Math.max(1, maxOffset - 2);
			
			// Force a minimum line height
			if(lineSpacing <= 1.35) lineSpacing = 1.35;
			
			var style = div.getAttribute("style");
			if(!style) style = "";
			style += "line-height: " + lineSpacing + "; ";
			
			if(hangingIndent) {
				if (multiField && !secondFieldAlign) {
					throw ("second-field-align=false and hangingindent=true combination is not currently supported");
				}
				// If only one field, apply hanging indent on root
				else if (!multiField) {
					style += "margin-left: " + hangingIndent + "em; text-indent:-" + hangingIndent + "em;";
				}
			}
			
			if(style) div.setAttribute("style", style);
			
			// csl-entry
			var divs = Zotero.Utilities.xpath(doc, '//div[@class="csl-entry"]');
			for(var i=0, n=divs.length; i<n; i++) {
				var div = divs[i],
					divStyle = div.getAttribute("style");
				if(!divStyle) divStyle = "";
				
				if (clearEntries) {
					divStyle += "clear: left; ";
				}
				
				if(entrySpacing && i !== n - 1) {
					divStyle += "margin-bottom: " + entrySpacing + "em;";
				}
				
				if(divStyle) div.setAttribute("style", divStyle);
			}
			
			// Padding on the label column, which we need to include when
			// calculating offset of right column
			var rightPadding = .5;
			
			// div.csl-left-margin
			for (let div of leftMarginDivs) {
				var divStyle = div.getAttribute("style");
				if(!divStyle) divStyle = "";
				
				divStyle = "float: left; padding-right: " + rightPadding + "em;";
				
				// Right-align the labels if aligning second line, since it looks
				// better and we don't need the second line of text to align with
				// the left edge of the label
				if (secondFieldAlign) {
					divStyle += "text-align: right; width: " + maxOffset + "em;";
				}
				
				div.setAttribute("style", divStyle);
			}
			
			// div.csl-right-inline
			for (let div of Zotero.Utilities.xpath(doc, '//div[@class="csl-right-inline"]')) {
				var divStyle = div.getAttribute("style");
				if(!divStyle) divStyle = "";
				
				divStyle = "margin: 0 .4em 0 " + (secondFieldAlign ? maxOffset + rightPadding : "0") + "em;";
				
				if (hangingIndent) {
					divStyle += "padding-left: " + hangingIndent + "em; text-indent:-" + hangingIndent + "em;";
				}
				
				div.setAttribute("style", divStyle);
			}
			
			// div.csl-indent
			for (let div of Zotero.Utilities.xpath(doc, '//div[@class="csl-indent"]')) {
				div.setAttribute("style", "margin: .5em 0 0 2em; padding: 0 0 .2em .5em; border-left: 5px solid #ccc;");
			}
			
			return doc.body.innerHTML;
		} else if(format == "text") {
			return bib[0].bibstart+bib[1].join("")+bib[0].bibend;
		} else if(format == "rtf") {
			var bibStyle = Zotero.Cite.getBibliographyFormatParameters(bib);
			
			var preamble = (bibStyle.tabStops.length ? "\\tx"+bibStyle.tabStops.join(" \\tx")+" " : "");
			preamble += "\\li"+bibStyle.indent+" \\fi"+bibStyle.firstLineIndent+" "
					   +"\\sl"+bibStyle.lineSpacing+" \\slmult1 "
					   +"\\sa"+bibStyle.entrySpacing+" ";
			
			return bib[0].bibstart+preamble+bib[1].join("\\\r\n")+"\\\r\n"+bib[0].bibend;
		} else {
			throw "Unimplemented bibliography format "+format;
		}
	},

	/**
	 * Get an item by ID, either by retrieving it from the library or looking for the document it
	 * belongs to.
	 * @param {String|Number|Array} id
	 * @return {Zotero.Item} item
	 */
	"getItem":function getItem(id) {
		var slashIndex;
		
		if(id instanceof Array) {
			return id.map(anId => Zotero.Cite.getItem(anId));
		} else if(typeof id === "string" && (slashIndex = id.indexOf("/")) !== -1) {		
			var sessionID = id.substr(0, slashIndex),
				session = Zotero.Integration.sessions[sessionID],
				item;
			if(session) {
				item = session.embeddedZoteroItems[id.substr(slashIndex+1)];
			}
			
			if(!item) {
				item = new Zotero.Item("document");
				item.setField("title", "Missing Item");
				Zotero.log("CSL item "+id+" not found");
			}
			return item;
		} else {
			return Zotero.Items.get(id);
		}
	}
};

/**
 * Get a CSL abbreviation in the format expected by citeproc-js
 */
Zotero.Cite.getAbbreviation = new function() {
	var abbreviations,
		abbreviationCategories;

	/**
	 * Initialize abbreviations database.
	 */
	function init() {
		if(!abbreviations) loadAbbreviations();
	}

	function loadAbbreviations() {
		var file = Zotero.File.pathToFile(Zotero.DataDirectory.dir);
		file.append("abbreviations.json");

		var json, origin;
		if(file.exists()) {
			json = Zotero.File.getContents(file);
			origin = file.path;
		} else {
			json = Zotero.File.getContentsFromURL("resource://zotero/schema/abbreviations.json");
			origin = "resource://zotero/schema/abbreviations.json";
		}

		try {
			abbreviations = JSON.parse(json);
		} catch(e) {
			throw new Zotero.Exception.Alert("styles.abbreviations.parseError", origin,
				"styles.abbreviations.title", e);
		}

		if(!abbreviations.info || !abbreviations.info.name || !abbreviations.info.URI) {
			throw new Zotero.Exception.Alert("styles.abbreviations.missingInfo", origin,
				"styles.abbreviations.title");
		}

		abbreviationCategories = {};
		for(var jurisdiction in abbreviations) {
			for(var category in abbreviations[jurisdiction]) {
				abbreviationCategories[category] = true;
			}
		}
	}
	
	/**
	 * Normalizes a key
	 */
	function normalizeKey(key) {
		// Strip periods, normalize spacing, and convert to lowercase
		return key.toString().
			replace(/(?:\b|^)(?:and|et|y|und|l[ae]|the|[ld]')(?:\b|$)|[\x21-\x2C.\/\x3A-\x40\x5B-\x60\\\x7B-\x7E]/ig, "").
			replace(/\s+/g, " ").trim();
	}

	function lookupKey(key) {
		return key.toLowerCase().replace(/\s*\./g, "." );
	}
	
	/**
	 * Replace getAbbreviation on citeproc-js with our own handler.
	 */
	return function getAbbreviation(listname, obj, jurisdiction, category, key) {
		init();

		// Short circuit if we know we don't handle this kind of abbreviation
		if(!abbreviationCategories[category] && !abbreviationCategories[category+"-word"]) return;

		var normalizedKey = normalizeKey(key),
			lcNormalizedKey = lookupKey(normalizedKey),
			abbreviation;
		if(!normalizedKey) return;
		
		var jurisdictions = ["default"];
		if(jurisdiction !== "default" && abbreviations[jurisdiction]) {
			jurisdictions.unshift(jurisdiction);
		}

		// Look for full abbreviation
		var jur, cat;
		for(var i=0; i<jurisdictions.length && !abbreviation; i++) {
			if((jur = abbreviations[jurisdictions[i]]) && (cat = jur[category])) {
				abbreviation = cat[lcNormalizedKey];
			}
		}

		if(!abbreviation) {
			// Abbreviate words individually
			var words = normalizedKey.split(/([ \-])/);

			if(words.length > 1) {
				var lcWords = [];
				for(var j=0; j<words.length; j+=2) {
					lcWords[j] = lookupKey(words[j]);
				}
				for(var j=0; j<words.length; j+=2) {
					var word = words[j],
						lcWord = lcWords[j],
						newWord = undefined,
						exactMatch = false;
					
					for(var i=0; i<jurisdictions.length && newWord === undefined; i++) {
						if(!(jur = abbreviations[jurisdictions[i]])) continue;
						if(!(cat = jur[category+"-word"])) continue;
						
						if(cat.hasOwnProperty(lcWord)) {
							// Complete match
							newWord = cat[lcWord];
							exactMatch = true;
						} else if(lcWord.charAt(lcWord.length-1) == 's' && cat.hasOwnProperty(lcWord.substr(0, lcWord.length-1))) {
							// Try dropping 's'
							newWord = cat[lcWord.substr(0, lcWord.length-1)];
							exactMatch = true;
						} else {
							if(j < words.length-2) {
								// Two-word match
								newWord = cat[lcWord+words[j+1]+lcWords[j+2]];
								if(newWord !== undefined) {
									words.splice(j+1, 2);
									lcWords.splice(j+1, 2);
									exactMatch = true;
								}
							}

							if(newWord === undefined) {
								// Partial match
								for(var k=lcWord.length; k>0 && newWord === undefined; k--) {
									newWord = cat[lcWord.substr(0, k)+"-"];
								}
							}
						}
					}
					
					// Don't substitute with a longer word
					if(newWord && !exactMatch && word.length - newWord.length < 1) {
						newWord = word;
					}
					
					// Fall back to full word
					if(newWord === undefined) newWord = word;
					
					// Don't discard last word (e.g. Climate of the Past => Clim. Past)
					if(!newWord && j == words.length-1) newWord = word;
					
					words[j] = newWord.substr(0, 1).toUpperCase() + newWord.substr(1);
				}
				abbreviation = words.join("").replace(/\s+/g, " ").trim();
			} else {
				abbreviation = key;
			}
		}

		if(!abbreviation) abbreviation = key; //this should never happen, but just in case
		
		Zotero.debug("Abbreviated "+key+" as "+abbreviation);
		
		// Add to jurisdiction object
		if(!obj[jurisdiction]) {
			obj[jurisdiction] = new Zotero.CiteProc.CSL.AbbreviationSegments();
		}
		obj[jurisdiction][category][key] = abbreviation;
	}
};

/**
 * An initial version of retrieveStyleModule().
 * (may be replaced by plugin version)
 */
Zotero.Cite.retrieveStyleModule = function(jurisdiction, preference) {
	var id = preference ? "juris-" + jurisdiction + "-" + preference : "juris-" + jurisdiction;
	var module = Zotero.Styles.get("http://juris-m.github.io/modules/" + id);
	var ret = false;
	if (module) {
		ret = module.getXML();
	}
	return ret;
}

/**
 * citeproc-js system object
 * @class
 */
Zotero.Cite.System = function(automaticJournalAbbreviations) {
	if(automaticJournalAbbreviations) {
		this.getAbbreviation = Zotero.Cite.getAbbreviation;
	}
    this.retrieveStyleModule = Zotero.Cite.retrieveStyleModule;
}

Zotero.Cite.System.prototype = {
	/**
	 * citeproc-js system function for getting items
	 * See http://gsl-nagoya-u.net/http/pub/citeproc-doc.html#retrieveitem
	 * @param {String|Integer} Item ID, or string item for embedded citations
	 * @return {Object} citeproc-js item
	 */
	"retrieveItem":function retrieveItem(item) {
		var zoteroItem, slashIndex;
		if(typeof item === "object" && item !== null &&  item instanceof Zotero.Item) {
			//if(this._cache[item.id]) return this._cache[item.id];
			zoteroItem = item;
		} else if(typeof item === "string" && (slashIndex = item.indexOf("/")) !== -1) {
			// is an embedded item
			var sessionID = item.substr(0, slashIndex);
			var session = Zotero.Integration.sessions[sessionID]
			if(session) {
				var embeddedCitation = session.embeddedItems[item.substr(slashIndex+1)];
				if(embeddedCitation) {
					embeddedCitation.id = item;
					return embeddedCitation;
				}
			}
		} else {
			// is an item ID
			//if(this._cache[item]) return this._cache[item];
			try {
				zoteroItem = Zotero.Items.get(item);
			} catch(e) {}
		}

		if(!zoteroItem) {
			throw "Zotero.Cite.System.retrieveItem called on non-item "+item;
		}

		var cslItem;
		try {
			cslItem = Zotero.Utilities.itemToCSLJSON(zoteroItem);
		} catch (e) {
			Zotero.debug("Warning: saw item as changed in toJSON(). Missing jurisdiction in online item?: "+e);
			cslItem = Zotero.Utilities.itemToCSLJSON(zoteroItem, false, false, false, true);
		}

		// TEMP: citeproc-js currently expects the id property to be the item DB id
		cslItem.id = zoteroItem.id;
		
		if (!Zotero.Prefs.get("export.citePaperJournalArticleURL")) {
			var itemType = Zotero.ItemTypes.getName(zoteroItem.itemTypeID);
			// don't return URL or accessed information for journal articles if a
			// pages field exists
			if (["journalArticle", "newspaperArticle", "magazineArticle"].indexOf(itemType) !== -1
				&& zoteroItem.getField("pages")
			) {
				delete cslItem.URL;
				delete cslItem.accessed;
			}
		}
		
		return cslItem;
	},

	/**
	 * citeproc-js system function for getting locale
	 * See http://gsl-nagoya-u.net/http/pub/citeproc-doc.html#retrieveLocale
	 * @param {String} lang Language to look for a locale for
	 * @return {String|Boolean} The locale as a string if it exists, or false if it doesn't
	 */
	"retrieveLocale":function retrieveLocale(lang) {
		var protHandler = Components.classes["@mozilla.org/network/protocol;1?name=chrome"]
			.createInstance(Components.interfaces.nsIProtocolHandler);
		try {
			var channel = protHandler.newChannel(protHandler.newURI("chrome://zotero/content/locale/csl/locales-"+lang+".xml", "UTF-8", null));
			var rawStream = channel.open();
		} catch(e) {
			return false;
		}
		var converterStream = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
							   .createInstance(Components.interfaces.nsIConverterInputStream);
		converterStream.init(rawStream, "UTF-8", 65535,
			Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
		var str = {};
		converterStream.readString(channel.contentLength, str);
		converterStream.close();
		return str.value;
	},

	"wrapCitationEntryHtml":function (str, item_id, locator_txt, suffix_txt) {
		if (!locator_txt) {
			locator_txt = "";
		}
		if (!suffix_txt) {
			suffix_txt = "";
		}
		return Zotero.Prefs.get("export.quickCopy.citationWrapperHtml")
			.replace("%%STRING%%", str)
			.replace("%%LOCATOR%%", locator_txt)
			.replace("%%SUFFIX%%", suffix_txt)
			.replace("%%ITEM_ID%%", item_id);
	},

	"wrapCitationEntryText":function (str, item_id, locator_txt, suffix_txt) {
		if (!locator_txt) {
			locator_txt = "";
		}
		if (!suffix_txt) {
			suffix_txt = "";
		}
		return Zotero.Prefs.get("export.quickCopy.citationWrapperText")
			.replace("%%STRING%%", str)
			.replace("%%LOCATOR%%", locator_txt)
			.replace("%%SUFFIX%%", suffix_txt)
			.replace("%%ITEM_ID%%", item_id);
	},

	/**
	 * citeproc-js system function for getting abbreviations
	 * See http://gsl-nagoya-u.net/http/pub/citeproc-doc.html#getabbreviations
	 * Not currently used because it doesn't scale well to large lists
	 */
	"getAbbreviations":function getAbbreviations() {
		return {};
	},

	"normalizeUnicode":function(str) {
		var buf = {};
		var unicodeNormalizer = Components.classes["@mozilla.org/intl/unicodenormalizer;1"]
			.createInstance(Components.interfaces.nsIUnicodeNormalizer);
		unicodeNormalizer.NormalizeUnicodeNFKC(str, buf);
		return buf.value;
	},
	
	"setVariableWrapper":function(setValue) {
		if ("boolean" !== typeof setValue) {
			setValue = Zotero.Prefs.get('linkTitles');
		}
		if (setValue) {
			this.variableWrapper = function(params, prePunct, str, postPunct) {
				if (params.variableNames[0] === 'title' 
					&& (params.itemData.URL || params.itemData.URL_REAL || params.itemData.DOI)
					&& params.context === "bibliography") {
					
					var URL = null;
					var DOI = params.itemData.DOI;
					if (DOI) {
						URL = 'http://dx.doi.org/' + Zotero.Utilities.cleanDOI(DOI)
					}
					if (!URL) {
						URL = params.itemData.URL ? params.itemData.URL : params.itemData.URL_REAL;
					}
					if (URL) {
						if (params.mode === 'rtf') {
							return prePunct + '{\\field{\\*\\fldinst HYPERLINK "' + URL + '"}{\\fldrslt ' + str + '}}' + postPunct;
						} else {
							return prePunct + '<a href="' + URL + '">' + str + '</a>' + postPunct;
						}
					} else {
						return (prePunct + str + postPunct);
					}
				} else {
					return (prePunct + str + postPunct);
				}
			}
		} else {
			this.variableWrapper = null;
		}
	},

	"getHumanForm":function(jurisdictionKey, courtKey) {
		var ret;
		var res;
		if (jurisdictionKey && courtKey) {
			ret = Zotero.Utilities.getCourtName(jurisdictionKey, courtKey, true);
		} else if (jurisdictionKey) {
			// true is for fallback to key if no match is found
			res = Zotero.Utilities.getJurisdictionName(jurisdictionKey, true);
			if (res) {
				res = res.split("|");
				if (res.length > 2) {
					ret = res.slice(1).join("|");
				} else {
					ret = res.join("|");
				}
			} else {
				ret = res;
			}
		}
		return ret ? "" + ret : "";
	},

	"getLanguageName": function(str) {
		// This is not a great solution. The nickname may or may not be appropriate
		// for naming a language in citations. On the other hand (a) accessing names
		// in the registry requires async, and (b) registry names are sometimes not
		// right (like "Central Khmer"), and (c) there are too many names in the
		// registry to justify carrying all of them in memory for this limited
		// purpose.
		return Zotero.CachedLanguages.getNickname(str);
	}

}

Zotero.Cite._monthStrings = false;
Zotero.Cite.getMonthStrings = function(form, locale) {
	if(Zotero.Cite._monthStrings){
		return Zotero.Cite._monthStrings[form];
	} else {
		Zotero.Cite._monthStrings = {"long":[], "short":[]};

		var sys = {'xml':new Zotero.CiteProc.CSL.System.Xml.Parsing()};
		if(!locale) locale = Zotero.locale;

		var cslLocale = Zotero.CiteProc.CSL.localeResolve(Zotero.locale);
		if(!Zotero.CiteProc.CSL.locale[cslLocale.best]) {
			let localexml = sys.xml.makeXml(Zotero.Cite.System.retrieveLocale(cslLocale.best));
			if(!localexml) {
				if(localexml == "en-US") {
					throw "No locales.xml file could be found for the preferred locale or for en-US. "+
						  "Please ensure that the locales directory exists and is properly populated";
				} else {
					let localexml = sys.xml.makeXml(Zotero.Cite.System.retrieveLocale(cslLocale.bare));
					if(!localexml) {
						Zotero.log("No locale "+cslLocale.best+"; using en-US", "warning");
						return Zotero.Cite.getMonthStrings(form, "en-US");
					}
				}
			}
			Zotero.CiteProc.CSL.localeSet.call(Zotero.CiteProc.CSL, sys, localexml, cslLocale.best, cslLocale.best);
		}

		var locale = Zotero.CiteProc.CSL.locale[cslLocale.best];
		if(!locale) {
			Zotero.log("No locale "+cslLocale.best+"; using en-US", "warning");
			return Zotero.Cite.getMonthStrings(form, "en-US");
		}

		for(let i=1; i<=12; i++) {
			let term = locale.terms["month-"+(i<10 ? "0" : "")+i];
			if(term) {
				Zotero.Cite._monthStrings["long"][i-1] = term["long"];
				Zotero.Cite._monthStrings["short"][i-1] = (term["short"] ? term["short"].replace(".", "", "g") : term["long"]);
			} else {
				Zotero.log("No month "+i+" specified for locale "+cslLocale.best, "warning");
			}
		}
		return Zotero.Cite._monthStrings[form];
	}
};
