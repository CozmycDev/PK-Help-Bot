const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
var config = require("../config.js");
const API = require("../api.js");

const settings = JSON.parse(fs.readFileSync('./config/stacktrace_config.json', 'utf8'));
const logFiles = settings["file-logging"] || false;

const LLM_MODEL = 'claude-3-haiku-20240307';
const BASE_PROMPT = fs.readFileSync('./config/base_stacktrace_prompt.txt', 'utf8');

let instance = null;

function getClaudeInstance() {
    if (!instance) {
        instance = new AnthropicAsyncClient();
    }
    return instance;
}

class AnthropicAsyncClient {
    constructor() {
        this.client = new Anthropic({
            apiKey: config.getAnthropicToken()
        });
        this.model = LLM_MODEL;
    }

    // Anthropic uses their own token counting, so we don't need a separate tokenizer
    async callAnthropic(systemPrompt, userPrompt, maxTokens, temperature, model) {
        let completed = false;
        let tries = 0;

        console.log(`\n⏲️  -- Requesting (${model}):\n${userPrompt}\n`);

        while (!completed && tries <= 5) {
            try {
                tries += 1;
                const response = await this.client.messages.create({
                    model: model,
                    system: systemPrompt,
                    messages: [
                        { role: 'user', content: userPrompt }
                    ],
                    max_tokens: maxTokens,
                    temperature: temperature
                });

                completed = true;
                const result = response.content[0].text;

                console.log(`\n✔️  -- Finished (${model}):\n${result}\n`);

                const currentTime = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = `./responses/${currentTime}.json`;

                if (logFiles) {
                    fs.mkdirSync('./responses', { recursive: true });

                    const jsonData = JSON.stringify({ 
                        prompt: [userPrompt, systemPrompt].join('\n'), 
                        response: result, 
                        model: model 
                    }, null, 2);
                    fs.writeFileSync(filename, jsonData);
    
                    console.log(`\n💾  -- Saved response as ${filename}\n`);
                }
                
                return { model: model, response: result };

            } catch (error) {
                console.error(`Error occurred: ${error}`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        console.error("Exceeded Anthropic retry limit.");
        return { model: "None", response: "None" };
    }

    async analyzeStackTrace(stackTraceMessage) {
        try {
            const { model, response } = await this.callAnthropic(
                    BASE_PROMPT, 
                    stackTraceMessage, 
                    420,
                    0.05, // lower temperature for more deterministic results
                    LLM_MODEL
                );
            return { model: model, response: response };
        } catch (error) {
            console.error(`\n❌  -- Error (${LLM_MODEL}):\n${error}\n`);
            return { 
                model: "None", 
                response: "There was an error while analyzing your stack trace." 
            };
        }
    }
}

module.exports = {
    getClaudeInstance,
    BASE_PROMPT
};

API.subscribe("reload", () => {
    console.log("Reloading stack trace analyzer prompt...");
    BASE_PROMPT = fs.readFileSync('./config/base_stacktrace_prompt.txt', 'utf8');
});
