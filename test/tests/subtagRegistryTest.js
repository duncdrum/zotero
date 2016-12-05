describe("Zotero.subtagRegistry", function() {
	describe("#validate()", function() {
		it("should validate a tag with all schema elements", function() {
			var validate = Zotero.subtagRegistry.validate.bind(Zotero.subtagRegistry); 
			var makeTag = Zotero.subtagRegistry.makeTag;
			return validate('ja-Arab-JP-alalc97')
				.then(function(data) {
					assert.equal(makeTag(data), 'ja-Arab-JP-alalc97');
				});
		});
		it("should normalize the case of tag elements", function() {
			var validate = Zotero.subtagRegistry.validate.bind(Zotero.subtagRegistry); 
			var makeTag = Zotero.subtagRegistry.makeTag;
			return validate('ja-arab-jp-alalc97')
				.then(function(data) {
					assert.equal(makeTag(data), 'ja-Arab-JP-alalc97');
				});
		});
		it("should treat legacy tags grandfathered into BCP47 as valid", function() {
			var validate = Zotero.subtagRegistry.validate.bind(Zotero.subtagRegistry); 
			var makeTag = Zotero.subtagRegistry.makeTag;
			return validate('zh-min-CN')
				.then(function(data) {
					assert.equal(makeTag(data), 'zh-min-CN');
				});
		});
		it("should fail gracefully on invalid tags", function() {
			var validate = Zotero.subtagRegistry.validate.bind(Zotero.subtagRegistry); 
			return validate('abc-xyz')
				.then(function(data) {
					assert.isFalse(data);
				});
		});
		it("should omit invalid subtags without throwing an error or failing entire tag", function() {
			var validate = Zotero.subtagRegistry.validate.bind(Zotero.subtagRegistry); 
			var makeTag = Zotero.subtagRegistry.makeTag;
			return validate('en-xqyz')
				.then(function(data) {
					assert.equal(makeTag(data), 'en');
				});
		});
	});
});
