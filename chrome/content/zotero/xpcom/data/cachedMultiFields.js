Zotero.CachedMultiFields = new function() {

	var _multiBaseFields = [
		'archive',
		'archiveLocation',
		'code',
		'committee',
		'conferenceName',
		'court',
		'edition',
		'institution',
		'jurisdiction',
		'legislativeBody',
		'place',
		'publicationTitle',
		'publisher',
		'reporter',
		'resolutionLabel',
		'series',
		'seriesText',
		'seriesTitle',
		'shortTitle',
		'supplementName',
		'title',
		'type'
	];
	
	var _multiFieldIDs;
	var _multiFieldNames;

    this.init = Zotero.Promise.coroutine(function* () {

        _multiFieldIDs = {};
        _multiFieldNames = {};

        // Multi fieldIDs
	    var sql = "SELECT F.fieldID AS origID,B.fieldID AS mappedID "
            + "FROM fields F "
            + "LEFT JOIN baseFieldMappings B ON F.fieldID=B.baseFieldID " +
		    "WHERE F.fieldName in ('" + _multiBaseFields.join("','") + "')";
	    var res = yield Zotero.DB.queryAsync(sql);

        for (let i=0,ilen=res.length;i<ilen;i+=1) {
		    _multiFieldIDs[res[i].origID] = true;
			if (res[i].mappedID) {
				_multiFieldIDs[res[i].mappedID] = true;
			}
	    }
        
        // Multi fieldNames
	    var sql = "SELECT fieldName from fields WHERE fieldID in (" + Object.keys(_multiFieldIDs).join(",") + ")";
		    //"WHERE fieldID in (" + [colVals[i] for (i in colVals)].join(",") + ")";
	    var colVals = yield Zotero.DB.columnQueryAsync(sql);

        for (let i=0,ilen=colVals.length;i<ilen;i+=1) {
            _multiFieldNames[colVals[i]] = true;
        }
    });

    this.isMultiFieldID = function(fieldID) {
		if (!_multiFieldIDs) {
			throw new Zotero.Exception.UnloadedDataException("Multi field ID data not yet loaded");
		}
        return !!_multiFieldIDs[fieldID];
    }
    
    this.isMultiFieldName = function(fieldName) {
		if (!_multiFieldNames) {
			throw new Zotero.Exception.UnloadedDataException("Multi field name data not yet loaded");
		}
        return !!_multiFieldNames[fieldName];
    }
    
}
