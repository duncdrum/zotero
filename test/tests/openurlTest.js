"use strict";

describe("Zotero.OpenURL", function() {
	describe("#createContextObject()", function () {
		it("should use firstCreator for author", function* () {
			var item = createUnsavedDataObject('item');
			item.setCreators([
				{
					firstName: "Aaa",
					lastName: "Editor",
<<<<<<< HEAD
					creatorType: 'editor',
					multi: {
						_key: {}
					}
=======
					creatorType: 'editor'
>>>>>>> acb1be97d0b930dc1491502416a1787d2f6413e2
				},
				{
					firstName: "Bbb",
					lastName: "Author",
<<<<<<< HEAD
					creatorType: 'author',
					multi: {
						_key: {}
					}
=======
					creatorType: 'author'
>>>>>>> acb1be97d0b930dc1491502416a1787d2f6413e2
				}
			]);
			var co = Zotero.OpenURL.createContextObject(item, "1.0");
			assert.include(co, '&rft.aufirst=Bbb&rft.aulast=Author&');
		});
	});
});
