/**
 * The following script is used to ask a prompt, and return its completion response
 * 
 * This does not perform any caching / saving, and can be imported, or executed directly
 **/

// Load dependency modules, and keys
const fetch = require("node-fetch");
const GPT3Tokenizer = require('gpt3-tokenizer').default;

// Default config settings to use
const defaultConfig = {
	"model": "text-embedding-ada-002"
};

// Initialize the tokenizer
const tokenizer = new GPT3Tokenizer({ type: 'gpt3' });

/**
 * Given the prompt config, return the API result
 * 
 * @param {String} openai_key, apikey for the request
 * @param {String | Object} inConfig, containing the prompt or other properties
 * @param {Function} streamListener, for handling streaming requests
 * @param {String} completionURL to use
 * 
 * @return {Sring | Object} completion string, if rawApi == false (default), else return the raw API JSON response
 */
async function getCompletion(
    openai_key, inConfig, 
    completionURL = 'https://api.openai.com/v1/embeddings'
) {
	// Normalzied string prompt to object
	if (typeof inConfig === 'string' || inConfig instanceof String) {
		inConfig = { prompt: inConfig };
	}
    
	// Join it together
	let reqJson = Object.assign({}, defaultConfig, inConfig);

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
                    "Authorization": `Bearer ${openai_key}`
                }
            });
            respJson = await resp.json();
    
            // Check for response
            if( respJson.data && respJson.data[0] && respJson.data[0].embedding ) {
                // Return the JSON as it is
                if( useRawApi ) {
                    return respJson;
                }
    
                // Return the full embedding
                return respJson.data[0].embedding;
            }
        } catch(e) {
            respErr = e;
        }
    }
    
	// Handle unexpected response
	if( respErr ) {
		console.warn([
			"## Unable to handle prompt for ...",
			JSON.stringify(reqJson),
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
	throw Error("Missing valid openai response, please check warn logs for more details")
}

// Export the module
module.exports = getCompletion;