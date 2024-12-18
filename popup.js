const template = document.getElementById('li_template');
const root = document.querySelector('ul');
let modelCapabilities = null;
let summarizer = null;
let work = Promise.resolve();
let popActivatedTab = true;
const chunkSize = 4000;

/**
 * Summarizes a chunk of text and appends the result to the element.
 * Creates a promise attached to `work`, so summarizations are created sequentially.
 *
 * @param {Object} summarizer - The summarizer session created by the ai.summarizer.create() function.
 * @param {string} chunk - The chunk of text to summarize, typically 4000 characters or less.
 * @param {Element} element - The HTML element to append the summary to.
 */
function summarizeChunk(summarizer,chunk, element) {
	const el = document.createElement('p');
	element.querySelector('.summary').append( el );

	if ( ! modelCapabilities || modelCapabilities.available === 'none' ) {
		return;
	}

	work = work.then( async () => {
		try {
			// We will use streaming for a nicer UX.
			const summary = summarizer.summarizeStreaming( chunk );
			for await ( const version of summary ) {
				el.innerText = version;
			}
		} catch ( error ) {
			console.warn('Error summarizing chunk:', error, el);
		}
		return Promise.resolve( el );
	} );
}

/**
 * Triggers summarization for a tab.
 *
 * @param {Object} tab - The tab object.
 * @returns {Promise<Element>} A promise that resolves to the created placeholder.
 */
async function summarizeTab( tab ) {
	let element = null;
	element = root.querySelector(`#tab-${tab.id}`);
	if ( element ) {
		element.querySelector('.summary').innerHTML = '';
	} else {
		element = template.content.firstElementChild.cloneNode(true);
		root.prepend(element);
		element.setAttribute('id', 'tab-' + tab.id );
			// When the tab is clicked, we activate it in the browser.
		element.addEventListener('click', async () => {
			// We don't want to scroll to the activated tab when it is clicked from the sidebar
			popActivatedTab = false;
			await chrome.tabs.update(tab.id, { active: true });
			await chrome.windows.update(tab.windowId, { focused: true });
			popActivatedTab = true;
		});
	}

	if ( tab.id === chrome.tabs.activeTabId ) {
		element.classList.add('active');
	}

	const title = tab.title;
	element.querySelector('.title span').textContent = title;
	if ( tab.favIconUrl ) {
		element.querySelector('.title img').classList.remove('hidden');
		element.querySelector('.title img').src = tab.favIconUrl;
	} else {
		element.querySelector('.title img').classList.add('hidden');
	}

	// Check if we have a previous summarization for this URL.
	const previousSummarization = await chrome.storage.sync.get(tab.url);
	if ( previousSummarization[tab.url] ) {
		console.log( 'Found saved summary for ', tab.url, previousSummarization[tab.url] );
		element.querySelector('.summary').innerHTML = previousSummarization[tab.url];
		return element;
	}

	// We need to summarize the tab.
	element.classList.add('working');
	try {
		const summarizer = await ai.summarizer.create( {
			type: "tl;dr",
			length: "short",
			sharedContext: `An article titled ${title}, published under ${tab.url}`,
		} );

		const result = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => {
				// We will try to find the main content of the page.
				const element = document.querySelector(
					// Blog-specific common selectors
					'.blog-post, .blog-entry, .post-body, .entry,' +
					// Original selectors
					'.article, .content, #content main,' +
					// Common article wrappers
					'article, [role="article"], .post-content, .entry-content, .post,' +
					// Common main content areas
					'main, .main, #main, .main-content, #main-content,' +
					// Publisher-specific common selectors
					'.story-body, .article-body, .article__body, .article-content, .article__content'
				);
				if ( element && element.innerText ) {
					return element.innerText;
				}
				if ( document.body && document.body.innerText ) {
					return document.body.innerText;
				}
				return '';
			},
		});

		const text = result[0].result;
		let chunks = 0;
		for (let i = 0; i < text.length; i += chunkSize) {
			const chunk = text.slice(i, i + chunkSize);
			summarizeChunk(summarizer, chunk, element);
			chunks++;
		}
		if ( chunks > 5 ) {
			work = work.then( () => {
				// We have a long list of chunks, we probably need to summarize them in their own right
				const chunksToSummarize = element.querySelector('.summary').innerText;
				element.querySelector('.summary').innerHTML = '';
				summarizeChunk(summarizer, chunksToSummarize, element);
				return Promise.resolve( element );
			} );
		}
		// All chunks are sumarized, so we can save the summarization.
		work.then( () => {
			element.classList.remove('working');
			chrome.storage.sync.set({
				[tab.url]: element.querySelector('.summary').innerHTML
			});
			console.log('Summarization finshed and saved for', tab.url);
			return Promise.resolve( element );
		});
	} catch (error) {
		console.error('Error summarizing tab:', error);
	}
	return element;
}

/**
 * Checks the capabilities of the summarizer model and resolves if model is ready.
 * 
 * @param {Object} capabilities 
 * @returns {Promise<Object>}
 */
function checkCapabilities( capabilities ) {
	if ( capabilities.available === 'none' || capabilities.available === 'no' ) {
		return Promise.reject( capabilities );
	} else if ( capabilities.available === 'readily' ) {
		document.getElementById('container').classList.remove('hidden');
		document.getElementById('setup_instructions').classList.add('hidden');
		modelCapabilities = capabilities;
		return Promise.resolve( capabilities );
	} else if ( capabilities.available === 'after-download' ) {
		// We will trigger the download of the summarizer model and listen for progress.
		console.log('Downloading summarizer model');
		document.getElementById('setup_instructions_ai_summarizer_downloading').classList.remove('hidden');
		const summ = ai.summarizer.create({
			monitor(m) {
				console.log('Summarizer model created', m);
				m.addEventListener('downloadprogress', (e) => {
					console.log(`Downloaded ${e.loaded} of ${e.total} bytes.`);
					const percent = Math.round( ( e.loaded / e.total ) * 100 );
					document.getElementById('setup_instructions_ai_summarizer_downloading').querySelector('span').textContent = percent;
					if ( percent === 100 ) {
						return ai.summarizer.capabilities().then( checkCapabilities );
					}
				});
			}
		});
	} else {
		console.error('Summarizer API returns unknown capabilities:', capabilities);
		return Promise.reject( capabilities );
	}
}

/**
 * Sets up the listeners for the summarizer.
 * 
 * @returns {Promise<void>}
 */
function setUpListeners() {
	if ( ! modelCapabilities ) {
		return;
	}
	// When new tabs are created, we summarize them.
	chrome.tabs.onMoved.addListener( function (tabId, moveInfo) {
		console.log('Tab moved', tabId, moveInfo);
		sortTabs();
	});
	chrome.tabs.onUpdated.addListener( function (tabId, changeInfo, tab) {
		if ( changeInfo.status === 'complete' ) {
			// Get the domain from the tab URL
			const url = new URL( tab.url );
			console.log('Summarizing tab', tab.url);
			if ( url.protocol !== 'http:' && url.protocol !== 'https:' ) {
				// We do not want to summarize exotic protocols.
				console.log('Exotic protocol, quitting summarization', url.protocol, url);
				element.remove();
				return;
			}
			summarizeTab( tab );
		}
	} );

	// When tabs get closed, we remove them from the list.
	chrome.tabs.onRemoved.addListener( function ( tabId ) {
		const element = document.getElementById( 'tab-' + tabId );
		if ( element ) {
			element.remove();
		}
	} );

	chrome.tabs.onActivated.addListener(function(activeInfo) {
		console.log('Tab activated: ', activeInfo.tabId);
		root.querySelectorAll('li').forEach( el => el.classList.remove('active') );
		const element = root.querySelector(`#tab-${activeInfo.tabId}`);
		if ( ! element ) {
			return;
		}
		element.classList.add('active');
		if ( ! popActivatedTab ) {
			return;
		}
		root.prepend( element );
		window.scrollTo( 0, 0 );
	});

	document.getElementById('search').addEventListener('input', function(e) {
		const search = e.target.value;
		if ( search.length === 0 ) {
			// reset states
			root.querySelectorAll('li').forEach( el => {
				if( el.classList.contains('hidden') ) {
					el.classList.remove('hidden')
				}
				if ( el.classList.contains('hasanswer') ) {
					el.classList.remove('hasanswer');
				}
			} );
			document.querySelector('#ask button').style.display = 'none';
			return;
		} else {
			document.querySelector('#ask button').style.display = 'block';
			root.querySelectorAll('li').forEach( el => {
				if ( el.innerText.toLowerCase().includes(search.toLowerCase()) ) {
					el.classList.remove('hidden');
				} else {
					el.classList.add('hidden');
				}
			});
		}
	});

	document.getElementById('ask').addEventListener('submit', function(e) {
		const question = document.getElementById('search').value;
		e.preventDefault();
		ask( question );
	});
	return Promise.resolve();
}

/**
 * Sets up the summarizer.
 */
function setup() {
	if ( ! window.ai || ! window.ai.summarizer ) {
		console.log('No AI instance found', window.ai);
		document.getElementById('setup_instructions').classList.remove('hidden');
		document.getElementById('setup_instructions_ai_summarizer').classList.remove('hidden');
		return;
	}

	const caps = 
	window.ai.summarizer.capabilities()
	.then( checkCapabilities )
	.catch( ( capabilities ) => {
		document.getElementById('setup_instructions_ai_summarizer_unavailable').classList.remove('hidden');
		console.error('Summarizer capabilities check failed', capabilities);
		Promise.reject();
	} );

	caps.then( setUpListeners )
	.then( ( sum ) => chrome.tabs.query({
		url: [
			'https://*/*',
		]
	}) )
	.then( ( tabs ) => {
		if ( ! modelCapabilities ) {
			return;
		}
		tabs.forEach( tab => {
			summarizeTab( tab);
		});
	} )
	.catch( ( error ) => {
		console.error('Summarizer capabilities check failed', error);
	} );

}

document.addEventListener('DOMContentLoaded', setup);

/**
 * Ask a question to the summarizations. It serves as a bit of a RAG.
 * 
 * @param {string} question 
 */
async function ask( question ) {
	console.log('Ask submitted', question);
	const buttonOriginalText = document.querySelector('#ask button').textContent;
	document.querySelector('#ask button').disabled = true;
	document.querySelector('#ask #search').disabled = true;

	const model = await ai.languageModel.create({
		systemPrompt: `You are a helpful assistant that can answer questions about the tabs you have summarized.` + 
		`Please start your response with a single line with YES if the contents of the tab is relevant to the question or NO if it is not.` +
		`If the contents of the tab is relevant, please provide a concise answer to the question based on the contents of the tab in the following lines.`
	} );

	for ( const tab of root.querySelectorAll('li') ) {
		const summary = tab.querySelector('.summary').innerText;
		const title = tab.querySelector('.title span').innerText;
		const session = await model.clone();
		document.querySelector('#ask button').textContent = `Asking ${title}...`;
		try {
			const response = await session.prompt( `The title of the tab is: "${title}"\n\nThe contents of the tab is: "${summary}"\n\nThe question is: "${question}"` );
			console.log('Asked', question, title, response);
			if ( response.trim().startsWith('YES') ) {
				tab.classList.remove('hidden');
				const answer = response.trim().replace('YES', '').trim();
				tab.querySelector('.answer').innerText = answer;
				tab.classList.add('hasanswer');
			}
		} catch ( error ) {
			console.warn( 'Error asking question:', error );
		} finally {
			session.destroy();
		}
	}
	model.destroy();
	document.querySelector('#ask button').disabled = false;
	document.querySelector('#ask #search').disabled = false;
	document.querySelector('#ask button').textContent = buttonOriginalText;
}
