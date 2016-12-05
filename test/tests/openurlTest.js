"use strict";

describe("Zotero.OpenURL", function() {
	describe("#createContextObject()", function () {
		it("should use firstCreator for author", function* () {
			var item = createUnsavedDataObject('item');
			item.setCreators([
				{
					firstName: "Aaa",
					lastName: "Editor",
					creatorType: 'editor',
					multi: {
						_key: {}
					}
				},
				{
					firstName: "Bbb",
					lastName: "Author",
					creatorType: 'author',
					multi: {
						_key: {}
					}
				}
			]);
			var co = Zotero.OpenURL.createContextObject(item, "1.0");
			assert.include(co, '&rft.aufirst=Bbb&rft.aulast=Author&');
		});
	});
});
