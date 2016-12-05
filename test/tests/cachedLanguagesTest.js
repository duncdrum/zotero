describe("Zotero.CachedLanguages", function() {
	describe("#addTag()", function() {
		var addTag = Zotero.CachedLanguages.addTag.bind(Zotero.CachedLanguages);
		var deleteTag = Zotero.CachedLanguages.deleteTag.bind(Zotero.CachedLanguages);
		var hasTag = Zotero.CachedLanguages.hasTag.bind(Zotero.CachedLanguages);
		it("should add a valid tag", function() {
			return addTag('en')
				.then(function() {
					assert.isTrue(hasTag('en'));
				});
		});
		it("should correctly register an optional nickname with a tag", function() {
			return addTag('ja', 'Japanese')
				.then(function(regdata) {
					assert.isTrue(hasTag('ja'));
					assert.equal(regdata.nickname, 'Japanese');
				});
		});
		it("should silently fail to register an optional nickname if it would clash with another", function() {
			return addTag('en-US', 'English')
				.then(function(){
					return addTag('en-GB', 'English')
				})
				.then(function(regdata) {
					assert.isTrue(hasTag('en-GB'));
					assert.equal(regdata.nickname, 'en-GB');
				})
		});
		it("should not crash when a valid tag is added redundantly", function() {
			return Zotero.CachedLanguages.addTag('en')
				.then(function() {
					assert.isTrue(Zotero.CachedLanguages.hasTag('en'));
				});
		});
		it("should not freak out when presented with an invalid tag", function() {
			return Zotero.CachedLanguages.addTag('xy2p')
				.then(function() {
					assert.isFalse(Zotero.CachedLanguages.hasTag('xy2p'));
				});
		});
	});
	describe("#deleteTag()", function() {
		var addTag = Zotero.CachedLanguages.addTag.bind(Zotero.CachedLanguages);
		var deleteTag = Zotero.CachedLanguages.deleteTag.bind(Zotero.CachedLanguages);
		var hasTag = Zotero.CachedLanguages.hasTag.bind(Zotero.CachedLanguages);
		it("should remove a tag", function() {
			return addTag('en')
				.then(function() {
					assert.isTrue(hasTag('en'))
				})
				.then(function() {
					return deleteTag('en');
				})
				.then(function() {
					assert.isFalse(hasTag('en'));
				});
		});
	});
	describe("#nicknameReset()", function() {
		var addTag = Zotero.CachedLanguages.addTag.bind(Zotero.CachedLanguages);
		var deleteTag = Zotero.CachedLanguages.deleteTag.bind(Zotero.CachedLanguages);
		var hasTag = Zotero.CachedLanguages.hasTag.bind(Zotero.CachedLanguages);
		var nicknameReset = Zotero.CachedLanguages.nicknameReset.bind(Zotero.CachedLanguages);
		var getNickname = Zotero.CachedLanguages.getNickname.bind(Zotero.CachedLanguages);
		it("should happily delete tags, including non-existent ones", function() {
			return deleteTag('en')
				.then(function(){
					return deleteTag('en-US');
				})
				.then(function(){
					return deleteTag('en-GB');
				})
				.then(function(){
					return deleteTag('en-AU');
				})
				.then(function(){
					return deleteTag('ja');
				})
				.then(function(){
					return deleteTag('fr');
				})
				.then(function() {
					assert.isFalse(hasTag('en-US'));
				})
		});	
		it("should edit a nickname based on the old nickname", function() {
			return 	addTag('en-US', 'American')
				.then(function() {
					return nicknameReset('American', 'English')
				})
				.then(function(newNickname){
					assert.equal('English', newNickname)
					assert.equal('English', getNickname('en-US'))
				})
		});
		it("should fail silently when old nickname does not exist", function() {
			return deleteTag('en-US')
				.then(function() {
					return addTag('en-US')
				})
				.then(function() {
					return nicknameReset('American', 'English')
				})
				.then(function(newNickname){
					assert.isFalse(newNickname)
				})
		});
		it("should fail silently when new nickname would clash with another", function() {
			return deleteTag('en-US')
				.then(function() {
					return addTag('en-US', 'American')
				})
				.then(function() {
					return addTag('en-GB', 'English')
				})
				.then(function() {
					return nicknameReset('American', 'English')
				})
				.then(function(newNickname){
					assert.isFalse(newNickname)
				})
		});
	});
});
