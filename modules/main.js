/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

load('lib/WindowManager');
load('lib/prefs');

var PREF_BASE             = 'extensions.scrollbar-like-scroller@piro.sakura.ne.jp.';
var PREF_DEBUG            = PREF_BASE + 'debug';
var PREF_AREA_SIZE_RIGHT  = PREF_BASE + 'areaSize.right';
var PREF_AREA_SIZE_BOTTOM = PREF_BASE + 'areaSize.buttom';
var PREF_START_THRESHOLD  = PREF_BASE + 'startThreshold';
var PREF_START_DELAY      = PREF_BASE + 'startDelay';
var PREF_PADDING_X        = PREF_BASE + 'padding.x';
var PREF_PADDING_Y        = PREF_BASE + 'padding.y';
var PREF_SCROLL_DELAY     = PREF_BASE + 'scrollDelay';

var config = require('lib/config');
config.setDefault(PREF_DEBUG,            false);
config.setDefault(PREF_AREA_SIZE_RIGHT,  64);
config.setDefault(PREF_AREA_SIZE_BOTTOM, 64);
config.setDefault(PREF_START_THRESHOLD,  12);
config.setDefault(PREF_START_DELAY,      150);
config.setDefault(PREF_PADDING_X,        128);
config.setDefault(PREF_PADDING_Y,        128);
config.setDefault(PREF_SCROLL_DELAY,     50);

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
	var rightArea = Math.min(maxXArea, prefs.getPref(PREF_AREA_SIZE_RIGHT));
	var maxYArea = viewport.width * 0.5;
	var bottomArea = Math.min(maxYArea, prefs.getPref(PREF_AREA_SIZE_BOTTOM));
	parsed.rightEdgeTouching = parsed.width - parsed.eventX <= rightArea;
	parsed.bottomEdgeTouching = parsed.height - parsed.eventY <= bottomArea;

	if (prefs.getPref(PREF_DEBUG) && aEvent.type != 'touchmove')
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
		let scrollbarWidth = aParsedTouch.width - prefs.getPref(PREF_PADDING_X);
		let thumbPosition = aParsedTouch.eventX - (prefs.getPref(PREF_PADDING_X) / 2);
		let maxX = aWindow.scrollMaxX + aParsedTouch.width;
		x = maxX * Math.min(Math.max(0, thumbPosition / scrollbarWidth), 1);
	}
	if (scrollYAxis) {
		let scrollbarHeight = aParsedTouch.height - prefs.getPref(PREF_PADDING_Y);
		let thumbPosition = aParsedTouch.eventY - (prefs.getPref(PREF_PADDING_Y) / 2);
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
		if (Date.now() - startTime < prefs.getPref(PREF_START_DELAY))
			return;
		let threshold = prefs.getPref(PREF_START_THRESHOLD);
		scrollXAxis = parsed.bottomEdgeTouching && Math.abs(parsed.eventX - startX) >= threshold;
		scrollYAxis = parsed.rightEdgeTouching && Math.abs(parsed.eventY - startY) >= threshold;
		if (!scrollXAxis && !scrollYAxis)
			return;
		if (prefs.getPref(PREF_DEBUG))
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
	prefs = undefined;
	config = undefined;
}
