// Copyright 2022 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const tabs = await chrome.tabs.query({
  url: [
    'https://*/*',
  ]
});

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Collator
const collator = new Intl.Collator();
tabs.sort((a, b) => collator.compare(a.title, b.title));

const template = document.getElementById('li_template');
const elements = new Set();
for (const tab of tabs) {
	const element = template.content.firstElementChild.cloneNode(true);

	chrome.scripting.executeScript({
		target: {tabId: tab.id},
		func: async ( arg ) => {
			let smartContent = document.querySelector('main, .content, #content, .article')?.innerText;
			if ( smartContent ) {
				return smartContent;
			}
			return document.body.innerText;
		},
	}).then(( res ) => {
		const text = res[0].result;

		for (let i = 0; i < text.length; i += 4000) {
			const chunk = text.slice(i, i + 4000);
			ai.summarizer.create( {
				type: "tl;dr",
				length: "short"
			} ).then( ( summarizer ) => {
				const sum = summarizer.summarize( chunk );
				sum.then( ( summary ) => {
					const el = document.createElement('p');
					el.textContent = summary;
					element.querySelector('.summary').append( el );
				} );
		  } );
		}
	}).catch((error) => {
		console.error('Error executing script:', error);
	});

	const title = tab.title.substring(0, 40);

	element.querySelector('.title').textContent = title;
	//element.querySelector('.pathname').textContent = pathname;
	element.querySelector('a').addEventListener('click', async () => {
		// need to focus window as well as the active tab
		await chrome.tabs.update(tab.id, { active: true });
		await chrome.windows.update(tab.windowId, { focused: true });
	});

	elements.add(element);
}
document.querySelector('ul').append(...elements);

