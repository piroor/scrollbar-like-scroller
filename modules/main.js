load('lib/WindowManager');

var config = require('lib/config');
config.setDefault('extensions.scrollbar-like-scroller@piro.sakura.ne.jp.areaSize', 24);

Cu.import('resource://gre/modules/Services.jsm');

const TYPE_BROWSER = 'navigator:browser';

function handleTouchStart(aEvent) {
	WindowManager.getWindow(TYPE_BROWSER).NativeWindow.toast.show('handleTouchStart', 'short');
}

function handleTouchEnd(aEvent) {
	WindowManager.getWindow(TYPE_BROWSER).NativeWindow.toast.show('handleTouchEnd', 'short');
}

function handleTouchMove(aEvent) {
	WindowManager.getWindow(TYPE_BROWSER).NativeWindow.toast.show('handleTouchMove', 'short');
}

function handleWindow(aWindow)
{
	var doc = aWindow.document;
	if (doc.documentElement.getAttribute('windowtype') != TYPE_BROWSER)
		return;

	aWindow.addEventListener('touchstart', handleTouchStart, true);
	aWindow.addEventListener('touchend', handleTouchEnd, true);
	aWindow.addEventListener('touchmove', handleTouchMove, true);
}

WindowManager.getWindows(TYPE_BROWSER).forEach(handleWindow);
WindowManager.addHandler(handleWindow);

function shutdown()
{
	WindowManager.getWindows(TYPE_BROWSER).forEach(function(aWindow) {
		aWindow.removeEventListener('touchstart', handleTouchStart, true);
		aWindow.removeEventListener('touchend', handleTouchEnd, true);
		aWindow.removeEventListener('touchmove', handleTouchMove, true);
	});
	WindowManager = undefined;
	config = undefined;
}
