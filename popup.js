const template = document.getElementById('li_template');
const root = document.querySelector('ul');

function summarizeChunk(chunk, element) {
	const el = document.createElement('p');
	el.innerText = "Summarizing...";
	element.querySelector('.summary').append( el );
	return element;

	ai.summarizer.create( {
		type: "tl;dr",
		length: "short"
	} ).then( ( summarizer ) => {
		const sum = summarizer.summarize( chunk );
		sum.then( ( summary ) => {
			el.textContent = summary;
		} );
  } );
}

async function summarizeTab(tab) {
	const element = template.content.firstElementChild.cloneNode(true);
	root.appendChild(element);
	element.setAttribute('id', 'tab-' + tab.id );
	if ( tab.id === chrome.tabs.activeTabId ) {
		element.classList.add('active');
	}

	const title = tab.title.substring(0, 40);

	element.querySelector('.title').textContent = title;
	element.querySelector('a').addEventListener('click', async () => {
		await chrome.tabs.update(tab.id, { active: true });
		await chrome.windows.update(tab.windowId, { focused: true });
	});

	try {
		const result = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => {
				let smartContent = document.querySelector('main, .content, #content, .article')?.innerText;
				return smartContent || document.body.innerText;
			},
		});

		const text = result[0].result;

		for (let i = 0; i < text.length; i += 4000) {
			const chunk = text.slice(i, i + 4000);
			summarizeChunk(chunk, element);
		}
	} catch (error) {
		console.error('Error summarizing tab:', error);
	}
	return element;
}

const tabs = await chrome.tabs.query({
	url: [
	  'https://*/*',
	]
  });
  
for (const tab of tabs) {
	summarizeTab(tab);	
}
// When new tabs are created, we summarize them.
chrome.tabs.onUpdated.addListener( function (tabId, changeInfo, tab) {
	if ( changeInfo.status === 'complete' ) {
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
	root.querySelector(`#tab-${activeInfo.tabId}`).classList.add('active');
});