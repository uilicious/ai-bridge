//------------------------------------------------------------------
// Dependencies
//------------------------------------------------------------------
const jsonStringify = require('fast-json-stable-stringify');
const crypto = require('crypto');
const JsonlCache = require('./JsonlCache');

//------------------------------------------------------------------
// Utility function
//------------------------------------------------------------------

// Parameters accepted by cleanPrompt
const cleanPromptKeys = [
	"max_tokens",
	"stop",
	"temperature",
	"top_p",
	"presence_penalty",
	"frequency_penalty",
	"best_of",
	"logit_bias",
	"suffix"
];

/**
 * Cleans out the prompt options and make it "cache friendly"
 */
function getCleanPromptOpt(promptOpt) {
	let cleanOpt = {};
	for(const key of cleanPromptKeys) {
		if( promptOpt[key] ) {
			cleanOpt[key] = promptOpt[key];
		}
	}
	return promptOpt;
}

/**
 * Given the string input, get and return the md5 hash
 */
function getHash(str) {
	return crypto.createHash("md5").update(data, "binary").digest("hex");
}

//------------------------------------------------------------------
// Implementation
//------------------------------------------------------------------

/**
 * Provides a multi layer cache, across various cache sources
 * Its primary purpose is to provide caching for prompts and embeddings.
 */
class LayerCache {

	constructor(inConfig) {
		
		if( inConfig.localJsonlDir.enable == true ) {
			this.jsonlCache = new JsonlCache(inConfig.localJsonlDir.path);
		}
		if( inConfig.mongoDB.enable == true ) {
			// @TODO
		}

		// Get the cache settings
		this._promptCache_enable = inConfig.promptCache || false;
		this._embeddingCache_enable = inConfig.embeddingCache || false;
	}

	/**
	 * Given the prompt, and its options, return its completion if its found in cache.
	 * Else return null (no valid result)
	 * 
	 * @param {String} prompt to use
	 * @param {String} cacheGrp to use for caching
	 * @param {Object} promptOpt options to use
	 * @param {int}    tempKey for cache hit
	 */
	async getCacheCompletion(propmpt, promptOpt, cacheGrp = "misc/default", tempKey = 0) {
		// Skip, if disabled
		if( !this._promptCache_enable ) {
			return;
		}

		// Get the clean prompt options
		let cleanOpt = getCleanPromptOpt(promptOpt);

		// Get the hash of both the clean option, and the prompt
		let cleanOptStr = jsonStringify(cleanOpt);
		let hash = getHash(prompt+"-"+cleanOptStr)

		// Prepare the cacheOpt obj
		let cacheObj = {
			cacheGrp: cacheGrp,
			hash: hash,
			tempKey: tempKey,
			promptOpt: promptOpt,
			cleanOpt: cleanOpt,
			cleanOptStr: cleanOptStr
		};

		// Cache result
		let cacheRes = null;

		// Try to get from cache
		if( this.jsonlCache ) {
			cacheRes = this.jsonlCache.getCacheCompletion(cacheObj);
			if( cacheRes ) {
				return cacheRes;
			}
		}

		// Nothing found, return null
		return null;
	}
	
}
module.exports = LayerCache;