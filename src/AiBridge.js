// Dependencies
const configObjectMerge = require("@js-util/config-object-merge");
const LayerCache = require("./cache/LayerCache");
const defaultConfig = require("./core/defaultConfig");

// Initialize the tokenizer
const GPT3Tokenizer = require('gpt3-tokenizer').default;
const tokenizer = new GPT3Tokenizer({ type: 'gpt3' });

// OpenAI calls
const getCompletion = require("./openai/getCompletion");
const getEmbedding = require("./openai/getEmbedding");

/**
 * Setup the AiBridge instance with the provided configuration
 */
 class AiBridge {

	/**
	 * Setup the bridge with the relevent config. See config.sample.jsonc for more details.
	 * @param {Object} inConfig 
	 */
	constructor(inConfig) {
		// Merge the provided config with default values
		this.config = configObjectMerge(defaultConfig, inConfig, true);

		// Get the layer cache
		this.layerCache = new LayerCache(config.cache);

		// Get the openai key 
		this._openai_key = config.provider.openai;
	}

	/**
	 * Get the completion of the input string
	 * 
	 * @param {String} prompt to use
	 * @param {Object} promptOpts prompt options to use, merged with default
	 * @param {Function} streamListener, for handling streaming requests
	 * 
	 * @param {String} cacheGrp to cache under, used for grouping cache requests
	 * @param {Number} tempKey to use, automatically generated if -1
	 */
	async getCompletion(prompt, promptOpts = {}, streamListener = null, cacheGrp = "default", tempKey = -1) {
		// Safety
		if( streamListener == null ) {
			streamListener = () => {};
		}

		// Merge the options with the default
		let opt = Object.assign({}, this.config.default.completions, promptOpts);
		opt.prompt = prompt;

		// Normalize "max_tokens" auto
		if( opt.max_tokens == "auto" || opt.max_tokens == null ) {
			let totalTokens = opt.total_tokens || 4090;
			let tokenObj = tokenizer.encode( prompt );
			opt.max_tokens = totalTokens - tokenObj.bpe.length;
			if( opt.max_tokens <= 50 ) {
				throw `Prompt is larger or nearly equal to total token count (${tokenObj.bpe.length}/${totalTokens})`;
			}
		}

		// Generate the temp key, in accordence to the tempreture setting
		if( tempKey < 0 ) {
			tempRange = parseFloat(opt.temperature) * parseFloat(this.config.temperatureKeyMultiplier);
			if( Math.floor(tempRange) <= 0 ) {
				tempKey = 0;
			} else {
				tempKey = Math.floor( Math.random() * tempRange );
			}
		}

		// Get the completion from cache if possible
		let cacheRes = await this.layerCache.getCacheCompletion(prompt, opt, cacheGrp, tempKey);
		if (cacheRes) {
			streamListener(cacheRes);
			return cacheRes;
		}
		
		// Fallback, get from the openAI API, without caching
		let completionRes = await getCompletion(this._openai_key, opt, streamListener);

		// Add to cache
		await this.layerCache.addCacheCompletion(prompt, completionRes, opt, cacheGrp, tempKey);

		// Return full completion
		return completionRes;
	}

	/**
	 * Get the embedding of the input string
	 * @param {String} prompt 
	 * @param {Object} embeddingOpt 
	 * @param {String} cacheGrp 
	 */
	async getEmbedding(prompt, embeddingOpt = {}, cacheGrp = "default", tempKey = 0) {
		// Merge the options with the default
		let opt = Object.assign({}, this.config.default.embedding, embeddingOpt);
		opt.prompt = prompt;

		// Get from the cache
		let cacheRes = await this.layerCache.getCacheEmbedding(prompt, embeddingOpt, cacheGrp);
		if (cacheRes) {
			return cacheRes;
		}


		// Get the openai embedding
		let embeddingRes = await getEmbedding(this._openai_key, opt);

		// Add the result into cache
		await this.layerCache.addCacheEmbedding(prompt, embeddingRes, opt, cacheGrp);

		// And return the result
		return embeddingRes;
	}
}

module.exports = AiBridge;