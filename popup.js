const template = document.getElementById('li_template');
const root = document.querySelector('ul');
let modelCapabilities = null;
let summarizer = null;
let work = Promise.resolve();
const chunkSize = 4000;

function summarizeChunk(summarizer,chunk, element) {
	const el = document.createElement('p');
	el.innerText = "Summarizing a piece of the article...";
	element.querySelector('.summary').append( el );

	if ( modelCapabilities.available === 'none' ) {
		return;
	}

	work = work.then( () => summarizer.summarize( chunk )
		.then( ( summary ) => {
			el.textContent = summary;
			return Promise.resolve( el );
		} ).catch( ( error ) => {
			el.textContent = error.message;
			console.warn('Error summarizing chunk:', error, el);
			return Promise.resolve( el );
		} )
	);
}

async function summarizeTab( summarizer, tab) {
	const element = template.content.firstElementChild.cloneNode(true);
	root.appendChild(element);
	element.setAttribute('id', 'tab-' + tab.id );
	if ( tab.id === chrome.tabs.activeTabId ) {
		element.classList.add('active');
	}

	const title = tab.title;

	element.querySelector('.title').textContent = title;
	element.addEventListener('click', async () => {
		await chrome.tabs.update(tab.id, { active: true });
		await chrome.windows.update(tab.windowId, { focused: true });
	});

	const previousSummarization = await chrome.storage.sync.get(tab.url);
	console.log('previousSummarization', previousSummarization);
	if ( previousSummarization[tab.url] && Array.isArray(previousSummarization[tab.url]) ) {
		console.log( 'Found saved summary for ', tab.url );
		previousSummarization[tab.url].forEach( s => {
			const el = document.createElement('div');
			el.classList.add('summary');
			el.innerText = s;
			element.appendChild( el );
		});
		return element;
	}

	try {
		const result = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => {
				let smartContent = document.querySelector('main, .content, #content, .article')?.innerText;
				return smartContent || document.body.innerText;
			},
		});

		const text = result[0].result;

		for (let i = 0; i < text.length; i += chunkSize) {
			const chunk = text.slice(i, i + chunkSize);
			summarizeChunk(summarizer, chunk, element);
		}
		// All chunks are sumarized, so we can save the summarization.
		work.then( () => {
			chrome.storage.sync.set({
				[tab.url]: Array.from(element.querySelectorAll('.summary')).map( p => p.innerText )
			});
			console.log('Summarization finshed and saved for', tab.url);
			return Promise.resolve( element );
		});
	} catch (error) {
		console.error('Error summarizing tab:', error);
	}
	return element;
}

ai.summarizer.capabilities()
.then( ( capabilities ) => {
	if ( capabilities.available === 'none' ) {
		document.getElementById('model_errors').classList.remove('hidden');
	} else {
		document.getElementById('model_errors').classList.add('hidden');
	}

	modelCapabilities = capabilities;
	return Promise.resolve( capabilities );
} )
.then( () => ai.summarizer.create( {
	type: "tl;dr",
	length: "short"
} ) )
.then( ( sum ) => {
	summarizer = sum;
	console.log('summarizer', summarizer);
	return chrome.tabs.query({
		url: [
			'https://*/*',
		]
	})
} )
.then( ( tabs ) => {
	tabs.forEach( tab => {
		summarizeTab(summarizer, tab);
	});
} );


// When new tabs are created, we summarize them.
chrome.tabs.onUpdated.addListener( function (tabId, changeInfo, tab) {
	if ( changeInfo.status === 'complete' ) {
		summarizeTab( summarizer, tab );
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
	root.querySelector(`#tab-${activeInfo.tabId}`).classList.add('active');
});

document.getElementById('search').addEventListener('input', function(e) {
	const search = e.target.value;
	if ( search.length === 0 ) {
		root.querySelectorAll('li').forEach( el => el.classList.remove('hidden') );
		return;
	} else {
		root.querySelectorAll('li').forEach( el => {
			if ( el.innerText.toLowerCase().includes(search.toLowerCase()) ) {
				el.classList.remove('hidden');
			} else {
				el.classList.add('hidden');
			}
		});
	}
});
