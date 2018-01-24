"use strict";
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

const DATA_VERSION = 3;

// Specifies that citations should only be updated if changed
const FORCE_CITATIONS_FALSE = 0;
// Specifies that citations should only be updated if formattedText has changed from what is encoded
// in the field code
const FORCE_CITATIONS_REGENERATE = 1;
// Specifies that citations should be reset regardless of whether formattedText has changed
const FORCE_CITATIONS_RESET_TEXT = 2;

// These must match the constants in corresponding word plugins
const DIALOG_ICON_STOP = 0;
const DIALOG_ICON_WARNING = 1;
const DIALOG_ICON_CAUTION = 2;

const DIALOG_BUTTONS_OK = 0;
const DIALOG_BUTTONS_OK_CANCEL = 1;
const DIALOG_BUTTONS_YES_NO = 2;
const DIALOG_BUTTONS_YES_NO_CANCEL = 3;

const NOTE_FOOTNOTE = 1;
const NOTE_ENDNOTE = 2;

const INTEGRATION_TYPE_ITEM = 1;
const INTEGRATION_TYPE_BIBLIOGRAPHY = 2;
const INTEGRATION_TYPE_TEMP = 3;

const DELAY_CITATIONS_PROMPT_TIMEOUT = 5/*seconds*/;
const DELAYED_CITATION_STYLING = "\\uldash";
const DELAYED_CITATION_STYLING_CLEAR = "\\ulclear";


Zotero.Integration = new function() {
	Components.utils.import("resource://gre/modules/Services.jsm");
	Components.utils.import("resource://gre/modules/AddonManager.jsm");

	this.currentWindow = false;
	this.sessions = {};

	/**
	 * Initializes the pipe used for integration on non-Windows platforms.
	 */
	this.init = function() {
		// We only use an integration pipe on OS X.
		// On Linux, we use the alternative communication method in the OOo plug-in
		// On Windows, we use a command line handler for integration. See
		// components/zotero-integration-service.js for this implementation.
		if(!Zotero.isMac) return;

		// Determine where to put the pipe
		// on OS X, first try /Users/Shared for those who can't put pipes in their home
		// directories
		var pipe = null;
		var sharedDir = Components.classes["@mozilla.org/file/local;1"].
			createInstance(Components.interfaces.nsILocalFile);
		sharedDir.initWithPath("/Users/Shared");

		if(sharedDir.exists() && sharedDir.isDirectory()) {
			var logname = Components.classes["@mozilla.org/process/environment;1"].
				getService(Components.interfaces.nsIEnvironment).
				get("LOGNAME");
			var sharedPipe = sharedDir.clone();
			sharedPipe.append(".zoteroIntegrationPipe_"+logname);

			if(sharedPipe.exists()) {
				if(this.deletePipe(sharedPipe) && sharedDir.isWritable()) {
					pipe = sharedPipe;
				}
			} else if(sharedDir.isWritable()) {
				pipe = sharedPipe;
			}
		}

		if(!pipe) {
			// on other platforms, or as a fallback, use home directory
			pipe = Components.classes["@mozilla.org/file/directory_service;1"].
				getService(Components.interfaces.nsIProperties).
				get("Home", Components.interfaces.nsIFile);
			pipe.append(".zoteroIntegrationPipe");

			// destroy old pipe, if one exists
			if(!this.deletePipe(pipe)) return;
		}

		// try to initialize pipe
		try {
			this.initPipe(pipe);
		} catch(e) {
			Zotero.logError(e);
		}
	}

	/**
	 * Begin listening for integration commands on the given pipe
	 * @param {String} pipe The path to the pipe
	 */
	this.initPipe = function(pipe) {
		Zotero.IPC.Pipe.initPipeListener(pipe, function(string) {
			if(string != "") {
				// exec command if possible
				var parts = string.match(/^([^ \n]*) ([^ \n]*)(?: ([^\n]*))?\n?$/);
				if(parts) {
					var agent = parts[1].toString();
					var cmd = parts[2].toString();
					var document = parts[3] ? parts[3].toString() : null;
					Zotero.Integration.execCommand(agent, cmd, document);
				} else {
					Components.utils.reportError("Zotero: Invalid integration input received: "+string);
				}
			}
		});
	}

	/**
	 * Deletes a defunct pipe on OS X
	 */
	this.deletePipe = function(pipe) {
		try {
			if(pipe.exists()) {
				Zotero.IPC.safePipeWrite(pipe, "Zotero shutdown\n");
				pipe.remove(false);
			}
			return true;
		} catch (e) {
			// if pipe can't be deleted, log an error
			Zotero.debug("Error removing old integration pipe "+pipe.path, 1);
			Zotero.logError(e);
			Components.utils.reportError(
				"Zotero word processor integration initialization failed. "
					+ "See http://forums.zotero.org/discussion/12054/#Item_10 "
					+ "for instructions on correcting this problem."
			);

			// can attempt to delete on OS X
			try {
				var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
					.getService(Components.interfaces.nsIPromptService);
				var deletePipe = promptService.confirm(null, Zotero.getString("integration.error.title"), Zotero.getString("integration.error.deletePipe"));
				if(!deletePipe) return false;
				let escapedFifoFile = pipe.path.replace("'", "'\\''");
				Zotero.Utilities.Internal.executeAppleScript("do shell script \"rmdir '"+escapedFifoFile+"'; rm -f '"+escapedFifoFile+"'\" with administrator privileges", true);
				if(pipe.exists()) return false;
			} catch(e) {
				Zotero.logError(e);
				return false;
			}
		}
	}

	this.resetSessionStyles = Zotero.Promise.coroutine(function* (){
		for (let sessionID in Zotero.Integration.sessions) {
			let session = Zotero.Integration.sessions[sessionID];
			yield session.setData(session.data, true);
		}
	});

	this.getApplication = function(agent, command, docId) {
		// Try to load the appropriate Zotero component; otherwise display an error
		try {
			var componentClass = "@zotero.org/Zotero/integration/application?agent="+agent+";1";
			Zotero.debug("Integration: Instantiating "+componentClass+" for command "+command+(docId ? " with doc "+docId : ""));
			try {
				return Components.classes[componentClass]
					.getService(Components.interfaces.zoteroIntegrationApplication);
			} catch (e) {
				return Components.classes[componentClass]
					.getService(Components.interfaces.nsISupports).wrappedJSObject;
			}
		} catch(e) {
			throw new Zotero.Exception.Alert("integration.error.notInstalled",
				[], "integration.error.title");
		}
	},

	/**
	 * Executes an integration command, first checking to make sure that versions are compatible
	 */
	this.execCommand = new function() {
		var inProgress;

		return Zotero.Promise.coroutine(function* execCommand(agent, command, docId) {
			var document, session;

			if (inProgress) {
				Zotero.Utilities.Internal.activate();
				if(Zotero.Integration.currentWindow && !Zotero.Integration.currentWindow.closed) {
					Zotero.Integration.currentWindow.focus();
				}
				Zotero.debug("Integration: Request already in progress; not executing "+agent+" "+command);
				return;
			}
			inProgress = true;
			Zotero.debug(`Integration: ${agent}-${command}${docId ? `:'${docId}'` : ''} invoked`)

			var startTime = (new Date()).getTime();

			// Try to execute the command; otherwise display an error in alert service or word processor
			// (depending on what is possible)
			try {
				// Word for windows throws RPC_E_CANTCALLOUT_ININPUTSYNCCALL if we invoke an OLE call in the
				// current event loop (which.. who would have guessed would be the case?)
				yield Zotero.Promise.delay();
				var application = Zotero.Integration.getApplication(agent, command, docId);

				Zotero.Integration.currentDoc = document = (application.getDocument && docId ? application.getDocument(docId) : application.getActiveDocument());
				Zotero.Integration.currentSession = session = yield Zotero.Integration.getSession(application, document);
				// TODO: this is pretty awful
				session.fields = new Zotero.Integration.Fields(session, document);
				session._doc = document;
				// TODO: figure this out
				// Zotero.Notifier.trigger('delete', 'collection', 'document');
				yield (new Zotero.Integration.Interface(application, document, session))[command]();
				document.setDocumentData(session.data.serialize());
			}
			catch (e) {
				if(!(e instanceof Zotero.Exception.UserCancelled)) {
					try {
						var displayError = null;
						if(e instanceof Zotero.Exception.Alert) {
							displayError = e.message;
						} else {
							if(e.toString().indexOf("ExceptionAlreadyDisplayed") === -1) {
								displayError = Zotero.getString("integration.error.generic")+"\n\n"+(e.message || e.toString());
							}
							if(e.stack) {
								Zotero.debug(e.stack);
							}
						}

						if(displayError) {
							var showErrorInFirefox = !document;

							if(document) {
								try {
									document.activate();
									document.displayAlert(displayError, DIALOG_ICON_STOP, DIALOG_BUTTONS_OK);
								} catch(e) {
									showErrorInFirefox = true;
								}
							}

							if(showErrorInFirefox) {
								Zotero.Utilities.Internal.activate();
								Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
									.getService(Components.interfaces.nsIPromptService)
									.alert(null, Zotero.getString("integration.error.title"), displayError);
							}
						}
					} finally {
						Zotero.logError(e);
					}
				} else {
					// If user cancels we should still write the currently assigned session ID
					document.setDocumentData(session.data.serialize());
				}
			}
			finally {
				var diff = ((new Date()).getTime() - startTime)/1000;
				Zotero.debug(`Integration: ${agent}-${command}${docId ? `:'${docId}'` : ''} complete in ${diff}s`)
				if (document) {
					try {
						document.cleanup();
						document.activate();

						// Call complete function if one exists
						if (document.wrappedJSObject && document.wrappedJSObject.complete) {
							document.wrappedJSObject.complete();
						} else if (document.complete) {
							document.complete();
						}
					} catch(e) {
						Zotero.logError(e);
					}
				}

				if(Zotero.Integration.currentWindow && !Zotero.Integration.currentWindow.closed) {
					var oldWindow = Zotero.Integration.currentWindow;
					Zotero.Promise.delay(100).then(function() {
						oldWindow.close();
					});
				}

				inProgress =
					Zotero.Integration.currentDoc =
					Zotero.Integration.currentWindow = false;
			}
		});
	};

	/**
	 * Displays a dialog in a modal-like fashion without hanging the thread
	 * @param {String} url The chrome:// URI of the window
	 * @param {String} [options] Options to pass to the window
	 * @param {String} [io] Data to pass to the window
	 * @return {Promise} Promise resolved when the window is closed
	 */
	this.displayDialog = function displayDialog(url, options, io) {
		Zotero.Integration.currentDoc.cleanup();

		var allOptions = 'chrome,centerscreen';
		// without this, Firefox gets raised with our windows under Compiz
		if(Zotero.isLinux) allOptions += ',dialog=no';
		if(options) allOptions += ','+options;

		var window = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
			.getService(Components.interfaces.nsIWindowWatcher)
			.openWindow(null, url, '', allOptions, (io ? io : null));
		Zotero.Integration.currentWindow = window;
		Zotero.Utilities.Internal.activate(window);

		var deferred = Zotero.Promise.defer();
		var listener = function() {
			if(window.location.toString() === "about:blank") return;

			if(window.newWindow) {
				window = window.newWindow;
				Zotero.Integration.currentWindow = window;
				window.addEventListener("unload", listener, false);
				return;
			}

			Zotero.Integration.currentWindow = false;
			deferred.resolve();
		}
		window.addEventListener("unload", listener, false);

		return deferred.promise;
	};

	/**
	 * Gets a session for a given doc.
	 * Either loads a cached session if doc communicated since restart or creates a new one
	 * @return {Zotero.Integration.Session} Promise
	 */
	this.getSession = Zotero.Promise.coroutine(function *(app, doc) {
		var dataString = doc.getDocumentData(),
			data, session;

		try {
			data = new Zotero.Integration.DocumentData(dataString);
		} catch(e) {
			data = new Zotero.Integration.DocumentData();
		}

		if (data.prefs.fieldType) {
			if (data.dataVersion < DATA_VERSION) {
				if (data.dataVersion == 1
						&& data.prefs.fieldType == "Field"
						&& this._app.primaryFieldType == "ReferenceMark") {
					// Converted OOo docs use ReferenceMarks, not fields
					data.prefs.fieldType = "ReferenceMark";
				}

				var warning = doc.displayAlert(Zotero.getString("integration.upgradeWarning", [Zotero.clientName, '5.0']),
					DIALOG_ICON_WARNING, DIALOG_BUTTONS_OK_CANCEL);
				if (!warning) {
					throw new Zotero.Exception.UserCancelled("document upgrade");
				}
			// Don't throw for version 4(JSON) during the transition from 4.0 to 5.0
			} else if ((data.dataVersion > DATA_VERSION) && data.dataVersion != 4) {
				throw new Zotero.Exception.Alert("integration.error.newerDocumentVersion",
						[data.zoteroVersion, Zotero.version], "integration.error.title");
			}

			if (data.prefs.fieldType !== app.primaryFieldType
					&& data.prefs.fieldType !== app.secondaryFieldType) {
				throw new Zotero.Exception.Alert("integration.error.fieldTypeMismatch",
						[], "integration.error.title");
			}

			session = Zotero.Integration.sessions[data.sessionID];
		}
		if (!session) {
			session = new Zotero.Integration.Session(doc, app);
			session.reload = true;
		}
		try {
			yield session.setData(data);
		} catch(e) {
			// make sure style is defined
			if (e instanceof Zotero.Exception.Alert && e.name === "integration.error.invalidStyle") {
				if (data.style.styleID) {
					session.reload = true;
					let trustedSource = /^https?:\/\/(www\.)?(zotero\.org|citationstyles\.org)/.test(data.style.styleID);
					let errorString = Zotero.getString("integration.error.styleMissing", data.style.styleID);
					if (trustedSource ||
						doc.displayAlert(errorString, DIALOG_ICON_WARNING, DIALOG_BUTTONS_YES_NO)) {

						let installed = false;
						try {
							yield Zotero.Styles.install(
								{url: data.style.styleID}, data.style.styleID, true
							);
							installed = true;
						}
						catch (e) {
							me._doc.displayAlert(
								Zotero.getString(
									'integration.error.styleNotFound', data.style.styleID
								),
								DIALOG_ICON_WARNING,
								DIALOG_BUTTONS_OK
							);
						}
						if (installed) {
							yield session.setData(data, true);
						}
						return session;
					}
				}
				yield session.setDocPrefs();
			} else {
				throw e;
			}
		}
		return session;
	});

}

/**
 * An exception thrown when a document contains an item that no longer exists in the current document.
 */
Zotero.Integration.MissingItemException = function(item) {this.item = item;};
Zotero.Integration.MissingItemException.prototype = {
	"name":"MissingItemException",
	"message":`An item in this document is missing from your Zotero library.}`,
	"toString":function() { return this.message + `\n ${JSON.stringify(this.item)}` }
};

Zotero.Integration.NO_ACTION = 0;
Zotero.Integration.UPDATE = 1;
Zotero.Integration.DELETE = 2;

/**
 * All methods for interacting with a document
 * @constructor
 */
Zotero.Integration.Interface = function(app, doc, session) {
	this._app = app;
	this._doc = doc;
	this._session = session;
}

/**
 * Adds a citation to the current document.
 * @return {Promise}
 */
Zotero.Integration.Interface.prototype.addCitation = Zotero.Promise.coroutine(function* () {
	yield this._session.init(false, false);

	let [idx, field, citation] = yield this._session.fields.addEditCitation(null);
	yield this._session.addCitation(idx, field.getNoteIndex(), citation);

	if (this._session.data.prefs.delayCitationUpdates) {
		return this._session.writeDelayedCitation(idx, field, citation);
	} else {
		return this._session.fields.updateDocument(FORCE_CITATIONS_FALSE, false, false);
	}
});

/**
 * Edits the citation at the cursor position.
 * @return {Promise}
 */
Zotero.Integration.Interface.prototype.editCitation = Zotero.Promise.coroutine(function* () {
	var docField = this._doc.cursorInField(this._session.data.prefs['fieldType']);
	if(!docField) {
		throw new Zotero.Exception.Alert("integration.error.notInCitation", [],
			"integration.error.title");
	}
	return this.addEditCitation(docField);
});

/**
 * Edits the citation at the cursor position if one exists, or else adds a new one.
 * @return {Promise}
 */
Zotero.Integration.Interface.prototype.addEditCitation = Zotero.Promise.coroutine(function* (docField) {
	yield this._session.init(false, false);
	docField = docField || this._doc.cursorInField(this._session.data.prefs['fieldType']);

	let [idx, field, citation] = yield this._session.fields.addEditCitation(docField);
	yield this._session.addCitation(idx, field.getNoteIndex(), citation);
	if (this._session.data.prefs.delayCitationUpdates) {
		return this._session.writeDelayedCitation(idx, field, citation);
	} else {
		return this._session.fields.updateDocument(FORCE_CITATIONS_FALSE, false, false);
	}
});

/**
 * Adds a bibliography to the current document.
 * @return {Promise}
 */
Zotero.Integration.Interface.prototype.addBibliography = Zotero.Promise.coroutine(function* () {
	var me = this;
	yield this._session.init(true, false);
	// Make sure we can have a bibliography
	if(!me._session.data.style.hasBibliography) {
		throw new Zotero.Exception.Alert("integration.error.noBibliography", [],
			"integration.error.title");
	}

	let field = new Zotero.Integration.BibliographyField(yield this._session.fields.addField());
	field.clearCode();
	var citationsMode = FORCE_CITATIONS_FALSE;
	if(this._session.data.prefs.delayCitationUpdates) {
		// Refreshes citeproc state before proceeding
		this._session.reload = true;
		citationsMode = FORCE_CITATIONS_REGENERATE;
	}
	yield this._session.fields.updateSession(citationsMode);
	yield this._session.fields.updateDocument(citationsMode, true, false);
})

/**
 * Edits bibliography metadata.
 * @return {Promise}
 */
Zotero.Integration.Interface.prototype.editBibliography = Zotero.Promise.coroutine(function*() {
	// Make sure we have a bibliography
	yield this._session.init(true, false);
	var fields = yield this._session.fields.get();

	var bibliographyField;
	for (let i = fields.length-1; i >= 0; i--) {
		let field = Zotero.Integration.Field.loadExisting(fields[i]);
		if (field.type == INTEGRATION_TYPE_BIBLIOGRAPHY) {
			bibliographyField = field;
			break;
		}
	}

	if(!bibliographyField) {
		throw new Zotero.Exception.Alert("integration.error.mustInsertBibliography",
			[], "integration.error.title");
	}
	let bibliography = new Zotero.Integration.Bibliography(bibliographyField);
	var citationsMode = FORCE_CITATIONS_FALSE;
	if(this._session.data.prefs.delayCitationUpdates) {
		// Refreshes citeproc state before proceeding
		this._session.reload = true;
		citationsMode = FORCE_CITATIONS_REGENERATE;
	}
	yield this._session.fields.updateSession(citationsMode);
	yield this._session.editBibliography(bibliography);
	yield this._session.fields.updateDocument(citationsMode, true, false);
});


Zotero.Integration.Interface.prototype.addEditBibliography = Zotero.Promise.coroutine(function *() {
	// Check if we have a bibliography
	yield this._session.init(true, false);

	if (!this._session.data.style.hasBibliography) {
		throw new Zotero.Exception.Alert("integration.error.noBibliography", [],
			"integration.error.title");
	}

	var fields = yield this._session.fields.get();

	var bibliographyField;
	for (let i = fields.length-1; i >= 0; i--) {
		let field = Zotero.Integration.Field.loadExisting(fields[i]);
		if (field.type == INTEGRATION_TYPE_BIBLIOGRAPHY) {
			bibliographyField = field;
			break;
		}
	}

	var newBibliography = !bibliographyField;
	if (!bibliographyField) {
		bibliographyField = new Zotero.Integration.BibliographyField(yield this._session.fields.addField());
		bibliographyField.clearCode();
	}

	let bibliography = new Zotero.Integration.Bibliography(bibliographyField);
	var citationsMode = FORCE_CITATIONS_FALSE;
	if(this._session.data.prefs.delayCitationUpdates) {
		// Refreshes citeproc state before proceeding
		this._session.reload = true;
		citationsMode = FORCE_CITATIONS_REGENERATE;
	}
	yield this._session.fields.updateSession(citationsMode);
	if (!newBibliography) yield this._session.editBibliography(bibliography);
	yield this._session.fields.updateDocument(citationsMode, true, false);
});

/**
 * Updates the citation data for all citations and bibliography entries.
 * @return {Promise}
 */
Zotero.Integration.Interface.prototype.refresh = async function() {
	await this._session.init(true, false)

	this._session.reload = this._session.data.prefs.delayCitationUpdates;
	await this._session.fields.updateSession(FORCE_CITATIONS_REGENERATE)
	await this._session.fields.updateDocument(FORCE_CITATIONS_REGENERATE, true, false);
}

/**
 * Deletes field codes.
 * @return {Promise}
 */
Zotero.Integration.Interface.prototype.removeCodes = Zotero.Promise.coroutine(function* () {
	var me = this;
	yield this._session.init(true, false)
	let fields = yield this._session.fields.get()
	var result = me._doc.displayAlert(Zotero.getString("integration.removeCodesWarning"),
				DIALOG_ICON_WARNING, DIALOG_BUTTONS_OK_CANCEL);
	if (result) {
		for(var i=fields.length-1; i>=0; i--) {
			fields[i].removeCode();
		}
	}
})

/**
 * Displays a dialog to set document preferences (style, footnotes/endnotes, etc.)
 * @return {Promise}
 */
Zotero.Integration.Interface.prototype.setDocPrefs = Zotero.Promise.coroutine(function* () {
	var oldData;
	let haveSession = yield this._session.init(false, true);

	if(!haveSession) {
		// This is a brand new document; don't try to get fields
		oldData = yield this._session.setDocPrefs();
	} else {
		// Can get fields while dialog is open
		oldData = yield Zotero.Promise.all([
			this._session.fields.get(),
			this._session.setDocPrefs()
		]).spread(function (fields, setDocPrefs) {
			// Only return value from setDocPrefs
			return setDocPrefs;
		});
	}

	// If oldData is null, then there was no document data, so we don't need to update
	// fields
	if (!oldData) return false;

	// Perform noteType or fieldType conversion
	let fields = yield this._session.fields.get();

	var convertBibliographies = oldData.prefs.fieldType != this._session.data.prefs.fieldType;
	var convertItems = convertBibliographies
		|| oldData.prefs.noteType != this._session.data.prefs.noteType;
	var fieldsToConvert = new Array();
	var fieldNoteTypes = new Array();
	for (var i=0, n=fields.length; i<n; i++) {
		let field = Zotero.Integration.Field.loadExisting(fields[i]);

		if (convertItems && field.type === INTEGRATION_TYPE_ITEM) {
			var citation = field.unserialize();
			if (!citation.properties.dontUpdate) {
				fieldsToConvert.push(fields[i]);
				fieldNoteTypes.push(this._session.data.prefs.noteType);
			}
		} else if(convertBibliographies
				&& type === INTEGRATION_TYPE_BIBLIOGRAPHY) {
			fieldsToConvert.push(fields[i]);
			fieldNoteTypes.push(0);
		}
	}

	if(fieldsToConvert.length) {
		// Pass to conversion function
		this._doc.convert(new Zotero.Integration.JSEnumerator(fieldsToConvert),
			this._session.data.prefs.fieldType, fieldNoteTypes,
			fieldNoteTypes.length);
	}

	// Refresh contents
	this._session.fields = new Zotero.Integration.Fields(this._session, this._doc);
	this._session.fields.ignoreEmptyBibliography = false;
	yield this._session.fields.updateSession(FORCE_CITATIONS_RESET_TEXT);
	return this._session.fields.updateDocument(FORCE_CITATIONS_RESET_TEXT, true, true);
});

/**
 * An exceedingly simple nsISimpleEnumerator implementation
 */
Zotero.Integration.JSEnumerator = function(objArray) {
	this.objArray = objArray;
}
Zotero.Integration.JSEnumerator.prototype.hasMoreElements = function() {
	return this.objArray.length;
}
Zotero.Integration.JSEnumerator.prototype.getNext = function() {
	return this.objArray.shift();
}

/**
 * Methods for retrieving fields from a document
 * @constructor
 */
Zotero.Integration.Fields = function(session, doc) {
	this.ignoreEmptyBibliography = true;

	// Callback called while retrieving fields with the percentage complete.
	this.progressCallback = null;

	this._session = session;
	this._doc = doc;

	this._removeCodeFields = {};
	this._bibliographyFields = [];
}

/**
 * Checks that it is appropriate to add fields to the current document at the current
 * positon, then adds one.
 */
Zotero.Integration.Fields.prototype.addField = function(note) {
	// Get citation types if necessary
	if (!this._doc.canInsertField(this._session.data.prefs['fieldType'])) {
		return Zotero.Promise.reject(new Zotero.Exception.Alert("integration.error.cannotInsertHere",
		[], "integration.error.title"));
	}

	var field = this._doc.cursorInField(this._session.data.prefs['fieldType']);
	if (field) {
		if (!this._session.displayAlert(Zotero.getString("integration.replace"),
				DIALOG_ICON_STOP,
				DIALOG_BUTTONS_OK_CANCEL)) {
			return Zotero.Promise.reject(new Zotero.Exception.UserCancelled("inserting citation"));
		}
	}

	if (!field) {
		field = this._doc.insertField(this._session.data.prefs['fieldType'],
			(note ? this._session.data.prefs["noteType"] : 0));
	}
	// If fields already retrieved, further this.get() calls will returned the cached version
	// So we append this field to that list
	if (this._fields) {
		this._fields.push(field);
	}

	return Zotero.Promise.resolve(field);
}

/**
 * Gets all fields for a document
 * @return {Promise} Promise resolved with field list.
 */
Zotero.Integration.Fields.prototype.get = new function() {
	var deferred;
	return function() {
		// If we already have fields, just return them
		if(this._fields) {
			return Zotero.Promise.resolve(this._fields);
		}

		if (deferred) {
			return deferred.promise;
		}
		deferred = Zotero.Promise.defer();
		var promise = deferred.promise;

		// Otherwise, start getting fields
		var getFieldsTime = (new Date()).getTime(),
			me = this;
		this._doc.getFieldsAsync(this._session.data.prefs['fieldType'],
		{"observe":function(subject, topic, data) {
			if(topic === "fields-available") {
				if(me.progressCallback) {
					try {
						me.progressCallback(75);
					} catch(e) {
						Zotero.logError(e);
					};
				}

				try {
					// Add fields to fields array
					var fieldsEnumerator = subject.QueryInterface(Components.interfaces.nsISimpleEnumerator);
					var fields = me._fields = [];
					while(fieldsEnumerator.hasMoreElements()) {
						let field = fieldsEnumerator.getNext();
						try {
							fields.push(field.QueryInterface(Components.interfaces.zoteroIntegrationField));
						} catch (e) {
							fields.push(field);
						}
					}

					if(Zotero.Debug.enabled) {
						var endTime = (new Date()).getTime();
						Zotero.debug("Integration: Retrieved "+fields.length+" fields in "+
							(endTime-getFieldsTime)/1000+"; "+
							1000/((endTime-getFieldsTime)/fields.length)+" fields/second");
					}
				} catch(e) {
					deferred.reject(e);
					deferred = null;
					return;
				}

				deferred.resolve(fields);
				deferred = null;
			} else if(topic === "fields-progress") {
				if(me.progressCallback) {
					try {
						me.progressCallback((data ? parseInt(data, 10)*(3/4) : null));
					} catch(e) {
						Zotero.logError(e);
					};
				}
			} else if(topic === "fields-error") {
				deferred.reject(data);
				deferred = null;
			}
		}, QueryInterface:XPCOMUtils.generateQI([Components.interfaces.nsIObserver, Components.interfaces.nsISupports])});
		return promise;
	}
}

/**
 * Updates Zotero.Integration.Session attached to Zotero.Integration.Fields in line with document
 */
Zotero.Integration.Fields.prototype.updateSession = Zotero.Promise.coroutine(function* (forceCitations) {
	var collectFieldsTime;
	yield this.get();
	this._session.resetRequest(this._doc);

	this._removeCodeFields = {};
	this._bibliographyFields = [];

	collectFieldsTime = (new Date()).getTime();
	if (forceCitations) {
		this._session.regenAll = true;
	}
	yield this._processFields();
	this._session.regenAll = false;

	var endTime = (new Date()).getTime();
	if(Zotero.Debug.enabled) {
		Zotero.debug("Integration: Updated session data for " + this._fields.length + " fields in "
			+ (endTime - collectFieldsTime) / 1000 + "; "
			+ 1000/ ((endTime - collectFieldsTime) / this._fields.length) + " fields/second");
	}

	if (this._session.reload) {
		this._session.restoreProcessorState();
		delete this._session.reload;
	}
});

/**
 * Keep processing fields until all have been processed
 */
Zotero.Integration.Fields.prototype._processFields = Zotero.Promise.coroutine(function* () {
	if (!this._fields) {
		throw new Error("_processFields called without fetching fields first");
	}

	for (var i = 0; i < this._fields.length; i++) {
		let field = Zotero.Integration.Field.loadExisting(this._fields[i]);
		if (field.type === INTEGRATION_TYPE_ITEM) {
			var noteIndex = field.getNoteIndex(),
				citation = new Zotero.Integration.Citation(field, noteIndex);

			let action = yield citation.loadItemData();

			if (action == Zotero.Integration.REMOVE_CODE) {
				this._removeCodeFields[i] = true;
				// Mark for removal and continue
				continue;
			} else if (action == Zotero.Integration.UPDATE) {
				this._session.updateIndices[index] = true;
			}

			yield this._session.addCitation(i, noteIndex, citation);
		} else if (field.type === INTEGRATION_TYPE_BIBLIOGRAPHY) {
			if (this.ignoreEmptyBibliography && field.getText().trim() === "") {
				this._removeCodeFields[i] = true;
			} else {
				this._bibliographyFields.push(field);
			}
		}
	}
	if (this._bibliographyFields.length) {
		this._session.bibliography = new Zotero.Integration.Bibliography(this._bibliographyFields[0]);
		yield this._session.bibliography.loadItemData();
	} else {
		delete this._session.bibliography;
	}
	// TODO: figure this out
	// Zotero.Notifier.trigger('add', 'collection', 'document');
});

/**
 * Updates bibliographies and fields within a document
 * @param {Boolean} forceCitations Whether to regenerate all citations
 * @param {Boolean} forceBibliography Whether to regenerate all bibliography entries
 * @param {Boolean} [ignoreCitationChanges] Whether to ignore changes to citations that have been
 *	   modified since they were created, instead of showing a warning
 * @return {Promise} A promise resolved when the document is updated
 */
Zotero.Integration.Fields.prototype.updateDocument = Zotero.Promise.coroutine(function* (forceCitations, forceBibliography,
		ignoreCitationChanges) {
	this._session.timer = new Zotero.Integration.Timer();
	this._session.timer.start();

	yield this._session._updateCitations()
	yield this._updateDocument(forceCitations, forceBibliography, ignoreCitationChanges)

	var diff = this._session.timer.stop();
	this._session.timer = null;
	Zotero.debug(`Integration: updateDocument complete in ${diff}s`)
	// If the update takes longer than 5s suggest delaying citation updates
	if (diff > DELAY_CITATIONS_PROMPT_TIMEOUT && !this._session.data.prefs.dontAskDelayCitationUpdates && !this._session.data.prefs.delayCitationUpdates) {
		this._doc.activate();
		var result = this._session.displayAlert(
				Zotero.getString('integration.delayCitationUpdates.alert.text1')
					+ "\n\n"
					+ Zotero.getString('integration.delayCitationUpdates.alert.text2')
					+ "\n\n"
					+ Zotero.getString('integration.delayCitationUpdates.alert.text3'),
				DIALOG_ICON_WARNING,
				DIALOG_BUTTONS_YES_NO_CANCEL
		);
		if (result == 2) {
			this._session.data.prefs.delayCitationUpdates = true;
		}
		if (result) {
			this._session.data.prefs.dontAskDelayCitationUpdates = true;
			// yield this._session.setDocPrefs(true);
		}
	}
});

/**
 * Helper function to update bibliographys and fields within a document
 * @param {Boolean} forceCitations Whether to regenerate all citations
 * @param {Boolean} forceBibliography Whether to regenerate all bibliography entries
 * @param {Boolean} [ignoreCitationChanges] Whether to ignore changes to citations that have been
 *	modified since they were created, instead of showing a warning
 */
Zotero.Integration.Fields.prototype._updateDocument = async function(forceCitations, forceBibliography,
		ignoreCitationChanges) {
	if(this.progressCallback) {
		var nFieldUpdates = Object.keys(this._session.updateIndices).length;
		if(this._session.bibliographyHasChanged || forceBibliography) {
			nFieldUpdates += this._bibliographyFields.length*5;
		}
	}

	var nUpdated=0;
	for(var i in this._session.updateIndices) {
		if(this.progressCallback && nUpdated % 10 == 0) {
			try {
				this.progressCallback(75+(nUpdated/nFieldUpdates)*25);
			} catch(e) {
				Zotero.logError(e);
			}
		}
		// Jump to next event loop step for UI updates
		await Zotero.Promise.delay();

		var citation = this._session.citationsByIndex[i];
		let citationField = citation._field;

		var isRich = false;
		if (!citation.properties.dontUpdate) {
			var formattedCitation = citation.properties.custom
				? citation.properties.custom : citation.text;
			var plainCitation = citation.properties.plainCitation && citationField.getText();

			// Update citation text:
			// If we're not specifically *not* trying to regen text
			if (forceCitations != FORCE_CITATIONS_FALSE
					// Or metadata has changed thus changing the formatted citation
					|| (citation.properties.formattedCitation !== formattedCitation)
					// Or we shouldn't ignore citation changes and the citation text has changed
					|| (!ignoreCitationChanges && plainCitation !== citation.properties.plainCitation)) {

				if (plainCitation !== citation.properties.plainCitation) {
					// Citation manually modified; ask user if they want to save changes
					Zotero.debug("[_updateDocument] Attempting to update manually modified citation.\n"
						+ "Original: " + citation.properties.plainCitation + "\n"
						+ "Current:  " + plainCitation
					);
					citationField.select();
					var result = this._session.displayAlert(
						Zotero.getString("integration.citationChanged")+"\n\n"+Zotero.getString("integration.citationChanged.description"),
						DIALOG_ICON_CAUTION, DIALOG_BUTTONS_YES_NO);
					if (result) {
						citation.properties.dontUpdate = true;
					}
				}

				if(!citation.properties.dontUpdate) {
					// Word will preserve previous text styling, so we need to force remove it
					// for citations that were inserted with delay styling
					if (citation.properties.formattedCitation && citation.properties.formattedCitation.includes(DELAYED_CITATION_STYLING)) {
						isRich = citationField.setText(`${DELAYED_CITATION_STYLING_CLEAR}{${formattedCitation}}`);
					} else {
						isRich = citationField.setText(formattedCitation);
					}

					citation.properties.formattedCitation = formattedCitation;
					citation.properties.plainCitation = citationField.getText();
				}
			}
		}

		var serializedCitation = citation.serialize();
		if (serializedCitation != citation.properties.field) {
			citationField.setCode(serializedCitation);
			if (this._session.data.prefs.fieldType === "ReferenceMark"
					&& this._session.data.prefs.noteType != 0 && isRich
					&& !citation.properties.dontUpdate) {
				// For ReferenceMarks with formatting, we need to set the text again, because
				// setting the field code removes formatting from the mark. I don't like this.
				citationField.setText(formattedCitation, isRich);
			}
		}
		nUpdated++;
	}

	// update bibliographies
	if (this._session.bibliography	 				// if bibliography exists
			&& (this._session.bibliographyHasChanged	// and bibliography changed
			|| forceBibliography)) {					// or if we should generate regardless of
														// changes

		if (forceBibliography || this._session.bibliographyDataHasChanged) {
			let code = this._session.bibliography.serialize();
			for (let field of this._bibliographyFields) {
				field.setCode(code);
			}
		}

		// get bibliography and format as RTF
		var bib = this._session.bibliography.getCiteprocBibliography(this._session.style);

		var bibliographyText = "";
		if (bib) {
			bibliographyText = bib[0].bibstart+bib[1].join("\\\r\n")+"\\\r\n"+bib[0].bibend;

			// if bibliography style not set, set it
			if(!this._session.data.style.bibliographyStyleHasBeenSet) {
				var bibStyle = Zotero.Cite.getBibliographyFormatParameters(bib);

				// set bibliography style
				this._doc.setBibliographyStyle(bibStyle.firstLineIndent, bibStyle.indent,
					bibStyle.lineSpacing, bibStyle.entrySpacing, bibStyle.tabStops, bibStyle.tabStops.length);

				// set bibliographyStyleHasBeenSet parameter to prevent further changes
				this._session.data.style.bibliographyStyleHasBeenSet = true;
			}
		}

		// set bibliography text
		for (let field of this._bibliographyFields) {
			if(this.progressCallback) {
				try {
					this.progressCallback(75+(nUpdated/nFieldUpdates)*25);
				} catch(e) {
					Zotero.logError(e);
				}
			}
			// Jump to next event loop step for UI updates
			await Zotero.Promise.delay();

			if (bibliographyText) {
				field.setText(bibliographyText);
			} else {
				field.setText("{Bibliography}");
			}
			nUpdated += 5;
		}
	}

	// Do these operations in reverse in case plug-ins care about order
	var removeCodeFields = Object.keys(this._removeCodeFields).sort();
	for (var i=(removeCodeFields.length-1); i>=0; i--) {
		this._fields[removeCodeFields[i]].removeCode();
	}

	// Update projectName tags on Zotero-side
	var projectName = this._session.data.prefs.projectName;
	var extractingLibraryID = this._session.data.prefs.extractingLibraryID;
	var extractingLibraryName = this._session.data.prefs.extractingLibraryName;

	// Act only if the document defines a projectName
	if (projectName) {

		// If a project name has only one associated document, we may
		// want to purge the tag from all libraries where it might have
		// on each update.

		//var sql = 'SELECT tagID FROM tags WHERE type=10000 AND name=?;';
		//var tagIDs = Zotero.DB.columnQuery(sql,[projectName]);
		//Zotero.Tags.erase(tagIDs);
		//Zotero.Tags.purge(tagIDs);

		// Set the document projectName tag on each cited reference
		var libraryTagMap = {};
		var ids = this._session.style.registry.getSortedIds();
		var existingIDs = Zotero.Items.exist(ids);
		//var nonexistingIDs = ids.filter(function(x){return existingIDs.indexOf(x) == -1});
		for (var i=0,ilen=existingIDs.length;i<ilen;i+=1) {

			var itemID = existingIDs[i];
			// We can't get the libraryID from the processor registry
			var libraryID = Zotero.Items.get(itemID).libraryID;

			if (!libraryTagMap[libraryID]) {
				// Reuse an existing project name if we can
				var existingTagID = Zotero.Tags.getID(projectName, 10000, libraryID);
				if (existingTagID) {
					libraryTagMap[libraryID] = Zotero.Tags.get(existingTagID);
				} else {
					libraryTagMap[libraryID] = new Zotero.Tag;
					libraryTagMap[libraryID].libraryID = libraryID;
					libraryTagMap[libraryID].name = projectName;
					libraryTagMap[libraryID].type = 10000;
					libraryTagMap[libraryID].save();
				}
			}
			libraryTagMap[libraryID].addItem(itemID);
		}
		//for (var i=0,ilen=nonexistingIDs.length;i<ilen;i+=1) {
		//	var id = nonexistingIDs[i];
		//	Zotero.debug('MLZ: NONEXISTING embedded item: '+JSON.stringify(this._session.style.registry.registry[id].ref));
		//}
		//for (var i=0,ilen=existingIDs.length;i<ilen;i+=1) {
		//	var id = existingIDs[i];
		//	Zotero.debug('MLZ: EXISTING embedded item: '+JSON.stringify(this._session.style.registry.registry[id].ref));
		//}
		for (var libraryID in libraryTagMap) {
			libraryTagMap[libraryID].save(true);
		}
	}
}

/**
 * Brings up the addCitationDialog, prepopulated if a citation is provided
 */
Zotero.Integration.Fields.prototype.addEditCitation = Zotero.Promise.coroutine(function* (field) {
	var newField;

	if (field) {
		field = Zotero.Integration.Field.loadExisting(field);

		if (field.type != INTEGRATION_TYPE_ITEM) {
			throw new Zotero.Exception.Alert("integration.error.notInCitation");
		}
	} else {
		newField = true;
		field = new Zotero.Integration.CitationField(yield this.addField(true));
		field.clearCode();
	}

	var citation = new Zotero.Integration.Citation(field);
	yield citation.prepareForEditing();

	// -------------------
	// Preparing stuff to pass into CitationEditInterface
	var fields = yield this.get();
	for (var fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
		if (fields[fieldIndex].equals(field._field)) {
			// This is needed, because LibreOffice integration plugin caches the field code instead of asking
			// the document every time when calling #getCode().
			fields[fieldIndex] = field._field;
			break;
		}
	}

	var citationsByItemIDPromise;
	if (this._session.data.prefs.delayCitationUpdates) {
		citationsByItemIDPromise = Zotero.Promise.resolve(this._session.citationsByItemID);
	} else {
		citationsByItemIDPromise = this.updateSession(FORCE_CITATIONS_FALSE).then(function() {
			return this._session.citationsByItemID;
		}.bind(this));
	}

	var previewFn = Zotero.Promise.coroutine(function* (citation) {
		yield citationsByItemIDPromise;

		let citations = this._session.getCiteprocLists();
		let citationsPre = citations.slice(0, fieldIndex);
		let citationsPost = citations.slice(fieldIndex+1);
		try {
			return this._session.style.previewCitationCluster(citation, citationsPre, citationsPost, "rtf");
		} catch(e) {
			throw e;
		}
	}.bind(this));

	var io = new Zotero.Integration.CitationEditInterface(
		citation, this._session.style.opt.sort_citations,
		fieldIndex, citationsByItemIDPromise, previewFn
	);

	if (Zotero.Prefs.get("integration.useClassicAddCitationDialog")) {
		Zotero.Integration.displayDialog('chrome://zotero/content/integration/addCitationDialog.xul',
			'alwaysRaised,resizable', io);
	} else {
		var mode = (!Zotero.isMac && Zotero.Prefs.get('integration.keepAddCitationDialogRaised')
			? 'popup' : 'alwaysRaised')+',resizable=false';
		Zotero.Integration.displayDialog('chrome://zotero/content/integration/quickFormat.xul',
			mode, io);
	}

	// -------------------
	// io.promise resolves when the citation dialog is closed
	this.progressCallback = yield io.promise;

	if (!io.citation.citationItems.length) {
		// Try to delete new field on cancel
		if (newField) {
			try {
				yield field.delete();
			} catch(e) {}
		}
		throw new Zotero.Exception.UserCancelled("inserting citation");
	}

	this._session.updateIndices[fieldIndex] = true;
	// Make sure session is updated
	yield citationsByItemIDPromise;
	return [fieldIndex, field, io.citation];
});

/**
 * Citation editing functions and propertiesaccessible to quickFormat.js and addCitationDialog.js
 */
Zotero.Integration.CitationEditInterface = function(citation, sortable, fieldIndex, citationsByItemIDPromise, previewFn) {
	this.citation = citation;
	this.sortable = sortable;
	this.previewFn = previewFn;
	this._fieldIndex = fieldIndex;
	this._citationsByItemIDPromise = citationsByItemIDPromise;

	// Not available in quickFormat.js if this unspecified
	this.wrappedJSObject = this;

	this._acceptDeferred = Zotero.Promise.defer();
	this.promise = this._acceptDeferred.promise;
}

Zotero.Integration.CitationEditInterface.prototype = {
	/**
	 * Execute a callback with a preview of the given citation
	 * @return {Promise} A promise resolved with the previewed citation string
	 */
	"preview":function preview() {
		var me = this;
		return this._updateSession().then(function* () {
			if (Zotero.CiteProc.CSL.preloadAbbreviations) {
				yield Zotero.CiteProc.CSL.preloadAbbreviations(this.style.opt.styleID, this.style.transform.abbrevs, me.citation);
			}
			me.citation.properties.zoteroIndex = me._fieldIndex;
			me.citation.properties.noteIndex = me._field.getNoteIndex();
			return yield me._session.previewCitation(me.citation);
		});
	},

	/**
	 * Sort the citationItems within citation (depends on this.citation.properties.unsorted)
	 * @return {Promise} A promise resolved with the previewed citation string
	 */
	sort: function() {
		return this.preview();
	},

	/**
	 * Accept changes to the citation
	 * @param {Function} [progressCallback] A callback to be run when progress has changed.
	 *     Receives a number from 0 to 100 indicating current status.
	 */
	accept: function(progressCallback) {
		if (!this._acceptDeferred.promise.isFulfilled()) {
			this._acceptDeferred.resolve(progressCallback);
		}
	},

	/**
	 * Get a list of items used in the current document
	 * @return {Promise} A promise resolved by the items
	 */
	getItems: Zotero.Promise.coroutine(function* () {
		var citationsByItemID = yield this._citationsByItemIDPromise;
		var ids = Object.keys(citationsByItemID).filter(itemID => {
			return citationsByItemID[itemID]
				&& citationsByItemID[itemID].length
				// Exclude the present item
				&& (citationsByItemID[itemID].length > 1
					|| citationsByItemID[itemID][0].properties.zoteroIndex !== this._fieldIndex);
		});

		// Sort all previously cited items at top, and all items cited later at bottom
		ids.sort(function(a, b) {
			var indexA = citationsByItemID[a][0].properties.zoteroIndex,
				indexB = citationsByItemID[b][0].properties.zoteroIndex;

			if(indexA >= this._fieldIndex){
				if(indexB < this._fieldIndex) return 1;
				return indexA - indexB;
			}

			if(indexB > this._fieldIndex) return -1;
			return indexB - indexA;
		});

		return Zotero.Cite.getItem(ids);
	}),
}

/**
 * Keeps track of all session-specific variables
 */
Zotero.Integration.Session = function(doc, app) {
	this.embeddedItems = {};
	this.embeddedZoteroItems = {};

	this.embeddedItemsByURI = {};
	this.embeddedZoteroItemsByURI = {};
	this.extractedItems = {};
	this.customBibliographyText = {};
	this.reselectedItems = {};

	this.resetRequest(doc);
	this.primaryFieldType = app.primaryFieldType;
	this.secondaryFieldType = app.secondaryFieldType;

	this.sessionID = Zotero.randomString();
	Zotero.Integration.sessions[this.sessionID] = this;
}

/**
 * Resets per-request variables in the CitationSet
 */
Zotero.Integration.Session.prototype.resetRequest = function(doc) {
	this.uriMap = new Zotero.Integration.URIMap(this);

	this.bibliographyHasChanged = false;
	this.bibliographyDataHasChanged = false;
	this.updateIndices = {};
	this.newIndices = {};

	this.citationsByItemID = {};
	this.citationsByIndex = {};
	this.documentCitationIDs = {};

	this._doc = doc;
}

/**
 * Prepares session data and displays docPrefs dialog if needed
 * @param require {Boolean} Whether an error should be thrown if no preferences or fields
 *     exist (otherwise, the set doc prefs dialog is shown)
 * @param dontRunSetDocPrefs {Boolean} Whether to show the Document Preferences window if no preferences exist
 * @return {Promise{Boolean}} true if session ready to, false if preferences dialog needs to be displayed first
 */
Zotero.Integration.Session.prototype.init = Zotero.Promise.coroutine(function *(require, dontRunSetDocPrefs) {
	var data = this.data;
	// If no data, show doc prefs window
	if (!data.prefs.fieldType) {
		var haveFields = false;
		data = new Zotero.Integration.DocumentData();

		if (require) {
			// check to see if fields already exist
			for (let fieldType of [this.primaryFieldType, this.secondaryFieldType]) {
				var fields = this._doc.getFields(fieldType);
				if (fields.hasMoreElements()) {
					data.prefs.fieldType = fieldType;
					haveFields = true;
					break;
				}
			}

			// if no fields, throw an error
			if (!haveFields) {
				return Zotero.Promise.reject(new Zotero.Exception.Alert(
				"integration.error.mustInsertCitation",
				[], "integration.error.title"));
			} else {
				Zotero.debug("Integration: No document preferences found, but found "+data.prefs.fieldType+" fields");
			}
		}

		if (haveFields && !Object.keys(this.citationsByIndex).length) {
			// We should load up the fields on the first interaction with the document, so
			// that we can display a list of existing citations, etc.
			yield this.fields.get();
			yield this.fields.updateSession(FORCE_CITATIONS_FALSE);
		}

		if (dontRunSetDocPrefs) return false;

		yield this.setDocPrefs();
	}
	if (!Object.keys(this.citationsByIndex).length) {
		// We should load up the fields on the first interaction with the document, so
		// that we can display a list of existing citations, etc.
		yield this.fields.get();
		yield this.fields.updateSession(FORCE_CITATIONS_FALSE);
	}
	return true;
});

Zotero.Integration.Session.prototype.displayAlert = function() {
	if (this.timer) {
		this.timer.pause();
	}
	var result = this._doc.displayAlert.apply(this._doc, arguments);
	if (this.timer) {
		this.timer.resume();
	}
	return result;
}

/**
 * Changes the Session style and data
 * @param data {Zotero.Integration.DocumentData}
 * @param resetStyle {Boolean} Whether to force the style to be reset
 *     regardless of whether it has changed. This is desirable if the
 *     automaticJournalAbbreviations or locale has changed.
 */
Zotero.Integration.Session.prototype.setData = Zotero.Promise.coroutine(function *(data, resetStyle) {
	var oldStyle = (this.data && this.data.style ? this.data.style : false);
	this.data = data;
	this.data.sessionID = this.sessionID;
	if (data.style.styleID && (!oldStyle || oldStyle.styleID != data.style.styleID || resetStyle)) {
		// We're changing the citeproc instance, so we'll have to reinsert all citations into the registry
		this.reload = true;
		this.styleID = data.style.styleID;
		try {
			yield Zotero.Styles.init();
			var getStyle = Zotero.Styles.get(data.style.styleID);
			data.style.hasBibliography = getStyle.hasBibliography;
			this.style = getStyle.getCiteProc(data.style.locale, data.prefs.automaticJournalAbbreviations);
			this.style.setOutputFormat("rtf");
			this.styleClass = getStyle.class;
			this.dateModified = new Object();
			this.style.setLangTagsForCslTransliteration(data.prefs.citationTransliteration);
			this.style.setLangTagsForCslTranslation(data.prefs.citationTranslation);
			this.style.setLangTagsForCslSort(data.prefs.citationSort);
			this.style.setLangPrefsForCites(data.prefs, function(key){return 'citationLangPrefs'+key});
			this.style.setLangPrefsForCiteAffixes(data.prefs.citationAffixes);
		} catch(e) {
			Zotero.logError(e);
			throw new Zotero.Exception.Alert("integration.error.invalidStyle");
		}

		return true;
	} else if (oldStyle) {
		data.style = oldStyle;
	}
	return false;
});

/**
 * Displays a dialog to set document preferences
 * @return {Promise} A promise resolved with old document data, if there was any or null,
 *    if there wasn't, or rejected with Zotero.Exception.UserCancelled if the dialog was
 *    cancelled.
 */
Zotero.Integration.Session.prototype.setDocPrefs = Zotero.Promise.coroutine(function* (highlightDelayCitations=false) {
	var io = new function() { this.wrappedJSObject = this; };
	io.primaryFieldType = this.primaryFieldType;
	io.secondaryFieldType = this.secondaryFieldType;

	if (this.data) {
		io.style = this.data.style.styleID;
		io.locale = this.data.style.locale;
		io.useEndnotes = this.data.prefs.noteType == 0 ? 0 : this.data.prefs.noteType-1;
		io.fieldType = this.data.prefs.fieldType;
		io.delayCitationUpdates = this.data.prefs.delayCitationUpdates;
		io.dontAskDelayCitationUpdates = this.data.prefs.dontAskDelayCitationUpdates;
		io.highlightDelayCitations = highlightDelayCitations;
		io.automaticJournalAbbreviations = this.data.prefs.automaticJournalAbbreviations;
		io.requireStoreReferences = !Zotero.Utilities.isEmpty(this.embeddedItems);
		io.citationTransliteration = this.data.prefs.citationTransliteration;
		io.citationTranslation = this.data.prefs.citationTranslation;
		io.citationSort = this.data.prefs.citationSort;
		io.citationLangPrefsPersons = this.data.prefs.citationLangPrefsPersons;
		io.citationLangPrefsInstitutions = this.data.prefs.citationLangPrefsInstitutions;
		io.citationLangPrefsTitles = this.data.prefs.citationLangPrefsTitles;
		io.citationLangPrefsJournals = this.data.prefs.citationLangPrefsJournals;
		io.citationLangPrefsPublishers = this.data.prefs.citationLangPrefsPublishers;
		io.citationLangPrefsPlaces = this.data.prefs.citationLangPrefsPlaces;
		io.citationAffixes = this.data.prefs.citationAffixes;
		io.projectName = this.data.prefs.projectName;
		io.extractingLibraryID = this.data.prefs.extractingLibraryID;
		io.extractingLibraryName = this.data.prefs.extractingLibraryName;
		io.suppressTrailingPunctuation = this.data.prefs.suppressTrailingPunctuation;
	}


	// Make sure styles are initialized for new docs
	yield Zotero.Styles.init();
	yield Zotero.Integration.displayDialog('chrome://zotero/content/integration/integrationDocPrefs.xul', '', io);

		// set data
		var me = this;
		var oldData = me.data;
		var data = new Zotero.Integration.DocumentData();
		data.sessionID = oldData.sessionID;
		data.style.styleID = io.style;
		data.style.locale = io.locale;
		data.prefs.fieldType = io.fieldType;
		data.prefs.storeReferences = io.storeReferences;
		data.prefs.extractingLibraryID = io.extractingLibraryID;
		data.prefs.extractingLibraryName = io.extractingLibraryName;
		data.prefs.automaticJournalAbbreviations = io.automaticJournalAbbreviations;

		var forceStyleReset = oldData
			&& (
				oldData.prefs.automaticJournalAbbreviations != data.prefs.automaticJournalAbbreviations
				|| oldData.style.locale != io.locale
			);
		me.setData(data, forceStyleReset);

		// need to do this after setting the data so that we know if it's a note style
		me.data.prefs.noteType = me.style && me.styleClass == "note" ? io.useEndnotes+1 : 0;

		me.data.prefs.citationTransliteration = io.citationTransliteration;
		me.data.prefs.citationTranslation = io.citationTranslation;
		me.data.prefs.citationSort = io.citationSort;
		me.data.prefs.citationLangPrefsPersons = io.citationLangPrefsPersons;
		me.data.prefs.citationLangPrefsInstitutions = io.citationLangPrefsInstitutions;
		me.data.prefs.citationLangPrefsTitles = io.citationLangPrefsTitles;
		me.data.prefs.citationLangPrefsJournals = io.citationLangPrefsJournals;
		me.data.prefs.citationLangPrefsPublishers = io.citationLangPrefsPublishers;
		me.data.prefs.citationLangPrefsPlaces = io.citationLangPrefsPlaces;
		me.data.prefs.citationAffixes = io.citationAffixes;
		me.data.prefs.projectName = io.projectName;
		me.data.prefs.suppressTrailingPunctuation = io.suppressTrailingPunctuation;

		if(!oldData || oldData.style.styleID != data.style.styleID
				|| oldData.prefs.noteType != data.prefs.noteType
				|| oldData.prefs.fieldType != data.prefs.fieldType
				|| oldData.prefs.automaticJournalAbbreviations != data.prefs.automaticJournalAbbreviations) {
			// This will cause us to regenerate all citations
			me.oldCitationIDs = {};
		}

		me.style.setLangTagsForCslTransliteration(me.data.prefs.citationTransliteration);
		me.style.setLangTagsForCslTranslation(me.data.prefs.citationTranslation);
		me.style.setLangTagsForCslSort(me.data.prefs.citationSort);
		me.style.setLangPrefsForCites(me.data.prefs, function(key){return 'citationLangPrefs'+key});
		me.style.setLangPrefsForCiteAffixes(me.data.prefs.citationAffixes);
		me.style.setSuppressTrailingPunctuation(me.data.prefs.suppressTrailingPunctuation);
		me.style.setAutoVietnameseNamesOption(Zotero.Prefs.get('csl.autoVietnameseNames'));

		return oldData || null;
	});
}

/**
 * Reselects an item to replace a deleted item
 * @param exception {Zotero.Integration.MissingItemException}
 */
Zotero.Integration.Session.prototype.reselectItem = function(doc, exception) {
	var io = new function() { this.wrappedJSObject = this; },
		me = this;
	io.addBorder = Zotero.isWin;
	io.singleSelection = true;

	return Zotero.Integration.displayDialog(doc, 'chrome://zotero/content/selectItemsDialog.xul',
	'resizable', io).then(function() {
		if(io.dataOut && io.dataOut.length) {
			var itemID = io.dataOut[0];

			// add reselected item IDs to hash, so they can be used
			for each(var reselectKey in exception.reselectKeys) {
				me.reselectedItems[reselectKey] = itemID;
			}
			// add old URIs to map, so that they will be included
			if(exception.reselectKeyType == RESELECT_KEY_URI) {
				me.uriMap.add(itemID, exception.reselectKeys.concat(me.uriMap.getURIsForItemID(itemID)));
			}
			// flag for update
			me.updateItemIDs[itemID] = true;
		}
	});
}

/**
 * Generates a field from a citation object
 */
Zotero.Integration.Session.prototype.getCitationField = function(citation) {
	const saveProperties = ["custom", "unsorted", "formattedCitation", "plainCitation", "dontUpdate",
 		"suppress-trailing-punctuation"];
	const saveCitationItemKeys = ["locator", "label", "suppress-author", "author-only", "prefix",
		"suffix"];
	var addSchema = false;

	var type;
	var field = [];
>>>>>>> Juris-M monster checkin

	if (!io.style || !io.fieldType) {
		throw new Zotero.Exception.UserCancelled("document preferences window");
	}

	// set data
	var oldData = this.data;
	var data = new Zotero.Integration.DocumentData();
	data.sessionID = oldData.sessionID;
	data.style.styleID = io.style;
	data.style.locale = io.locale;
	data.prefs = oldData ? Object.assign({}, oldData.prefs) : {};
	data.prefs.fieldType = io.fieldType;
	data.prefs.automaticJournalAbbreviations = io.automaticJournalAbbreviations;
	data.prefs.delayCitationUpdates = io.delayCitationUpdates

	var forceStyleReset = oldData
		&& (
			oldData.prefs.automaticJournalAbbreviations != data.prefs.automaticJournalAbbreviations
			|| oldData.style.locale != io.locale
		);
	yield this.setData(data, forceStyleReset);

	// need to do this after setting the data so that we know if it's a note style
	this.data.prefs.noteType = this.style && this.styleClass == "note" ? io.useEndnotes+1 : 0;

	if (!oldData || oldData.style.styleID != data.style.styleID
			|| oldData.prefs.noteType != data.prefs.noteType
			|| oldData.prefs.fieldType != data.prefs.fieldType
			|| (!data.prefs.delayCitationUpdates && oldData.prefs.delayCitationUpdates != data.prefs.delayCitationUpdates)
			|| oldData.prefs.automaticJournalAbbreviations != data.prefs.automaticJournalAbbreviations) {
		// This will cause us to regenerate all citations
		this.regenAll = true;
		this.reload = true;
	}

	return oldData || null;
})

/**
 * Adds a citation based on a serialized Word field
 */
Zotero.Integration._oldCitationLocatorMap = {
	p:"page",
	g:"paragraph",
	l:"line"
};

/**
 * Adds a citation to the arrays representing the document
 */
Zotero.Integration.Session.prototype.addCitation = Zotero.Promise.coroutine(function* (index, noteIndex, citation) {
	var index = parseInt(index, 10);

	citation.properties.added = true;
	citation.properties.zoteroIndex = index;
	citation.properties.noteIndex = noteIndex;
	this.citationsByIndex[index] = citation;

	// add to citationsByItemID and citationsByIndex
	for(var i=0; i<citation.citationItems.length; i++) {
		var citationItem = citation.citationItems[i];
		if(!this.citationsByItemID[citationItem.id]) {
			this.citationsByItemID[citationItem.id] = [citation];
			this.bibliographyHasChanged = true;
		} else {
			var byItemID = this.citationsByItemID[citationItem.id];
			if(byItemID[byItemID.length-1].properties.zoteroIndex < index) {
				// if index is greater than the last index, add to end
				byItemID.push(citation);
			} else {
				// otherwise, splice in at appropriate location
				for(var j=0; byItemID[j].properties.zoteroIndex < index && j<byItemID.length-1; j++) {}
				byItemID.splice(j++, 0, citation);
			}
		}
	}

	// We need a new ID if there's another citation with the same citation ID in this document
	var needNewID = !citation.citationID || this.documentCitationIDs[citation.citationID];
	if(needNewID || this.regenAll) {
		if(needNewID) {
			Zotero.debug("Integration: "+citation.citationID+" ("+index+") needs new citationID");
			citation.citationID = Zotero.randomString();
		}
		this.updateIndices[index] = true;
	}
	Zotero.debug("Integration: Adding citationID "+citation.citationID);
	this.documentCitationIDs[citation.citationID] = citation.citationID;
}

/**
 * Looks up item IDs to correspond with keys or generates embedded items for given citation object.
 * Throws a MissingItemException if item was not found.
 */
Zotero.Integration.Session.prototype.lookupItems = function(citation, index) {
	for(var i=0, n=citation.citationItems.length; i<n; i++) {
		var citationItem = citation.citationItems[i];

		// get Zotero item
		var zoteroItem = false,
		    needUpdate;
		if(citationItem.uris) {
			[zoteroItem, needUpdate] = this.uriMap.getZoteroItemForURIs(citationItem.uris);
			if(needUpdate && index) this.updateIndices[index] = true;

			// Unfortunately, people do weird things with their documents. One weird thing people
			// apparently like to do (http://forums.zotero.org/discussion/22262/) is to copy and
			// paste citations from other documents created with earlier versions of Zotero into
			// their documents and then not refresh the document. Usually, this isn't a problem. If
			// document is edited by the same user, it will work without incident. If the first
			// citation of a given item doesn't contain itemData, the user will get a
			// MissingItemException. However, it may also happen that the first citation contains
			// itemData, but later citations don't, because the user inserted the item properly and
			// then copied and pasted the same citation from another document. We check for that
			// possibility here.
			if(zoteroItem.cslItemData && !citationItem.itemData) {
				citationItem.itemData = zoteroItem.cslItemData;
				this.updateIndices[index] = true;
			}
		} else {
			if(citationItem.key) {
				// DEBUG: why no library id?
				zoteroItem = Zotero.Items.getByLibraryAndKey(0, citationItem.key);
			} else if(citationItem.itemID) {
				zoteroItem = Zotero.Items.get(citationItem.itemID);
			} else if(citationItem.id) {
				zoteroItem = Zotero.Items.get(citationItem.id);
			}
			if(zoteroItem && index) this.updateIndices[index] = true;
		}

		// if no item, check if it was already reselected and otherwise handle as a missing item
		if(!zoteroItem) {
			if(citationItem.uris) {
				var reselectKeys = citationItem.uris;
				var reselectKeyType = RESELECT_KEY_URI;
			} else if(citationItem.key) {
				var reselectKeys = [citationItem.key];
				var reselectKeyType = RESELECT_KEY_ITEM_KEY;
			} else if(citationItem.id) {
				var reselectKeys = [citationItem.id];
				var reselectKeyType = RESELECT_KEY_ITEM_ID;
			} else {
				var reselectKeys = [citationItem.itemID];
				var reselectKeyType = RESELECT_KEY_ITEM_ID;
			}

			// look to see if item has already been reselected
			for each(var reselectKey in reselectKeys) {
				if(this.reselectedItems[reselectKey]) {
					zoteroItem = Zotero.Items.get(this.reselectedItems[reselectKey]);
					citationItem.id = zoteroItem.id;
					if(index) this.updateIndices[index] = true;
					break;
				}
			}

			if(!zoteroItem) {
				if(citationItem.itemData) {
					// add new embedded item
					var itemData = Zotero.Utilities.deepCopy(citationItem.itemData);

					// assign a random string as an item ID
					var anonymousID = Zotero.randomString();
					var globalID = itemData.id = citationItem.id = this.data.sessionID+"/"+anonymousID;
					this.embeddedItems[anonymousID] = itemData;

					// assign a Zotero item
					var surrogateItem = this.embeddedZoteroItems[anonymousID] = new Zotero.Item();
					// true is for portableJSON (MLZ decoding)
					Zotero.Utilities.itemFromCSLJSON(surrogateItem, itemData, undefined, true);
					surrogateItem.cslItemID = globalID;
					surrogateItem.cslURIs = citationItem.uris;
					surrogateItem.cslItemData = itemData;

					// Puts encoded multi fields into Zotero item
					this.embeddedItems[anonymousID] = Zotero.Utilities.itemToCSLJSON(surrogateItem, undefined, false, false, true);
					for(var j=0, m=citationItem.uris.length; j<m; j++) {
						this.embeddedZoteroItemsByURI[citationItem.uris[j]] = surrogateItem;
					}
				} else {
					// if not already reselected, throw a MissingItemException
					throw(new Zotero.Integration.MissingItemException(
						reselectKeys, reselectKeyType, i, citation.citationItems.length));
				}
			}
		} else {
			// Cite extraction
			if (this.data.prefs.extractingLibraryID) {
				// Suspenders and a belt - if cslItemID exists, it will presumably have this form anyway
				if ("string" === typeof zoteroItem.cslItemID && zoteroItem.cslItemID.indexOf('/') > -1) {
					var oldID = zoteroItem.cslItemID;
					if (!this.extractedItems[oldID]) {
						var itemData = Zotero.Utilities.deepCopy(zoteroItem.cslItemData);
						zoteroItem = new Zotero.Item();
						// true is for portableJSON (MLZ decoding)
						Zotero.Utilities.itemFromCSLJSON(zoteroItem, itemData, this.data.prefs.extractingLibraryID, true);
						var itemID = zoteroItem.save();
						zoteroItem = Zotero.Items.get(itemID);
						this.extractedItems[oldID] = zoteroItem.id;
					} else {
						var itemID = this.extractedItems[oldID];
						zoteroItem = Zotero.Items.get(itemID);
					}
					if(index) this.updateIndices[index] = true;
				}
			}
		}

		if(zoteroItem) {
			citationItem.id = zoteroItem.cslItemID ? zoteroItem.cslItemID : zoteroItem.id;
		}
	}
}

/**
 * Unserializes a JSON citation into a citation object (sans items)
 */
Zotero.Integration.Session.prototype.unserializeCitation = function(arg, index) {
	var firstBracket = arg.indexOf("{");
	if(firstBracket !== -1) {		// JSON field
		arg = arg.substr(firstBracket);

		// fix for corrupted fields
		var lastBracket = arg.lastIndexOf("}");
		if(lastBracket+1 != arg.length) {
			if(index) this.updateIndices[index] = true;
			arg = arg.substr(0, lastBracket+1);
		}

		// get JSON
		try {
			var citation = JSON.parse(arg);
		} catch(e) {
			// fix for corrupted fields (corrupted by Word, somehow)
			try {
				var citation = JSON.parse(arg.substr(0, arg.length-1));
			} catch(e) {
				// another fix for corrupted fields (corrupted by 2.1b1)
				try {
					var citation = JSON.parse(arg.replace(/{{((?:\s*,?"unsorted":(?:true|false)|\s*,?"custom":"(?:(?:\\")?[^"]*\s*)*")*)}}/, "{$1}"));
				} catch(e) {
					throw new Zotero.Integration.CorruptFieldException(arg, e);
				}
			}
		}

		// fix for uppercase citation codes
		if(citation.CITATIONITEMS) {
			if(index) this.updateIndices[index] = true;
			citation.citationItems = [];
			for (var i=0; i<citation.CITATIONITEMS.length; i++) {
				for (var j in citation.CITATIONITEMS[i]) {
					switch (j) {
						case 'ITEMID':
							var field = 'itemID';
							break;

						// 'position', 'custom'
						default:
							var field = j.toLowerCase();
					}
					if (!citation.citationItems[i]) {
						citation.citationItems[i] = {};
					}
					citation.citationItems[i][field] = citation.CITATIONITEMS[i][j];
				}
			}
		}

		if(!citation.properties) citation.properties = {};

		for each(var citationItem in citation.citationItems) {
			// for upgrade from Zotero 2.0 or earlier
			if(citationItem.locatorType) {
				citationItem.label = citationItem.locatorType;
				delete citationItem.locatorType;
			} else if(citationItem.suppressAuthor) {
				citationItem["suppress-author"] = citationItem["suppressAuthor"];
				delete citationItem.suppressAuthor;
			}

			// fix for improper upgrade from Zotero 2.1 in <2.1.5
			if(parseInt(citationItem.label) == citationItem.label) {
				const locatorTypeTerms = ["page", "book", "chapter", "column", "figure", "folio",
					"issue", "line", "note", "opus", "paragraph", "part", "section", "sub verbo",
					"volume", "verse"];
				citationItem.label = locatorTypeTerms[parseInt(citationItem.label)];
			}

			// for update from Zotero 2.1 or earlier
			if(citationItem.uri) {
				citationItem.uris = citationItem.uri;
				delete citationItem.uri;
			}
		}

		// for upgrade from Zotero 2.0 or earlier
		if(citation.sort) {
			citation.properties.unsorted = !citation.sort;
			delete citation.sort;
		}
		if(citation.custom) {
			citation.properties.custom = citation.custom;
			delete citation.custom;
		}
		if(!citation.citationID) citation.citationID = Zotero.randomString();

		citation.properties.field = arg;
	} else {				// ye olde style field
		var underscoreIndex = arg.indexOf("_");
		var itemIDs = arg.substr(0, underscoreIndex).split("|");

		var lastIndex = arg.lastIndexOf("_");
		if(lastIndex != underscoreIndex+1) {
			var locatorString = arg.substr(underscoreIndex+1, lastIndex-underscoreIndex-1);
			var locators = locatorString.split("|");
		}

		var citationItems = new Array();
		for(var i=0; i<itemIDs.length; i++) {
			var citationItem = {id:itemIDs[i]};
			if(locators) {
				citationItem.locator = locators[i].substr(1);
				citationItem.label = Zotero.Integration._oldCitationLocatorMap[locators[i][0]];
			}
			citationItems.push(citationItem);
		}

		var citation = {"citationItems":citationItems, properties:{}};
		if(index) this.updateIndices[index] = true;
	}

	return citation;
}

/**
 * Gets integration bibliography
 */
Zotero.Integration.Session.prototype.getBibliography = function() {
	this.updateUncitedItems();

	if(Zotero.Utilities.isEmpty(this.citationsByItemID)) return false;

	// generate bibliography
	var bib = this.style.makeBibliography();

	if(bib) {
		// omit items
		Zotero.Cite.removeFromBibliography(bib, this.omittedItems);

		// replace items with their custom counterpars
		for(var i in bib[0].entry_ids) {
			if(this.customBibliographyText[bib[0].entry_ids[i]]) {
				bib[1][i] = this.customBibliographyText[bib[0].entry_ids[i]];
			}
		}
	}

	return bib;
}

/**
 * Calls CSL.Engine.updateUncitedItems() to reconcile list of uncited items
 */
Zotero.Integration.Session.prototype.updateUncitedItems = function() {
	// There appears to be a bug somewhere here.
	if(Zotero.Debug.enabled) Zotero.debug("Integration: style.updateUncitedItems("+this.uncitedItems.toSource()+")");
	this.style.updateUncitedItems(Object.keys(this.uncitedItems).map(i => parseInt(i)));
}

/**
 * Refreshes updateIndices variable to include fields for modified items
 */
Zotero.Integration.Session.prototype.updateUpdateIndices = function(regenerateAll) {
	if(regenerateAll || this.regenerateAll) {
		// update all indices
		for(var i in this.citationsByIndex) {
			this.newIndices[i] = true;
			this.updateIndices[i] = true;
		}
	} else {
		// update only item IDs
		for(var i in this.updateItemIDs) {
			if(this.citationsByItemID[i] && this.citationsByItemID[i].length) {
				for(var j=0; j<this.citationsByItemID[i].length; j++) {
					this.updateIndices[this.citationsByItemID[i][j].properties.zoteroIndex] = true;
				}
			}
		}
	}
}

/**
 * Returns citations before and after a given index
 */
Zotero.Integration.Session.prototype._getPrePost = function(index) {
	var citationIndices = [];
	var citationsPre = [];
	for(var i=0; i<index; i++) {
		if(this.citationsByIndex[i] && !this.newIndices[i] && !this.citationsByIndex[i].properties.delete) {
			citationsPre.push([this.citationsByIndex[i].citationID, this.citationsByIndex[i].properties.noteIndex]);
			citationIndices.push(i);
		}
	}
	citationIndices.push(index);
	var citationsPost = [];
	for(var i=index+1; i<this.citationsByIndex.length; i++) {
		if(this.citationsByIndex[i] && !this.newIndices[i] && !this.citationsByIndex[i].properties.delete) {
			citationsPost.push([this.citationsByIndex[i].citationID, this.citationsByIndex[i].properties.noteIndex]);
			citationIndices.push(i);
		}
	}
	return [citationsPre, citationsPost, citationIndices];
}

/**
 * Returns a formatted citation
 */
Zotero.Integration.Session.prototype.formatCitation = Zotero.Promise.coroutine(function* (index, citation) {
	if(!this.citationText[index]) {
		var citationsPre, citationsPost, citationIndices;
		[citationsPre, citationsPost, citationIndices] = this._getPrePost(index);
		if(Zotero.Debug.enabled) {
			Zotero.debug("Integration: style.processCitationCluster("+citation.toSource()+", "+citationsPre.toSource()+", "+citationsPost.toSource());
		}
		if (Zotero.CiteProc.CSL.preloadAbbreviations) {
			yield Zotero.CiteProc.CSL.preloadAbbreviations(this.style.opt.styleID, this.style.transform.abbrevs, citation);
		}
		var newCitations = this.style.processCitationCluster(citation, citationsPre, citationsPost);
		for each(var newCitation in newCitations[1]) {
			this.citationText[citationIndices[newCitation[0]]] = newCitation[1];
			this.updateIndices[citationIndices[newCitation[0]]] = true;
		}
		return newCitations.bibchange;
	}
});

/**
 * Updates the list of citations to be serialized to the document
 */
Zotero.Integration.Session.prototype._updateCitations = async function () {
	Zotero.debug("Integration: Indices of new citations");
	Zotero.debug(Object.keys(this.newIndices));
	Zotero.debug("Integration: Indices of updated citations");
	Zotero.debug(Object.keys(this.updateIndices));

	var citations = this.getCiteprocLists();

	for (let indexList of [this.newIndices, this.updateIndices]) {
		for (let index in indexList) {
			// Jump to next event loop step for UI updates
			await Zotero.Promise.delay();
			index = parseInt(index);

			var citation = this.citationsByIndex[index];
			if(!citation || citation.properties.delete) continue;
			if(yield this.formatCitation(index, citation)) {
				this.bibliographyHasChanged = true;
			}

			delete this.newIndices[index];
		}
	}
}

/**
 * Restores processor state from document, without requesting citation updates
 */
Zotero.Integration.Session.prototype.restoreProcessorState = function() {
	if (this.fields._bibliographyFields.length && !this.bibliography) {
		throw new Error ("Attempting to restore processor state without loading bibliography");
	}
	let uncited = [];
	if (this.bibliography) {
		uncited = Array.from(this.bibliography.uncitedItemIDs.values());
	}

	var citations = [];
	for(var i in this.citationsByIndex) {
		if(this.citationsByIndex[i] && !this.newIndices[i]) {
			citations.push(this.citationsByIndex[i]);
		}
	}
	this.style.rebuildProcessorState(citations, 'rtf', uncited);
}


Zotero.Integration.Session.prototype.writeDelayedCitation = Zotero.Promise.coroutine(function* (idx, field, citation) {
	try {
		var text = citation.properties.custom || this.style.previewCitationCluster(citation, [], [], "rtf");
	} catch(e) {
		throw e;
	}
	text = `${DELAYED_CITATION_STYLING}{${text}}`;

	// Make sure we'll prompt for manually edited citations
	var isRich = false;
	if(!citation.properties.dontUpdate) {
		isRich = field.setText(text);

		citation.properties.formattedCitation = text;
		citation.properties.plainCitation = field.getText();
	}

	field.setCode(citation.serialize());
	if (this.data.prefs.fieldType === "ReferenceMark"
			&& this.data.prefs.noteType != 0 && isRich
			&& !citation.properties.dontUpdate) {
		// For ReferenceMarks with formatting, we need to set the text again, because
		// setting the field code removes formatting from the mark. I don't like this.
		field.setText(text, isRich);
	}

	// Update bibliography with a static string
	var fields = yield this.fields.get();
	var bibliographyField;
	for (let i = fields.length-1; i >= 0; i--) {
		let field = Zotero.Integration.Field.loadExisting(fields[i]);
		if (field.type == INTEGRATION_TYPE_BIBLIOGRAPHY) {
			field.setText(Zotero.getString('integration.delayCitationUpdates.bibliography'), false)
			break;
		}
	}

});


Zotero.Integration.Session.prototype.getItems = function() {
	return Zotero.Cite.getItem(Object.keys(this.citationsByItemID), true);
}


/**
 * Edits integration bibliography
 * @param {Zotero.Integration.Bibliography} bibliography
 */
Zotero.Integration.Session.prototype.editBibliography = Zotero.Promise.coroutine(function *(bibliography) {
	if (!Object.keys(this.citationsByIndex).length) {
		throw new Error('Integration.Session.editBibliography: called without loaded citations');
	}
	yield bibliography.loadItemData();

	var bibliographyEditor = new Zotero.Integration.BibliographyEditInterface(bibliography, this.citationsByItemID, this.style);

	yield Zotero.Integration.displayDialog('chrome://zotero/content/integration/editBibliographyDialog.xul', 'resizable', bibliographyEditor);
	if (bibliographyEditor.cancelled) throw new Zotero.Exception.UserCancelled("bibliography editing");

	this.bibliographyDataHasChanged = this.bibliographyHasChanged = true;
	this.bibliography = bibliographyEditor.bibliography;
});

/**
 * @class Interface for bibliography editor to alter document bibliography
 * @constructor
 * Creates a new bibliography editor interface
 * @param bibliography {Zotero.Integration.Bibliography}
 */
Zotero.Integration.BibliographyEditInterface = function(bibliography, citationsByItemID, citeproc) {
	this.bibliography = bibliography;
	this.citeproc = citeproc;
	this.wrappedJSObject = this;
	this._citationsByItemID = citationsByItemID;
	this._update();
}

Zotero.Integration.BibliographyEditInterface.prototype._update = Zotero.Promise.coroutine(function* () {
	this.bib = this.bibliography.getCiteprocBibliography(this.citeproc);
});

/**
 * Reverts the text of an individual bibliography entry
 */
Zotero.Integration.BibliographyEditInterface.prototype.revert = function(itemID) {
	delete this.bibliography.customEntryText[itemID];
	return this._update();
}

/**
 * Reverts bibliography to condition in which no edits have been made
 */
Zotero.Integration.BibliographyEditInterface.prototype.revertAll = Zotero.Promise.coroutine(function* () {
	this.bibliography.customEntryText = {};
	this.bibliography.uncitedItemIDs.clear();
	this.bibliography.omittedItemIDs.clear();
	return this._update();
});

/**
 * Reverts bibliography to condition before BibliographyEditInterface was opened
 */
Zotero.Integration.BibliographyEditInterface.prototype.cancel = function() {
	this.cancelled = true;
};

/**
 * Checks whether a given reference is cited within the main document text
 */
Zotero.Integration.BibliographyEditInterface.prototype.isCited = function(item) {
	return this._citationsByItemID[item];
}

/**
 * Checks whether an item ID is cited in the bibliography being edited
 */
Zotero.Integration.BibliographyEditInterface.prototype.isEdited = function(itemID) {
	return itemID in this.bibliography.customEntryText;
}

/**
 * Checks whether any citations in the bibliography have been edited
 */
Zotero.Integration.BibliographyEditInterface.prototype.isAnyEdited = function() {
	return Object.keys(this.bibliography.customEntryText).length ||
		this.bibliography.uncitedItemIDs.size ||
		this.bibliography.omittedItemIDs.size;
}

/**
 * Adds an item to the bibliography
 */
Zotero.Integration.BibliographyEditInterface.prototype.add = function(itemID) {
	if (itemID in this.bibliography.omittedItemIDs) {
		this.bibliography.omittedItemIDs.delete(`${itemID}`);
	} else {
		this.bibliography.uncitedItemIDs.add(`${itemID}`);
	}
	return this._update();
}

/**
 * Removes an item from the bibliography being edited
 */
Zotero.Integration.BibliographyEditInterface.prototype.remove = function(itemID) {
	if (itemID in this.bibliography.uncitedItemIDs) {
		this.bibliography.uncitedItemIDs.delete(`${itemID}`);
	} else {
		this.bibliography.omittedItemIDs.add(`${itemID}`);
	}
	return this._update();
}

/**
 * Sets custom bibliography text for a given item
 */
Zotero.Integration.BibliographyEditInterface.prototype.setCustomText = function(itemID, text) {
	this.bibliography.customEntryText[itemID] = text;
	return this._update();
}

/**
 * A class for parsing and passing around document-specific data
 */
Zotero.Integration.DocumentData = function(string) {
	this.style = {};
	this.prefs = {};
	this.prefs.citationTransliteration = [];
	this.prefs.citationTranslation = [];
	this.prefs.citationSort = [];
	this.prefs.citationLangPrefsPersons = [];
	this.prefs.citationLangPrefsInstitutions = [];
	this.prefs.citationLangPrefsTitles = [];
	this.prefs.citationLangPrefsJournals = [];
	this.prefs.citationLangPrefsPublishers = [];
	this.prefs.citationLangPrefsPlaces = [];
	this.prefs.citationAffixes = [,,,,,,,,,,,,,,,,,,];
	this.prefs.projectName = '';
	this.prefs.extractingLibraryID = 0;
	this.prefs.extractingLibraryName = '';
	this.sessionID = null;
	if (string) {
		this.unserialize(string);
	}
}

/**
 * Serializes document-specific data as JSON
 */
Zotero.Integration.DocumentData.prototype.serialize = function() {
	// If we've retrieved data with version 4 (JSON), serialize back to JSON
	if (this.dataVersion == 4) {
		// Filter style properties
		let style = {};
		for (let prop of ['styleID', 'locale', 'hasBibliography', 'bibliographyStyleHasBeenSet']) {
			style[prop] = this.style[prop];
		}
		return JSON.stringify({
			style,
			prefs: this.prefs,
			sessionID: this.sessionID,
			zoteroVersion: Zotero.version,
			dataVersion: 4
		});
	}
	// Otherwise default to XML for now
	var prefs = "";
	for (var pref in this.prefs) {
		if (!this.prefs[pref]) continue;
		prefs += `<pref name="${Zotero.Utilities.htmlSpecialChars(pref)}" `+
			`value="${Zotero.Utilities.htmlSpecialChars(this.prefs[pref].toString())}"/>`;
	}

	return '<data data-version="'+Zotero.Utilities.htmlSpecialChars(`${DATA_VERSION}`)+'" '+
		'zotero-version="'+Zotero.Utilities.htmlSpecialChars(Zotero.version)+'">'+
			'<session id="'+Zotero.Utilities.htmlSpecialChars(this.sessionID)+'"/>'+
		'<style id="'+Zotero.Utilities.htmlSpecialChars(this.style.styleID)+'" '+
			(this.style.locale ? 'locale="' + Zotero.Utilities.htmlSpecialChars(this.style.locale) + '" ': '') +
			'hasBibliography="'+(this.style.hasBibliography ? "1" : "0")+'" '+
			'bibliographyStyleHasBeenSet="'+(this.style.bibliographyStyleHasBeenSet ? "1" : "0")+'"/>'+
		(prefs ? '<prefs>'+prefs+'</prefs>' : '<prefs/>')+'</data>';
};

/**
 * Unserializes document-specific XML
 */
Zotero.Integration.DocumentData.prototype.unserializeXML = function(xmlData) {
	var parser = Components.classes["@mozilla.org/xmlextras/domparser;1"]
			.createInstance(Components.interfaces.nsIDOMParser),
		doc = parser.parseFromString(xmlData, "application/xml");

	this.sessionID = Zotero.Utilities.xpathText(doc, '/data/session[1]/@id');
	this.style = {"styleID":Zotero.Utilities.xpathText(doc, '/data/style[1]/@id'),
		"locale":Zotero.Utilities.xpathText(doc, '/data/style[1]/@locale'),
		"hasBibliography":(Zotero.Utilities.xpathText(doc, '/data/style[1]/@hasBibliography') == 1),
		"bibliographyStyleHasBeenSet":(Zotero.Utilities.xpathText(doc, '/data/style[1]/@bibliographyStyleHasBeenSet') == 1)};
	this.prefs = {};
	for (let pref of Zotero.Utilities.xpath(doc, '/data/prefs[1]/pref')) {
		var name = pref.getAttribute("name");
		var value = pref.getAttribute("value");
		if(value === "true") {
			value = true;
		} else if(value === "false") {
			value = false;
		}

		this.prefs[name] = value;
		if (Zotero.DOCUMENT_MULTI_PREFERENCES.indexOf(name) > -1) {
			if (value) {
				this.prefs[name] = value.split(",");
			} else {
				this.prefs[name] = [];
			}
		} else if ("citationAffixes" === name) {
			this.prefs[name] = value.split("|");
		} else if ("extractingLibraryID" === name && value && value.match(/^[0-9]+$/)) {
			this.prefs[name] = parseInt(value, 10);
		} else {
			this.prefs[name] = value;
		}
	}

	this.prefs.noteType = parseInt(this.prefs.noteType) || 0;

	if(this.prefs["storeReferences"] === undefined) this.prefs["storeReferences"] = false;
	if(this.prefs["automaticJournalAbbreviations"] === undefined) this.prefs["automaticJournalAbbreviations"] = false;
	if(this.prefs["projectName"] === undefined) this.prefs["projectName"] = "";
	if(this.prefs["extractingLibraryID"] === undefined) this.prefs["extractingLibraryID"] = 0;
	if(this.prefs["extractingLibraryName"] === undefined) this.prefs["extractingLibraryName"] = "";
	if(this.prefs["suppressTrailingPunctuation"] === undefined) this.prefs["suppressTrailingPunctuation"] = false;

	this.zoteroVersion = doc.documentElement.getAttribute("zotero-version");
	if (!this.zoteroVersion) this.zoteroVersion = "2.0";
	this.dataVersion = doc.documentElement.getAttribute("data-version");
	if (!this.dataVersion) this.dataVersion = 2;
};

/**
 * Unserializes document-specific data, either as XML or as the string form used previously
 */
Zotero.Integration.DocumentData.prototype.unserialize = function(input) {
	try {
		return Object.assign(this, JSON.parse(input))
	} catch (e) {
		if (!(e instanceof SyntaxError)) {
			throw e;
		}
	}
	if (input[0] == "<") {
		this.unserializeXML(input);
	} else {
		const splitRe = /(^|[^:]):(?!:)/;

		var splitOutput = input.split(splitRe);
		var prefParameters = [];
		for(var i=0; i<splitOutput.length; i+=2) {
			prefParameters.push((splitOutput[i]+(splitOutput[i+1] ? splitOutput[i+1] : "")).replace("::", ":", "g"));
		}

		this.sessionID = prefParameters[0];
		this.style = {"styleID":prefParameters[1],
			"hasBibliography":(prefParameters[3] == "1" || prefParameters[3] == "True"),
			"bibliographyStyleHasBeenSet":false};
		this.prefs = {"fieldType":((prefParameters[5] == "1" || prefParameters[5] == "True") ? "Bookmark" : "Field")};
		if(prefParameters[2] == "note") {
			if(prefParameters[4] == "1" || prefParameters[4] == "True") {
				this.prefs.noteType = NOTE_ENDNOTE;
			} else {
				this.prefs.noteType = NOTE_FOOTNOTE;
			}
		} else {
			this.prefs.noteType = 0;
		}

		this.zoteroVersion = "2.0b6 or earlier";
		this.dataVersion = 1;
	}
}

/**
 * Handles mapping of item IDs to URIs
 */
Zotero.Integration.URIMap = function(session) {
	this.itemIDURIs = {};
	this.session = session;
}

/**
 * Adds a given mapping to the URI map
 */
Zotero.Integration.URIMap.prototype.add = function(id, uris) {
	this.itemIDURIs[id] = uris;
}

/**
 * Gets URIs for a given item ID, and adds to map
 */
Zotero.Integration.URIMap.prototype.getURIsForItemID = function(id) {
	if(typeof id === "string" && id.indexOf("/") !== -1) {
		return Zotero.Cite.getItem(id).cslURIs;
	}

	if(!this.itemIDURIs[id]) {
		this.itemIDURIs[id] = [Zotero.URI.getItemURI(Zotero.Items.get(id))];
	}

	return this.itemIDURIs[id];
}

/**
 * Gets Zotero item for a given set of URIs
 */
Zotero.Integration.URIMap.prototype.getZoteroItemForURIs = Zotero.Promise.coroutine(function* (uris) {
	var zoteroItem = false;
	var needUpdate = false;
	var embeddedItem = false;;

	for(var i=0, n=uris.length; i<n; i++) {
		var uri = uris[i];

		// First try embedded URI
		if(this.session.embeddedItemsByURI[uri]) {
			embeddedItem = this.session.embeddedItemsByURI[uri];
		}

		// Next try getting URI directly
		try {
			zoteroItem = yield Zotero.URI.getURIItem(uri);
			if(zoteroItem) {
				// Ignore items in the trash
				if(zoteroItem.deleted) {
					zoteroItem = false;
				} else {
					break;
				}
			}
		} catch(e) {}

		// Try merged item mapping
		var replacer = Zotero.Relations.getByPredicateAndObject(
			'item', Zotero.Relations.replacedItemPredicate, uri
		);
		if (replacer.length && !replacer[0].deleted) {
			zoteroItem = replacer[0];
		}

		if(zoteroItem) break;
	}

	if(zoteroItem) {
		// make sure URI is up to date (in case user just began synching)
		var newURI = Zotero.URI.getItemURI(zoteroItem);
		if(newURI != uris[i]) {
			uris[i] = newURI;
			needUpdate = true;
		}
		// cache uris
		this.itemIDURIs[zoteroItem.id] = uris;
	} else if(embeddedItem) {
		return [embeddedItem, false];
	}

	return [zoteroItem, needUpdate];
});

Zotero.Integration.Field = class {
	constructor(field, rawCode) {
		if (field instanceof Zotero.Integration.Field) {
			throw new Error("Trying to instantiate Integration.Field with Integration.Field, not doc field");
		}
		// This is not the best solution in terms of performance
		for (let prop in field) {
			if (!(prop in this)) {
				this[prop] = field[prop].bind ? field[prop].bind(field) : field[prop];
			}
		}
		this._field = field;
		this._code = rawCode;
		this.type = INTEGRATION_TYPE_TEMP;
	}

	setCode(code) {
		// Boo. Inconsistent order.
		if (this.type == INTEGRATION_TYPE_ITEM) {
			this._field.setCode(`ITEM CSL_CITATION ${code}`);
		} else if (this.type == INTEGRATION_TYPE_BIBLIOGRAPHY) {
			this._field.setCode(`BIBL ${code} CSL_BIBLIOGRAPHY`);
		} else {
			this._field.setCode(`TEMP`);
		}
		this._code = code;
	}

	getCode() {
		if (!this._code) {
			ths._code = this._field.getCode();
		}
		let start = this._code.indexOf('{');
		if (start == -1) {
			return '{}';
		}
		return this._code.substring(start, this._code.lastIndexOf('}')+1);
	}

	clearCode() {
		this.setCode('{}');
	}

	setText(text) {
		var isRich = false;
		// If RTF wrap with RTF tags
		if (text.includes("\\")) {
			if (text.substr(0,5) != "{\\rtf") {
				text = "{\\rtf "+text+"}";
			}
			isRich = true;
		}
		this._field.setText(text, isRich);
		return isRich;
	}
};

/**
 * Load existing field in document and return correct instance of field type
 * @param docField
 * @param rawCode
 * @param idx
 * @returns {Zotero.Integration.Field|Zotero.Integration.CitationField|Zotero.Integration.BibliographyField}
 */
Zotero.Integration.Field.loadExisting = function(docField) {
	var field;
	// Already loaded
	if (docField instanceof Zotero.Integration.Field) return docField;
	var rawCode = docField.getCode();

	// ITEM/CITATION CSL_ITEM {json: 'data'}
	for (let type of ["ITEM", "CITATION"]) {
		if (rawCode.substr(0, type.length) === type) {
			field = new Zotero.Integration.CitationField(docField, rawCode);
		}
	}
	// BIBL {json: 'data'} CSL_BIBLIOGRAPHY
	if (rawCode.substr(0, 4) === "BIBL") {
		field = new Zotero.Integration.BibliographyField(docField, rawCode);
	}

	if (!field) {
		field = new Zotero.Integration.Field(docField, rawCode);
	}

	return field;
};

Zotero.Integration.CitationField = class extends Zotero.Integration.Field {
	constructor(field, rawCode) {
		super(field, rawCode);
		this.type = INTEGRATION_TYPE_ITEM;
	}

	/**
	 * Don't be fooled, this should be as simple as JSON.parse().
	 * The schema for the code is defined @ https://raw.githubusercontent.com/citation-style-language/schema/master/csl-citation.json
	 *
	 * However, over the years and different versions of Zotero there's been changes to the schema,
	 * incorrect serialization, etc. Therefore this function is cruft-full and we can't get rid of it.
	 *
	 * @returns {{citationItems: Object[], properties: Object}}
	 */
	unserialize() {
		function unserialize(code) {
			try {
				return JSON.parse(code);
			} catch(e) {
				// fix for corrupted fields (corrupted by 2.1b1)
				return JSON.parse(code.replace(/{{((?:\s*,?"unsorted":(?:true|false)|\s*,?"custom":"(?:(?:\\")?[^"]*\s*)*")*)}}/, "{$1}"));
			}
		}

		function upgradeCruft(citation, code) {
			// fix for uppercase citation codes
			if(citation.CITATIONITEMS) {
				citation.citationItems = [];
				for (var i=0; i<citation.CITATIONITEMS.length; i++) {
					for (var j in citation.CITATIONITEMS[i]) {
						switch (j) {
							case 'ITEMID':
								var field = 'itemID';
								break;

							// 'position', 'custom'
							default:
								var field = j.toLowerCase();
						}
						if (!citation.citationItems[i]) {
							citation.citationItems[i] = {};
						}
						citation.citationItems[i][field] = citation.CITATIONITEMS[i][j];
					}
				}
			}

			if(!citation.properties) citation.properties = {};

			for (let citationItem of citation.citationItems) {
				// for upgrade from Zotero 2.0 or earlier
				if(citationItem.locatorType) {
					citationItem.label = citationItem.locatorType;
					delete citationItem.locatorType;
				} else if(citationItem.suppressAuthor) {
					citationItem["suppress-author"] = citationItem["suppressAuthor"];
					delete citationItem.suppressAuthor;
				}

				// fix for improper upgrade from Zotero 2.1 in <2.1.5
				if(parseInt(citationItem.label) == citationItem.label) {
					const locatorTypeTerms = ["page", "book", "chapter", "column", "figure", "folio",
						"issue", "line", "note", "opus", "paragraph", "part", "section", "sub verbo",
						"volume", "verse"];
					citationItem.label = locatorTypeTerms[parseInt(citationItem.label)];
				}

				// for update from Zotero 2.1 or earlier
				if(citationItem.uri) {
					citationItem.uris = citationItem.uri;
					delete citationItem.uri;
				}
			}

			// for upgrade from Zotero 2.0 or earlier
			if(citation.sort) {
				citation.properties.unsorted = !citation.sort;
				delete citation.sort;
			}
			if(citation.custom) {
				citation.properties.custom = citation.custom;
				delete citation.custom;
			}

			citation.properties.field = code;
			return citation;
		}

		function unserializePreZotero1_0(code) {
			var underscoreIndex = code.indexOf("_");
			var itemIDs = code.substr(0, underscoreIndex).split("|");

			var lastIndex = code.lastIndexOf("_");
			if(lastIndex != underscoreIndex+1) {
				var locatorString = code.substr(underscoreIndex+1, lastIndex-underscoreIndex-1);
				var locators = locatorString.split("|");
			}

			var citationItems = new Array();
			for(var i=0; i<itemIDs.length; i++) {
				var citationItem = {id:itemIDs[i]};
				if(locators) {
					citationItem.locator = locators[i].substr(1);
					citationItem.label = Zotero.Integration._oldCitationLocatorMap[locators[i][0]];
				}
				citationItems.push(citationItem);
			}

			return {"citationItems":citationItems, properties:{}};
		}


		try {
			let code = this.getCode();
			if (code[0] == '{') {		// JSON field
				return upgradeCruft(unserialize(code), code);
			} else {				// ye olde style field
				return unserializePreZotero1_0(code);
			}
		} catch (e) {
			return this.resolveCorrupt(code);
		}
	}

	clearCode() {
		this.setCode(JSON.stringify({citationItems: [], properties: {}}));
	}

	resolveCorrupt(code) {
		return Zotero.Promise.coroutine(function* () {
			Zotero.debug(`Integration: handling corrupt citation field ${code}`);
			var msg = Zotero.getString("integration.corruptField")+'\n\n'+
					  Zotero.getString('integration.corruptField.description');
			this.select();
			Zotero.Integration.currentDoc.activate();
			var result = Zotero.Integration.currentSession.displayAlert(msg, DIALOG_ICON_CAUTION, DIALOG_BUTTONS_YES_NO_CANCEL);
			if (result == 0) { // Cancel
				return new Zotero.Exception.UserCancelled("corrupt citation resolution");
			} else if (result == 1) {		// No
				return false;
			} else { // Yes
				var fieldGetter = Zotero.Integration.currentSession.fields,
					oldWindow = Zotero.Integration.currentWindow,
					oldProgressCallback = this.progressCallback;
				// Display reselect edit citation dialog
				let [idx, field, citation] = yield fieldGetter.addEditCitation(this);
				if (Zotero.Integration.currentWindow && !Zotero.Integration.currentWindow.closed) {
					Zotero.Integration.currentWindow.close();
				}
				Zotero.Integration.currentWindow = oldWindow;
				fieldGetter.progressCallback = oldProgressCallback;
				return citation;
			}
		}).apply(this, arguments);
	}
};


Zotero.Integration.BibliographyField = class extends Zotero.Integration.Field {
	constructor(field, rawCode) {
		super(field, rawCode);
		this.type = INTEGRATION_TYPE_BIBLIOGRAPHY;
	};

	unserialize() {
		var code = this.getCode();
		try {
			return JSON.parse(code);
		} catch(e) {
			return this.resolveCorrupt(code);
		}
	}

	resolveCorrupt(code) {
		return Zotero.Promise.coroutine(function* () {
			Zotero.debug(`Integration: handling corrupt bibliography field ${code}`);
			var msg = Zotero.getString("integration.corruptBibliography")+'\n\n'+
					  Zotero.getString('integration.corruptBibliography.description');
			var result = Zotero.Integration.currentSession.displayAlert(msg, DIALOG_ICON_CAUTION, DIALOG_BUTTONS_OK_CANCEL);
			if (result == 0) {
				throw new Zotero.Exception.UserCancelled("corrupt bibliography resolution");
			} else {
				this.clearCode();
				return unserialize();
			}
		}).apply(this, arguments);
	}
};

Zotero.Integration.Citation = class {
	constructor(citationField, noteIndex) {
		let data = citationField.unserialize();
		this.citationID = data.citationID;
		this.citationItems = data.citationItems;
		this.properties = data.properties;
		this.properties.noteIndex = noteIndex;

		this._field = citationField;
	}

	/**
	 * Load item data for current item
	 * @param {Boolean} [promptToReselect=true] - will throw a MissingItemException if false
	 * @returns {Promise{Number}}
	 * 	- Zotero.Integration.NO_ACTION
	 * 	- Zotero.Integration.UPDATE
	 * 	- Zotero.Integration.REMOVE_CODE
	 */
	loadItemData() {
		return Zotero.Promise.coroutine(function *(promptToReselect=true){
			let items = [];
			var needUpdate = false;

			for (var i=0, n=this.citationItems.length; i<n; i++) {
				var citationItem = this.citationItems[i];

				// get Zotero item
				var zoteroItem = false;
				if (citationItem.uris) {
					let itemNeedsUpdate;
					[zoteroItem, itemNeedsUpdate] = yield Zotero.Integration.currentSession.uriMap.getZoteroItemForURIs(citationItem.uris);
					needUpdate = needUpdate || itemNeedsUpdate;

					// Unfortunately, people do weird things with their documents. One weird thing people
					// apparently like to do (http://forums.zotero.org/discussion/22262/) is to copy and
					// paste citations from other documents created with earlier versions of Zotero into
					// their documents and then not refresh the document. Usually, this isn't a problem. If
					// document is edited by the same user, it will work without incident. If the first
					// citation of a given item doesn't contain itemData, the user will get a
					// MissingItemException. However, it may also happen that the first citation contains
					// itemData, but later citations don't, because the user inserted the item properly and
					// then copied and pasted the same citation from another document. We check for that
					// possibility here.
					if (zoteroItem.cslItemData && !citationItem.itemData) {
						citationItem.itemData = zoteroItem.cslItemData;
						needUpdate = true;
					}
				} else {
					if (citationItem.key && citationItem.libraryID) {
						// DEBUG: why no library id?
						zoteroItem = Zotero.Items.getByLibraryAndKey(citationItem.libraryID, citationItem.key);
					} else if (citationItem.itemID) {
						zoteroItem = Zotero.Items.get(citationItem.itemID);
					} else if (citationItem.id) {
						zoteroItem = Zotero.Items.get(citationItem.id);
					}
					if (zoteroItem) needUpdate = true;
				}

				// Item no longer in library
				if (!zoteroItem) {
					// Use embedded item
					if (citationItem.itemData) {
						Zotero.debug(`Item ${JSON.stringify(citationItem.uris)} not in library. Using embedded data`);
						// add new embedded item
						var itemData = Zotero.Utilities.deepCopy(citationItem.itemData);

						// assign a random string as an item ID
						var anonymousID = Zotero.randomString();
						var globalID = itemData.id = citationItem.id = Zotero.Integration.currentSession.data.sessionID+"/"+anonymousID;
						Zotero.Integration.currentSession.embeddedItems[anonymousID] = itemData;

						// assign a Zotero item
						var surrogateItem = Zotero.Integration.currentSession.embeddedZoteroItems[anonymousID] = new Zotero.Item();
						Zotero.Utilities.itemFromCSLJSON(surrogateItem, itemData);
						surrogateItem.cslItemID = globalID;
						surrogateItem.cslURIs = citationItem.uris;
						surrogateItem.cslItemData = itemData;

						for(var j=0, m=citationItem.uris.length; j<m; j++) {
							Zotero.Integration.currentSession.embeddedItemsByURI[citationItem.uris[j]] = surrogateItem;
						}
					} else if (promptToReselect) {
						zoteroItem = yield this.handleMissingItem(i);
						if (zoteroItem) needUpdate = true;
						else return Zotero.Integration.REMOVE_CODE;
					} else {
						// throw a MissingItemException
						throw (new Zotero.Integration.MissingItemException(this, this.citationItems[i]));
					}
				}

				if (zoteroItem) {
					if (zoteroItem.cslItemID) {
						citationItem.id = zoteroItem.cslItemID;
					}
					else {
						citationItem.id = zoteroItem.id;
						items.push(zoteroItem);
					}
				}
			}

			// Items may be in libraries that haven't been loaded, and retrieveItem() is synchronous, so load
			// all data (as required by toJSON(), which is used by itemToExportFormat(), which is used by
			// itemToCSLJSON()) now
			if (items.length) {
				yield Zotero.Items.loadDataTypes(items);
			}
			return needUpdate ? Zotero.Integration.UPDATE : Zotero.Integration.NO_ACTION;
		}).apply(this, arguments);
	}

	handleMissingItem() {
		return Zotero.Promise.coroutine(function* (idx) {
			// Ask user what to do with this item
			if (this.citationItems.length == 1) {
				var msg = Zotero.getString("integration.missingItem.single");
			} else {
				var msg = Zotero.getString("integration.missingItem.multiple", (idx).toString());
			}
			msg += '\n\n'+Zotero.getString('integration.missingItem.description');
			this._field.select();
			Zotero.Integration.currentDoc.activate();
			var result = Zotero.Integration.currentSession.displayAlert(msg,
				DIALOG_ICON_WARNING, DIALOG_BUTTONS_YES_NO_CANCEL);
			if (result == 0) {			// Cancel
				throw new Zotero.Exception.UserCancelled("document update");
			} else if(result == 1) {	// No
				return false;
			}

			// Yes - prompt to reselect
			var io = new function() { this.wrappedJSObject = this; };

			io.addBorder = Zotero.isWin;
			io.singleSelection = true;

			yield Zotero.Integration.displayDialog('chrome://zotero/content/selectItemsDialog.xul', 'resizable', io);

			if (io.dataOut && io.dataOut.length) {
				return Zotero.Items.get(io.dataOut[0]);
			}
		}).apply(this, arguments);
	}

	prepareForEditing() {
		return Zotero.Promise.coroutine(function *(){
			// Check for modified field text or dontUpdate flag
			var fieldText = this._field.getText();
			if (this.properties.dontUpdate
					|| (this.properties.plainCitation
						&& fieldText !== this.properties.plainCitation)) {
				Zotero.Integration.currentDoc.activate();
				Zotero.debug("[addEditCitation] Attempting to update manually modified citation.\n"
					+ "citaion.properties.dontUpdate: " + this.properties.dontUpdate + "\n"
					+ "Original: " + this.properties.plainCitation + "\n"
					+ "Current:  " + fieldText
				);
				if (!Zotero.Integration.currentSession.displayAlert(Zotero.getString("integration.citationChanged.edit"),
						DIALOG_ICON_WARNING, DIALOG_BUTTONS_OK_CANCEL)) {
					throw new Zotero.Exception.UserCancelled("editing citation");
				}
			}

			// make sure it's going to get updated
			delete this.properties["formattedCitation"];
			delete this.properties["plainCitation"];
			delete this.properties["dontUpdate"];

			// Load items to be displayed in edit dialog
			yield this.loadItemData();

		}).apply(this, arguments);
	}

	toJSON() {
		const saveProperties = ["custom", "unsorted", "formattedCitation", "plainCitation", "dontUpdate"];
		const saveCitationItemKeys = ["locator", "label", "suppress-author", "author-only", "prefix",
			"suffix"];

		var citation = {};

		citation.citationID = this.citationID;

		citation.properties = {};
		for (let key of saveProperties) {
			if (key in this.properties) citation.properties[key] = this.properties[key];
		}

		citation.citationItems = new Array(this.citationItems.length);
		for (let i=0; i < this.citationItems.length; i++) {
			var citationItem = this.citationItems[i],
				serializeCitationItem = {};

			// add URI and itemData
			var slashIndex;
			if (typeof citationItem.id === "string" && (slashIndex = citationItem.id.indexOf("/")) !== -1) {
				// this is an embedded item
				serializeCitationItem.id = citationItem.id;
				serializeCitationItem.uris = citationItem.uris;

				// XXX For compatibility with Zotero 2.0; to be removed at a later date
				serializeCitationItem.uri = serializeCitationItem.uris;

				// always store itemData, since we have no way to get it back otherwise
				serializeCitationItem.itemData = citationItem.itemData;
			} else {
				serializeCitationItem.id = citationItem.id;
				serializeCitationItem.uris = Zotero.Integration.currentSession.uriMap.getURIsForItemID(citationItem.id);

				// XXX For compatibility with Zotero 2.0; to be removed at a later date
				serializeCitationItem.uri = serializeCitationItem.uris;

				serializeCitationItem.itemData = Zotero.Integration.currentSession.style.sys.retrieveItem(citationItem.id);
			}

			for (let key of saveCitationItemKeys) {
				if (key in citationItem) serializeCitationItem[key] = citationItem[key];
			}

			citation.citationItems[i] = serializeCitationItem;
		}
		citation.schema = "https://github.com/citation-style-language/schema/raw/master/csl-citation.json";

		return citation;
	}

	/**
	 * Serializes the citation into CSL code representation
	 * @returns {string}
	 */
	serialize() {
		return JSON.stringify(this.toJSON());
	}
};

Zotero.Integration.Bibliography = class {
	constructor(bibliographyField) {
		this._field = bibliographyField;
		this.data = bibliographyField.unserialize();

		this.uncitedItemIDs = new Set();
		this.omittedItemIDs = new Set();
		this.customEntryText = {};
		this.dataLoaded = false;
	}

	loadItemData() {
		return Zotero.Promise.coroutine(function* () {
			// set uncited
			var needUpdate = false;
			if (this.data.uncited) {
				if (this.data.uncited[0]) {
					// new style array of arrays with URIs
					let zoteroItem, itemNeedsUpdate;
					for (let uris of this.data.uncited) {
						[zoteroItem, itemNeedsUpdate] = yield Zotero.Integration.currentSession.uriMap.getZoteroItemForURIs(uris);
						var id = zoteroItem.cslItemID ? zoteroItem.cslItemID : zoteroItem.id;
						if(zoteroItem && !Zotero.Integration.currentSession.citationsByItemID[id]) {
							this.uncitedItemIDs.add(`${id}`);
						} else {
							needUpdate = true;
						}
						needUpdate |= itemNeedsUpdate;
					}
				} else {
					for(var itemID in this.data.uncited) {
						// if not yet in item set, add to item set
						// DEBUG: why no libraryID?
						var zoteroItem = Zotero.Items.getByLibraryAndKey(0, itemID);
						if (!zoteroItem) zoteroItem = Zotero.Items.get(itemID);
						if (zoteroItem) this.uncitedItemIDs.add(`${id}`);
					}
					needUpdate = true;
				}
			}

			// set custom bibliography entries
			if(this.data.custom) {
				if(this.data.custom[0]) {
					// new style array of arrays with URIs
					var zoteroItem, itemNeedsUpdate;
					for (let custom of this.data.custom) {
						[zoteroItem, itemNeedsUpdate] = yield Zotero.Integration.currentSession.uriMap.getZoteroItemForURIs(custom[0]);
						if (!zoteroItem) continue;
						if (needUpdate) needUpdate = true;

						var id = zoteroItem.cslItemID ? zoteroItem.cslItemID : zoteroItem.id;
						if (Zotero.Integration.currentSession.citationsByItemID[id] || id in this.uncitedItemIDs) {
							this.customEntryText[id] = custom[1];
						}
					}
				} else {
					// old style hash
					for(var itemID in this.data.custom) {
						var zoteroItem = Zotero.Items.getByLibraryAndKey(0, itemID);
						if (!zoteroItem) zoteroItem = Zotero.Items.get(itemID);
						if (!zoteroItem) continue;

						if(Zotero.Integration.currentSession.citationsByItemID[zoteroItem.id] || zoteroItem.id in this.uncitedItemIDs) {
							this.customEntryText[zoteroItem.id] = this.data.custom[itemID];
						}
					}
					needUpdate = true;
				}
			}

			// set entries to be omitted from bibliography
			if (this.data.omitted) {
				let zoteroItem, itemNeedsUpdate;
				for (let uris of this.data.omitted) {
					[zoteroItem, itemNeedsUpdate] = yield Zotero.Integration.currentSession.uriMap.getZoteroItemForURIs(uris);
					var id = zoteroItem.cslItemID ? zoteroItem.cslItemID : zoteroItem.id;
					if (zoteroItem && Zotero.Integration.currentSession.citationsByItemID[id]) {
						this.omittedItemIDs.add(`${id}`);
					} else {
						needUpdate = true;
					}
					needUpdate |= itemNeedsUpdate;
				}
			}
			this.dataLoaded = true;
			return needUpdate;
		}).apply(this, arguments);
	}

	getCiteprocBibliography(citeproc) {
		if (Zotero.Utilities.isEmpty(Zotero.Integration.currentSession.citationsByItemID)) {
			throw new Error("Attempting to generate bibliography without having updated processor items");
		};
		if (!this.dataLoaded) {
			throw new Error("Attempting to generate bibliography without having loaded item data");
		}

		Zotero.debug(`Integration: style.updateUncitedItems ${Array.from(this.uncitedItemIDs.values()).toSource()}`);
		citeproc.updateUncitedItems(Array.from(this.uncitedItemIDs.values()));
		citeproc.setOutputFormat("rtf");
		let bibliography = citeproc.makeBibliography();
		Zotero.Cite.removeFromBibliography(bibliography, this.omittedItemIDs);

		for (let i in bibliography[0].entry_ids) {
			if (bibliography[0].entry_ids[i].length != 1) continue;
			let itemID = bibliography[0].entry_ids[i][0];
			if (itemID in this.customEntryText) {
				bibliography[1][i] = this.customEntryText[itemID];
			}
		}
		return bibliography;
	}

	serialize() {
		if (!this.dataLoaded) {
			throw new Error("Attempting to generate bibliography without having loaded item data");
		}
		var bibliography = {
			uncited: [],
			omitted: [],
			custom: []
		};

		// add uncited if there is anything
		for (let itemID of this.uncitedItemIDs.values()) {
			bibliography.uncited.push(Zotero.Integration.currentSession.uriMap.getURIsForItemID(itemID));
		}
		for (let itemID of this.omittedItemIDs.values()) {
			bibliography.omitted.push(Zotero.Integration.currentSession.uriMap.getURIsForItemID(itemID));
		}

		bibliography.custom = Object.keys(this.customEntryText)
			.map(id => [Zotero.Integration.currentSession.uriMap.getURIsForItemID(id), this.customEntryText[id]]);


		return JSON.stringify(bibliography);
	}
}

// perhaps not the best place for a timer
Zotero.Integration.Timer = class {
	start() {
		this.startTime = (new Date()).getTime();
	}

	stop() {
		this.resume();
		return ((new Date()).getTime() - this.startTime)/1000;
	}

	pause() {
		this.pauseTime = (new Date()).getTime();
	}

	resume() {
		if (this.pauseTime) {
			this.startTime += (this.pauseTime - this.startTime);
			this.pauseTime = null;
		}
	}
}
