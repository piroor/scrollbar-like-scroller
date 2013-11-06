load('lib/WindowManager');

var config = require('lib/config');
config.setDefault('extensions.scrollbar-like-scroller@piro.sakura.ne.jp.areaSize', 24);

Cu.import('resource://gre/modules/Services.jsm');

const TYPE_BROWSER = 'navigator:browser';

function handleWindow(aWindow)
{
	var doc = aWindow.document;
	if (doc.documentElement.getAttribute('windowtype') != TYPE_BROWSER)
		return;

}

WindowManager.getWindows(TYPE_BROWSER).forEach(handleWindow);
WindowManager.addHandler(handleWindow);

function shutdown()
{
	WindowManager.getWindows(TYPE_BROWSER).forEach(function(aWindow) {
	});
	WindowManager = undefined;
	config = undefined;
}
