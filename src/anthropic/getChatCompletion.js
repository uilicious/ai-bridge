/**
 * The following script is used to ask a prompt, and return its completion response
 * 
 * This does not perform any caching / saving, and can be imported, or executed directly
 **/

const getCompletion = require("./getCompletion");

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
 * NOTE: anthropic does not officially have a chat API, this poly fills it accordingly
 * 
 * @param {String} anthropic_key, apikey for the request
 * @param {String | Object} inConfig, containing the prompt or other properties
 * @param {Function} streamListener, for handling streaming requests
 * @param {String} completionURL to use
 * 
 * @return {Sring | Object} completion string, if rawApi == false (default), else return the raw API JSON response
 */
async function getChatCompletion(
	anthropic_key, inConfig, 
	streamListener = null, 
	completionURL = 'https://api.anthropic.com/v1/complete'
) {
	// Normalzied string prompt to object
	if (typeof inConfig === 'string' || inConfig instanceof String) {
		inConfig = { messages: [{ role:"user", content:inConfig }] };
	}

	// Get the message array
	let messages = inConfig.messages;
	
	// Now we convert this into a full prompt string
	let fullPromptStr = "\n\n";

	// Loop through each message
	for( messageObj of messages ) {
		if( messages.role == "system" ) {
			fullPromptStr += "Human: " + messageObj.content + "\n\n";
		}
		if( messages.role == "user" || messages.role == "human" ) {
			fullPromptStr += "Human: " + messageObj.content + "\n\n";
		}
		if( messages.role == "assistant" ) {
			fullPromptStr += "Assistant: " + messageObj.content + "\n\n";
		}
	}

	// Final leading prompt
	fullPromptStr += "Assistant:";

	// Modify the config
	inConfig.prompt = fullPromptStr;
	delete inConfig.messages;

	// Now that we got the full prompt string, lets adjust the format and pass to getCompletion
	return await getCompletion(anthropic_key, inConfig, streamListener, completionURL);
}

// Export the module
module.exports = getChatCompletion;
