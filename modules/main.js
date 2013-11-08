/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

load('lib/WindowManager');
load('lib/prefs');

var myPrefs = prefs.createStore('extensions.scrollbar-like-scroller@piro.sakura.ne.jp.');
myPrefs.define('debug',          false);
myPrefs.define('areaSizeRight',  64, 'areaSize.right');
myPrefs.define('areaSizeBottom', 64. 'areaSize.buttom');
myPrefs.define('startThreshold', 12);
myPrefs.define('startDelay',     150);
myPrefs.define('paddingX',       128, 'padding.x');
myPrefs.define('paddingY',       128, 'padding.y');
myPrefs.define('scrollDelay',    50);

Cu.import('resource://gre/modules/Services.jsm');

const TYPE_BROWSER = 'navigator:browser';

function parseTouchEvent(aEvent) {
	var chrome = WindowManager.getWindow(TYPE_BROWSER);
	var content = aEvent.originalTarget;
	content = content.defaultView || content.ownerDocument.defaultView;
	var touch = aEvent.touches[0];
	if (!touch)
		throw new Error('there is no touch!');
	var chromeZoom = chrome.QueryInterface(Ci.nsIInterfaceRequestor)
						.getInterface(Ci.nsIDOMWindowUtils)
						.screenPixelsPerCSSPixel;
	var viewport = chrome.BrowserApp.selectedTab.getViewport();
	var contentZoom = viewport.zoom;
	var parsed = {
		zoom    : contentZoom,
		width   : Math.round(viewport.width),
		height  : Math.round(viewport.height),
		eventX  : Math.round(touch.clientX * contentZoom),
		eventY  : Math.round(touch.clientY * contentZoom)
	};
	var maxXArea = viewport.width * 0.5;
	var rightArea = Math.min(maxXArea, myPrefs.areaSizeRight);
	var maxYArea = viewport.width * 0.5;
	var bottomArea = Math.min(maxYArea, myPrefs.areaSizeBottom);
	parsed.rightEdgeTouching = parsed.width - parsed.eventX <= rightArea;
	parsed.bottomEdgeTouching = parsed.height - parsed.eventY <= bottomArea;

	if (myPrefs.debug && aEvent.type != 'touchmove')
		chrome.NativeWindow.toast.show(aEvent.type+'\n'+
			JSON.stringify(parsed).replace(/,/g,',\n'), 'short');

	return [chrome, content, parsed];
}

var scrollXAxis = false;
var scrollYAxis = false;
function updateScrollPosition(aWindow, aParsedTouch) {
	var x = aWindow.scrollX;
	var y = aWindow.scrollY;
	if (scrollXAxis) {
		let scrollbarWidth = aParsedTouch.width - myPrefs.paddingX;
		let thumbPosition = aParsedTouch.eventX - (myPrefs.paddingX / 2);
		let maxX = aWindow.scrollMaxX + aParsedTouch.width;
		x = maxX * Math.min(Math.max(0, thumbPosition / scrollbarWidth), 1);
	}
	if (scrollYAxis) {
		let scrollbarHeight = aParsedTouch.height - myPrefs.paddingY;
		let thumbPosition = aParsedTouch.eventY - (myPrefs.paddingY / 2);
		let maxY = aWindow.scrollMaxY + aParsedTouch.height;
		y = maxY * Math.min(Math.max(0, thumbPosition / scrollbarHeight), 1);
	}
	aWindow.scrollTo(x, y);
}

var STATE_NONE     = 0;
var STATE_READY    = 1;
var STATE_HANDLING = 2;
var state = STATE_NONE;
var startTime = -1;
var startX = -1;
var startY = -1;

function handleTouchStart(aEvent) {
	if (aEvent.touches.length != 1)
		return;
	var [chrome, content, parsed] = parseTouchEvent(aEvent);
	if (!parsed.rightEdgeTouching && !parsed.bottomEdgeTouching)
		return;
	state = STATE_READY;
	startX = parsed.eventX;
	startY = parsed.eventY;
	startTime = Date.now();
	scrollXAxis = false;
	scrollYAxis = false;
}

function handleTouchEnd(aEvent) {
	if (state == STATE_NONE)
		return;
	if (aEvent.touches.length != 1) {
		state = STATE_NONE;
		return;
	}
	state = STATE_NONE;
	startTime = -1;
	startX = -1;
	startY = -1;
	scrollXAxis = false;
	scrollYAxis = false;
	var [chrome, content, parsed] = parseTouchEvent(aEvent);
	updateScrollPosition(content, parsed);
	aEvent.stopPropagation();
	aEvent.preventDefault();
	chrome.sendMessageToJava({ gecko: { type : 'Panning:Override' } });
}

function handleTouchMove(aEvent) {
	if (state == STATE_NONE)
		return;
	if (aEvent.touches.length != 1) {
		state = STATE_NONE;
		return;
	}
	var [chrome, content, parsed] = parseTouchEvent(aEvent);
	if (state == STATE_READY) {
		if (Date.now() - startTime < myPrefs.startDelay)
			return;
		let threshold = myPrefs.startThreshold;
		scrollXAxis = parsed.bottomEdgeTouching && Math.abs(parsed.eventX - startX) >= threshold;
		scrollYAxis = parsed.rightEdgeTouching && Math.abs(parsed.eventY - startY) >= threshold;
		if (!scrollXAxis && !scrollYAxis)
			return;
		if (myPrefs.debug)
			chrome.NativeWindow.toast.show('start scrollbar like behavior\n'+
				JSON.stringify(parsed).replace(/,/g,',\n'), 'short');
		state = STATE_HANDLING;
	}
	updateScrollPosition(content, parsed);
	aEvent.stopPropagation();
	aEvent.preventDefault();
	chrome.sendMessageToJava({ gecko: { type : 'Panning:Override' } });
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
	myPrefs.destroy();
	myPrefs = undefined;
	prefs = undefined;
	config = undefined;
}
