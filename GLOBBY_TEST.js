#!/usr/bin/node

var globby = require('globby');

async function TryGlobby() {
	var matchingFiles = await globby(
		[
			'{chrome,components,defaults,resource,resource/web-library,test,test/resource/chai,test/resource/chai-as-promised,test/resource/mocha}/**/*.js',
			'!{styles,translators,test/tests/data}/**/*.js'
		],
		Object.assign({cwd: '.'}),
		{
			"ignore": [
				"**/#*.*"
			]
		}
	);
	console.log(JSON.stringify(matchingFiles, null, 2))
}

TryGlobby();
