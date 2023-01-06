//------------------------------------------------------------------
// Dependencies
//------------------------------------------------------------------
const fs = require("fs")
const path = require("path")
const jsonl = require("node-jsonl")
const lockfile = require('proper-lockfile')
const jsonStringify = require('fast-json-stable-stringify');

//------------------------------------------------------------------
// Utility function
//------------------------------------------------------------------

// Given the type and cacheObj, get the full cacheFilePath
// relative from the baseDir
function getCacheFilePath(type, cacheObj) {
	return path.join( cacheObj.promptOpt.model, type, cacheObj.cacheGrp, cacheObj.hash.slice(0,2), cacheObj.hash.slice(2,4), cacheObj.hash+".jsonl" )
}

//------------------------------------------------------------------
// Implementation
//------------------------------------------------------------------

/**
 * # JsonlCache context
 * 
 * Provides a jsonl based cache, this is used primarily to faciltate local caching, which can be easily stored and committed into a git repo.
 * Allowing the local cache to be shared across multiple team-members, or be used in the build process. While avoiding a remote DB loockup.
 * 
 * JSONL format as a flat file format, while having its own set of disadvantages (no index lookup, etc) compared to proper local DB like sqlite, 
 * was chosen due to it being significantly easy to check, validate, audit, and merge across multiple merge conflicts.
 * 
 * Its also a format, that machine learning folks are familiar with.
 * 
 * The downside of this process, is security implications involved in having the cache exposed as a filesystem
 * 
 * # JsonlCache dir folder structure
 * 
 * ./model-name/
 *   ./{completion|embedding}/
 *      ./{operation-group-name}/
 *          ./{prompt-hash-prefix1}/{prompt-hash-prefix2}/
 *              ./{prompt-hash-suffix}.jsonl
 */
 class JsonlCache {


	// Setup with the base dir
	constructor(jsonlDir) {
		this.baseDir = path.resolve(jsonlDir);
	}

	/**
	 * Given the prompt details, search and get the completion record in cache.
	 * Get has been optimized to be performed without file locking.
	 */
	async getCacheCompletion(cacheObj) {
		// Get the full filepath
		let filePath = cacheObj._jsonlFilePath;
		if( filePath == null ) {
			filePath = cacheObj._jsonlFilePath = path.resolve(this.baseDir, getCacheFilePath("completion", cacheObj));
		}
		
		// Scan the file, if it exists
		// this is done without file locking, as a performance speed up
		// for cache hit, at the cost of higher latency on cache miss
		//
		// additionally because it can cause read/write contention - it can fail.
		// as such any error here is ignored.
		if( await fileExist(fullPath) ) {
			try {
				// Scan the various jsonl lines
				const rl = jsonl.readlines(fullPath);
				while(true) {
					const {value, done} = await rl.next();
					if(done) break;

					// Check the tempKey
					if( value.tempKey != cacheObj.tempKey ) {
						continue;
					}

					// Reject non matching prompt
					if( value.prompt != prompt ) {
						continue;
					}

					// Return the completion
					return value.completion;
				}
			} catch(e) {
				// exception is ignored
			}
		} else {
			// Preamptively create the parent dir, without awaiting
			// this helps speed up addCache in subsequent call
			fs.promises.mkdir( path.dirname(filePath), { recursive: true } );
		}

		// End is reached, nothign found, return null
		return null;
	}

	/**
	 * Given the prompt details, add the completion record into cache
	 */
	async addCacheCompletion(cacheObj, completion) {
		// Get the full filepath
		let filePath = cacheObj._jsonlFilePath;
		if( filePath == null ) {
			filePath = cacheObj._jsonlFilePath = path.resolve(this.baseDir, getCacheFilePath("completion", cacheObj));
		}
		
		// Get the write lock
		let lockRelease = await lockfile.lock(filePath, { realpath:false });
		
		// Perform actions within a lock
		try {
			// Scan the file, as race conditions are possible
			if( await this.getCacheCompletion(cacheObj) != null ) {
				// Abort write, as record already exists
				return;
			}

			// Prepare the jsonl obj
			let jsonLineObj = { 
				prompt:prompt, 
				completion:completion,
				opt: cacheObj.cleanOpt
			};

			// Write it
			await fs.promises.appendFile(fullPath, jsonStringify(jsonLineObj)+"\n", { encoding:"utf8" });

			// And return
			return
		} finally {
			// Release the lock
			await lockRelease();
		}
	}

}
module.exports = JsonlCache;