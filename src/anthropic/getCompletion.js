/**
 * The following script is used to ask a prompt, and return its completion response
 * 
 * This does not perform any caching / saving, and can be imported, or executed directly
 **/

// Default config settings to use
const defaultConfig = {
	"model": "claude-v1-100k",
	"temperature": 0,

	// Slightly less then 100k, to handle descrepencies
	// between claude, and anthropic api
	"total_tokens": 90 * 1000,
	"max_tokens": null,

	// // Default value
	// "top_p": -1,

	// Important note!: we split the endoftext token very
	// intentionally,to avoid causing issues when this file is parsed
	// by GPT-3 based AI.

	// Default stop keyword
	"stop": ["<|"+"endoftext"+"|>", "\n\nHuman:", "\n\nhuman:"],

	// Return as a string if false, 
	// else return the raw anthropic API response
	"rawApi": false
};

/**
 * Given the prompt config, return the API result
 * 
 * @param {String} anthropic_key, apikey for the request
 * @param {String | Object} inConfig, containing the prompt or other properties
 * @param {Function} streamListener, for handling streaming requests
 * @param {String} completionURL to use
 * 
 * @return {Sring | Object} completion string, if rawApi == false (default), else return the raw API JSON response
 */
async function getCompletion(
	anthropic_key, inConfig, 
	streamListener = null, 
	completionURL = 'https://api.anthropic.com/v1/complete'
) {
	// Normalzied string prompt to object
	if (typeof inConfig === 'string' || inConfig instanceof String) {
		inConfig = { prompt: inConfig };
	}
	// Safety
	if( streamListener == null ) {
		streamListener = () => {};
	}

	// Throw on empty prompt
	if( inConfig.prompt == null || inConfig.prompt == "" ) {
		throw "Prompt cannot be empty";
	}

	// Join it together
	let reqJson = Object.assign({}, defaultConfig, inConfig);

	// Extract and remove internal props
	let useRawApi = reqJson.rawApi || false;
	delete reqJson.rawApi;

	// Normalize prompt into a string
	if (typeof reqJson.prompt !== 'string' && !(reqJson.prompt instanceof String)) {
		reqJson.prompt = JSON.stringify(reqJson.prompt);
	}

	// Normalize "max_tokens" auto
	if( reqJson.max_tokens == "auto" || reqJson.max_tokens == null ) {
		let totalTokens = inConfig.total_tokens || 90 * 1000;
		let promptTokenCount = getTokenCount( reqJson.prompt );
		reqJson.max_tokens = totalTokens - promptTokenCount;
		if( reqJson.max_tokens <= 50 ) {
			throw `Prompt is larger or nearly equal to total token count (${promptTokenCount}/${totalTokens})`;
		}
	}

	// Clean out null values, as anthropic does not like it (even if it is by default?)
	for( const key of Object.keys(reqJson) ) {
		if( reqJson[key] === null ) {
			delete reqJson[key];
		}
	}

	// Anthropic does not support presence/frequence penalty
	delete reqJson.presence_penalty;
	delete reqJson.frequency_penalty;

	// Clean out unhandled props
	delete reqJson.total_tokens;
	delete reqJson.completionType;

	// Normalize max_tokens to max_tokens_to_sample
	reqJson.max_tokens_to_sample = reqJson.max_tokens_to_sample || reqJson.max_tokens;
	delete reqJson.max_tokens;
	// Normalize stop array to stop_sequence
	reqJson.stop_sequence = reqJson.stop_sequence || reqJson.stop;
	delete reqJson.stop;

	// The return data to use
	let respJson = null;
	let respErr = null;

	// Decide on how to handle streaming, or non streaming event
	if(reqJson.stream != true) {

		// Non streaming request handling
		//----------------------------------
		for(let tries=0; tries < 2; ++tries) {
			try {
				// Perform the JSON request
				const resp = await fetch(completionURL, {
					method: 'post',
					body: JSON.stringify(reqJson),
					headers: {
						'Content-Type': 'application/json',
						"x-api-key": `${anthropic_key}`
					}
				});
				respJson = await resp.json();
				
				// Throw error accordingly
				if( respJson.error ) {
					// console.warn( "getCompletion API error", respJson.error)
					throw `[${respJson.error.type}] ${respJson.message}`;
				}
		
				// Check for response
				if( respJson.completion ) {

					// Return as it is
					if( useRawApi ) {
						return respJson;
					}

					// Return the completion
					return respJson.completion;
				}

				return null;
			} catch(e) {
				respErr = e;
			}
		}
	} else {

		// Streaming request handling
		//----------------------------------

		// Perform the initial streaming request request
		const resp = await fetch(completionURL, {
			method: 'post',
			body: JSON.stringify(reqJson),
			headers: {
				'Content-Type': 'application/json',
				"x-api-key": `${anthropic_key}`
			}
		});

		// Event based error handling block
		try {
			// Start streaming the result asyncronously
			// and return the full result
			// ---

			// Get the raw API response reader
			const reader = resp.body.getReader();

			// Raw buffer, and the parsed result
			let rawBuffer = "";

			// Last completion streamed
			// because anthropic sends completion in its entirety
			// we need to manually compute the delta for the event
			let lastCompletion = "";

			// Text encoder to use
			const decoder = new TextDecoder();

			// Lets do a while loop, till conditions are met
			while( true ) {

				// Read the value, and done status of the chunk
				const { value, done } = await reader.read();

				// Push into the raw buffer
				if( value ) {
					rawBuffer += decoder.decode(value);
				}

				// Remove starting new line in a stream
				while( rawBuffer.startsWith("\n") ) {
					rawBuffer = rawBuffer.slice(1);
				}

				// Postion tracker
				let doubleNL_pos = -1;

				// Check for double new line, which is the dataEvent terminator
				while( (doubleNL_pos = rawBuffer.indexOf("\n\n")) > 0 || done ) {
					// Get the dataEvent
					const dataEvent = rawBuffer.slice(0, doubleNL_pos).trim();

					// Remove dataEvent and double new line from raw buffer
					rawBuffer = rawBuffer.slice(doubleNL_pos+2);

					// Forward any errors
					if(dataEvent.startsWith("error:")) {
						throw `Unexpected stream request error: ${dataEvent.slice(6)}`
					}

					// Does nothing for "[DONE]" dataEvent,
					if(dataEvent.startsWith("data: [DONE]")) {
						break;
					}

					// Lets process the dataEvent data object
					if(dataEvent.startsWith("data: {")) {
						// Process the json data
						const dataJson = dataEvent.slice(6).trim();
						const dataObj = JSON.parse( dataJson );

						// Handle exception
						if( dataObj.exception ) {
							throw dataObj.exception;
						}

						// Get the completion
						if( dataObj.completion ) {
							// Get the delta completion
							const deltaCompletion = dataObj.completion.slice(lastCompletion.length);
							lastCompletion = dataObj.completion;

							// Stream the event
							await streamListener(deltaCompletion, lastCompletion);

							// Continue
							continue;
						}
					}
					
					// Throw unexpected dataEvent format
					console.warn("Unexpected data event format", dataEvent)
					throw "Unexpected data event format, see warning logs"
				}

				// Break on completion
				if( done ) {
					break;
				}
			}

			// Unexpected end of stream error
			let trimRawBuffer = rawBuffer.trim();
			if(trimRawBuffer.length > 0 ) {
				console.warn("Unexpected end of stream, with unprocessed data -", trimRawBuffer)
				throw "Unexpected end of stream, with unprocessed data, see warning logs for more details";
			}

			// Return the full string
			return lastCompletion;
		} catch (e) {
			console.warn("Unexpected event processing error", e)
			throw "Unexpected event processing error, see warning logs for more details";
		} finally {
			// writer.close();
		}
	}

	// Handle unexpected response
	if( respErr ) {
		console.warn([
			"## Unable to handle prompt for ...",
			JSON.stringify(reqJson),
			"## Recieved response ...",
			JSON.stringify(respJson),
			"## Recieved error ...",
			respErr
		].join("\n"));
	} else {
		console.warn([
			"## Unable to handle prompt for ...",
			JSON.stringify(reqJson),
			"## Recieved response ...",
			JSON.stringify(respJson)
		].join("\n"));
	}
	throw Error("Missing valid anthropic response, please check warn logs for more details")
}

// Export the module
module.exports = getCompletion;
