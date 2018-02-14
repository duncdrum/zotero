const colors = require('colors/safe');

const adminCheck = require('is-admin');
const getBrowserify = require('./browserify');
const getCopy = require('./copy');
const getJS = require('./js');
const getSass = require('./sass');
const getSymlinks = require('./symlinks');
const { isWindows, formatDirsForMatcher, getSignatures, writeSignatures, cleanUp, onSuccess, onError} = require('./utils');
const { dirs, symlinkDirs, copyDirs, symlinkFiles, jsFiles, ignoreMask } = require('./config');

if (require.main === module) {
	(async () => {
		try {
			if (isWindows) {
				var isAdmin = await adminCheck();
				if(!isAdmin){
					console.log("Must be run as Administrator on Windows.");
					console.log("  (close the Cygwin terminal, reopen it with right-click, check the menu)");
					process.exit();
				}
			}
			const t1 = Date.now();
			global.isError = false; // used to prevent further output to avoid concealing errors
			const symlinks = symlinkFiles
				.concat(dirs.map(d => `${d}/**`))
				.concat([`!${formatDirsForMatcher(dirs)}/**/*.js`])
				.concat([`!${formatDirsForMatcher(copyDirs)}/**`])

			const signatures = await getSignatures();
			const results = await Promise.all([
				getBrowserify(signatures),
				getCopy(copyDirs.map(d => `${d}/**`), { ignore: ignoreMask }, signatures),
				getJS(jsFiles, { ignore: ignoreMask }, signatures),
				getSass('scss/*.scss', { root: 'scss', ignore: ignoreMask }, signatures),
				getSymlinks(symlinks, { nodir: true, ignore: ignoreMask }, signatures),
				getSymlinks(symlinkDirs, { ignore: ignoreMask }, signatures),
				cleanUp(signatures)
			]);

			await writeSignatures(signatures);
			for (const result of results) {
				onSuccess(result);
			}
			const t2 = Date.now();
			console.log(colors.yellow(`Total build time ${t2 - t1}ms`));
		} catch (err) {
			process.exitCode = 1;
			global.isError = true;
			onError(err);
		}
	})();
}
