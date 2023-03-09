// Dependencies
const configObjectMerge = require("@js-util/config-object-merge");
const LayerCache = require("./cache/LayerCache");
const defaultConfig = require("./core/defaultConfig");
const PromiseQueue = require("promise-queue")
const sleep = require('sleep-promise');
const jsonStringify = require('fast-json-stable-stringify');

// Initialize the tokenizer
const GPT3Tokenizer = require('gpt3-tokenizer').default;
const tokenizer = new GPT3Tokenizer({ type: 'gpt3' });

// OpenAI calls
const getChatCompletion = require("./openai/getChatCompletion");
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
		this.layerCache = new LayerCache(this.config.cache);

		// Get the openai key 
		this._openai_key = this.config.provider.openai;
		if( this._openai_key == null || this._openai_key == "" ) {
			throw "Missing valid openai key"
		}

		// Setup the promise queue
		this._pQueue = new PromiseQueue(this.config.providerRateLimit);
	}

	/**
	 * Perform any async setup, as required
	 */
	async setup() {
		if( this.layerCache ) {
			await this.layerCache.setup();
		}
	}

	/**
	 * Given the prompt string, get the token count - not actually cached
	 * (Should I?)
	 * 
	 * @param {String} prompt 
	 */
	async getTokenCount(prompt) {
		return (tokenizer.encode( prompt )).bpe.length;
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
		// self ref
		let self = this;

		// Safety
		if( streamListener == null ) {
			streamListener = () => {};
		}

		// Merge the options with the default
		let opt = Object.assign({}, this.config.default.completion, promptOpts);
		opt.prompt = prompt;

		// Parse the prompt, and compute its token count
		let promptTokenObj = tokenizer.encode( prompt );

		// Normalize "max_tokens" auto
		if( opt.max_tokens == "auto" || opt.max_tokens == null ) {
			let totalTokens = opt.total_tokens || 4090;
			opt.max_tokens = totalTokens - promptTokenObj.bpe.length;
			if( opt.max_tokens <= 50 ) {
				throw `Prompt is larger or nearly equal to total token count (${promptTokenObj.bpe.length}/${totalTokens})`;
			}
		}

		// Generate the temp key, in accordence to the tempreture setting
		if( tempKey < 0 ) {
			if( opt.temperature == 0 ) {
				tempKey = 0;
			}

			let tempRange = parseFloat(opt.temperature) * parseFloat(this.config.temperatureKeyMultiplier);
			if( Math.floor(tempRange) <= 0 ) {
				tempKey = 0;
			} else {
				tempKey = Math.floor( Math.random() * tempRange );
			}
		}

		// Get the completion from cache if possible
		let cacheRes = await this.layerCache.getCacheCompletion(prompt, opt, cacheGrp, tempKey);
		if (cacheRes != null) {
			await streamListener(cacheRes);
			return {
				completion: cacheRes,
				token: {
					prompt: promptTokenObj.bpe.length,
					completion: (tokenizer.encode( cacheRes )).bpe.length,
					cache: true
				}
			};
		}
		
		// Fallback, get from the openAI API, without caching
		let openai_key = this._openai_key;
		let completionRes = await this._pQueue.add(async function() {
			let ret = await getCompletion(openai_key, opt, streamListener);

			// Thorttling controls
			if(self.config.providerLatencyAdd > 0) {
				await sleep(self.config.providerLatencyAdd);
			}
			return ret;
		});

		// Add to cache
		await this.layerCache.addCacheCompletion(prompt, completionRes, opt, cacheGrp, tempKey);

		// Return full completion
		return {
			completion: completionRes,
			token: {
				prompt: promptTokenObj.bpe.length,
				completion: (tokenizer.encode( completionRes )).bpe.length,
				cache: false
			}
		};
	}

	/**
	 * Get the completion of a chat
	 * 
	 * @param {Array<Object>} messages array, containing object with role/content to use
	 * @param {Object} promptOpts prompt options to use, merged with default
	 * @param {Function} streamListener, for handling streaming requests
	 * 
	 * @param {String} cacheGrp to cache under, used for grouping cache requests
	 * @param {Number} tempKey to use, automatically generated if -1
	 */
	 async getChatCompletion(messages, promptOpts = {}, streamListener = null, cacheGrp = "default", tempKey = -1) {
		// self ref
		let self = this;

		// Safety
		if( streamListener == null ) {
			streamListener = () => {};
		}

		// Normalize prompt if its a string, to the right format
		if( typeof messages == "string" || messages instanceof String ) {
			messages = [{
				role: "user",
				content: messages
			}];
		} else if( !Array.isArray(messages) && messages.role != null && messages.content != null ) {
			messages = [messages];
		}

		// Merge the options with the default
		let opt = Object.assign({}, this.config.default.chat, promptOpts);
		opt.messages = messages;

		// Convert the messages to a string, for cache indexing
		let prompt = jsonStringify(messages);

		// Parse the prompt, and compute its token count
		let promptTokenObj = tokenizer.encode( prompt );

		// Normalize "max_tokens" auto
		if( opt.max_tokens == "auto" || opt.max_tokens == null ) {
			let totalTokens = opt.total_tokens || 4050;
			let tokenLength = promptTokenObj.bpe.length - (messages.length * 2);
			opt.max_tokens = totalTokens - tokenLength
			if( opt.max_tokens <= 50 ) {
				throw `Prompt is larger or nearly equal to total token count (${tokenLength}/${totalTokens})`;
			}
		}

		// Generate the temp key, in accordence to the tempreture setting
		if( tempKey < 0 ) {
			if( opt.temperature == 0 ) {
				tempKey = 0;
			}

			let tempRange = parseFloat(opt.temperature) * parseFloat(this.config.temperatureKeyMultiplier);
			if( Math.floor(tempRange) <= 0 ) {
				tempKey = 0;
			} else {
				tempKey = Math.floor( Math.random() * tempRange );
			}
		}

		// Get the completion from cache if possible
		let cacheRes = await this.layerCache.getCacheChatCompletion(prompt, opt, cacheGrp, tempKey);
		if (cacheRes != null) {
			await streamListener(cacheRes);
			return {
				completion: cacheRes,
				token: {
					prompt: promptTokenObj.bpe.length,
					completion: (tokenizer.encode( cacheRes )).bpe.length,
					cache: true
				}
			};
		}
		
		// Fallback, get from the openAI API, without caching
		let openai_key = this._openai_key;
		let completionRes = await this._pQueue.add(async function() {
			let ret = await getChatCompletion(openai_key, opt, streamListener);

			// Thorttling controls
			if(self.config.providerLatencyAdd > 0) {
				await sleep(self.config.providerLatencyAdd);
			}
			return ret;
		});

		// Add to cache
		await this.layerCache.addCacheChatCompletion(prompt, completionRes, opt, cacheGrp, tempKey);

		// Return full completion
		return {
			completion: completionRes,
			token: {
				prompt: promptTokenObj.bpe.length,
				completion: (tokenizer.encode( completionRes )).bpe.length,
				cache: false
			}
		};
	}

	/**
	 * Get the embedding of the input string
	 * @param {String} prompt 
	 * @param {Object} embeddingOpt 
	 * @param {String} cacheGrp 
	 */
	async getEmbedding(prompt, embeddingOpt = {}, cacheGrp = "default") {
		// self ref
		let self = this;

		// Merge the options with the default
		let opt = Object.assign({}, this.config.default.embedding, embeddingOpt);
		opt.prompt = prompt;

		// Get from the cache
		let cacheRes = await this.layerCache.getCacheEmbedding(prompt, opt, cacheGrp);
		if (cacheRes) {
			return {
				embedding: cacheRes,
				token: {
					embedding: (tokenizer.encode( prompt )).bpe.length,
					cache: true
				}
			};
		}

		// Get the openai embedding
		let openai_key = this._openai_key;
		let embeddingRes = await this._pQueue.add(async function() {
			let ret = await getEmbedding(openai_key, opt);

			// Thorttling controls
			if(self.config.providerLatencyAdd > 0) {
				await sleep(self.config.providerLatencyAdd);
			}
			return ret;
		});

		// Add the result into cache
		await this.layerCache.addCacheEmbedding(prompt, embeddingRes, opt, cacheGrp);

		// And return the result
		return {
			embedding: embeddingRes,
			token: {
				embedding: (tokenizer.encode( prompt )).bpe.length,
				cache: false
			}
		};
	}
}

module.exports = AiBridge;