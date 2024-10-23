

## Setup

There is sometimes a bug `The model took too long too many times for this version.`. This is because there is some kind of counter of bugs inside the profile or something and the profile does not want to work.
The way around this is to launch the browser in seperate user profiles, but this means you have to set up gemini nano each time.

### Setting up gemini nano

Launch chrome beta with your new user dir `/Applications/Google\ Chrome\ Beta.app/Contents/MacOS/Google\ Chrome\ Beta --user-data-dir=./chrometest1 --no-first-run`

Go to flags and set up:
- chrome://flags/#optimization-guide-on-device-model => Enable Perf Bypass
- Set up
  - chrome://flags/#prompt-api-for-gemini-nano => Enable
  - chrome://flags/#summarization-api-for-gemini-nano => Enable
- Run `await window.ai.languageModel.capabilities();` in console to download the model. Wait until it says "readily".

## TODO
- Implement BM25 search thru tabs via https://github.com/winkjs/wink-bm25-text-search 
