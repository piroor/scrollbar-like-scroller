/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

load('lib/WindowManager');
load('lib/prefs');

var myPrefs = prefs.createStore('extensions.scrollbar-like-scroller@piro.sakura.ne.jp.');
myPrefs.define('debug',          false);
myPrefs.define('areaSizeRight',  64, 'areaSize.right');
myPrefs.define('areaSizeBottom', 64, 'areaSize.buttom');
myPrefs.define('startThreshold', 12);
myPrefs.define('startDelay',     150);
myPrefs.define('offsetX',        '0.05', 'offset.x');
myPrefs.define('offsetMinX',     64,    'offset.minX');
myPrefs.define('offsetY',        '0.05', 'offset.y');
myPrefs.define('offsetMinY',     64,    'offset.minY');
myPrefs.define('scrollDelay',    50);
myPrefs.define('thumbEnabled',   true, 'thumb.enabled');
myPrefs.define('thumbExpandedArea', 16, 'thumb.expandedArea');
myPrefs.define('thumbMinWidth',  80,   'thumb.minWidth');
myPrefs.define('thumbMinHeight', 80,   'thumb.minHeight');

Cu.import('resource://gre/modules/Services.jsm');

const TYPE_BROWSER = 'navigator:browser';

function parseTouchEvent(aEvent) {
	var chrome = WindowManager.getWindow(TYPE_BROWSER);
	var content = aEvent.originalTarget;
	content = content.defaultView || content.ownerDocument.defaultView;
	var touch = aEvent.touches[0];
	if (!touch)
		throw new Error('there is no touch!');
	var viewport = chrome.BrowserApp.selectedTab.getViewport();
	var [pageWidth, pageHeight] = chrome.BrowserApp.selectedTab.getPageSize(content.document, viewport.width, viewport.height);
	var parsed = {
		zoom    : viewport.zoom,
		width   : viewport.width,
		height  : viewport.height,
		pageWidth  : viewport.pageRight,
		pageHeight : viewport.pageBottom,
		scrollX    : viewport.x,
		scrollY    : viewport.y,
		scrollMaxX : (viewport.pageRight - viewport.width) / viewport.zoom,
		scrollMaxY : (viewport.pageBottom - viewport.height) / viewport.zoom,
		eventX  : touch.clientX * viewport.zoom,
		eventY  : touch.clientY * viewport.zoom
	};
	var maxXArea = viewport.width * 0.5;
	parsed.rightArea = Math.min(maxXArea, myPrefs.areaSizeRight);
	var maxYArea = viewport.width * 0.5;
	parsed.bottomArea = Math.min(maxYArea, myPrefs.areaSizeBottom);
	parsed.rightEdgeTouching = parsed.width - parsed.eventX <= parsed.rightArea;
	parsed.bottomEdgeTouching = parsed.height - parsed.eventY <= parsed.bottomArea;

	if (myPrefs.thumbEnabled) {
		let expandedArea = myPrefs.thumbExpandedArea * viewport.zoom;

		let thumbStartY = parsed.scrollY - expandedArea;
		let thumbEndY = parsed.scrollY + parsed.height + expandedArea;
		let thumbHeight = (thumbEndY - thumbStartY) / parsed.pageHeight * parsed.height;
		let minHeight = myPrefs.thumbMinHeight;
		if (thumbHeight < minHeight) {
			let expand = (minHeight - thumbHeight) / parsed.height * parsed.pageHeight / 2;
			thumbStartY -= expand;
			thumbEndY += expand;
		}
		parsed.thumbStartY = thumbStartY / parsed.pageHeight * parsed.height;
		parsed.thumbEndY = thumbEndY / parsed.pageHeight * parsed.height;
		parsed.thumbHeight = parsed.thumbEndY - parsed.thumbStartY;

		let thumbStartX = parsed.scrollX - expandedArea;
		let thumbEndX = parsed.scrollX + parsed.width + expandedArea;
		let thumbWidth = (thumbEndX - thumbStartX) / parsed.pageWidth * parsed.width;
		let minWidth = myPrefs.thumbMinWidth;
		if (thumbWidth < minWidth) {
			let expand = (minWidth - thumbWidth) / parsed.width * parsed.pageWidth / 2;
			thumbStartX -= expand;
			thumbEndX += expand;
		}
		parsed.thumbStartX = thumbStartX / parsed.pageWidth * parsed.width;
		parsed.thumbEndX = thumbEndX / parsed.pageWidth * parsed.width;
		parsed.thumbWidth = parsed.thumbEndX - parsed.thumbStartX;
	}

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
		let maxX = aParsedTouch.scrollMaxX;
		let offset = Math.max(aParsedTouch.width * parseFloat(myPrefs.offsetX), myPrefs.offsetMinX);
		let position = calculateThumbPositionPercentage(offset, aParsedTouch.width, aParsedTouch.eventX);
		x = maxX * position;
	}
	if (scrollYAxis) {
		let maxY = aParsedTouch.scrollMaxY;
		let offset = Math.max(aParsedTouch.height * parseFloat(myPrefs.offsetY), myPrefs.offsetMinY);
		let position = calculateThumbPositionPercentage(offset, aParsedTouch.height, aParsedTouch.eventY);
		y = maxY * position;
	}
	aWindow.scrollTo(x, y);
}

function calculateThumbPositionPercentage(aOffset, aSize, aPosition) {
	let scrollbarSize = aSize - (aOffset * 2);
	let percentage = (aPosition - aOffset) / scrollbarSize;
	return Math.min(Math.max(0, percentage), 1)
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
	scrollXAxis = false;
	scrollYAxis = false;
	if (myPrefs.thumbEnabled) {
		if (parsed.rightEdgeTouching)
			scrollYAxis = parsed.eventY >= parsed.thumbStartY && parsed.eventY <= parsed.thumbEndY;
		if (parsed.bottomEdgeTouching)
			scrollXAxis = parsed.eventX >= parsed.thumbStartX && parsed.eventX <= parsed.thumbEndX;
		if (!scrollXAxis && !scrollYAxis)
			return;
	}
	state = STATE_READY;
	startX = parsed.eventX;
	startY = parsed.eventY;
	startTime = Date.now();
}

function handleTouchEnd(aEvent) {
	if (state == STATE_NONE)
		return;
	state = STATE_NONE;
	startTime = -1;
	startX = -1;
	startY = -1;
	scrollXAxis = false;
	scrollYAxis = false;
	var content = aEvent.originalTarget;
	content = content.defaultView || content.ownerDocument.defaultView;
	let (thumb = thumbsXAxis.get(content)) {
		if (thumb) {
			thumb.parentNode.removeChild(thumb);
			thumbsXAxis.set(content, undefined);
		}
	}
	let (thumb = thumbsYAxis.get(content)) {
		if (thumb) {
			thumb.parentNode.removeChild(thumb);
			thumbsYAxis.set(content, undefined);
		}
	}
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
		scrollXAxis = scrollXAxis && parsed.bottomEdgeTouching && Math.abs(parsed.eventX - startX) >= threshold;
		scrollYAxis = scrollYAxis && parsed.rightEdgeTouching && Math.abs(parsed.eventY - startY) >= threshold;
		if (!scrollXAxis && !scrollYAxis)
			return;
		if (myPrefs.debug)
			chrome.NativeWindow.toast.show('start scrollbar like behavior\n'+
				JSON.stringify(parsed).replace(/,/g,',\n'), 'short');
		state = STATE_HANDLING;
	}
	if (scrollXAxis) {
		let thumb = thumbsXAxis.get(content);
		if (!thumb) {
			thumb = createThumb(content);
			thumbsXAxis.set(content, thumb);
		}
		let style = thumb.style;
		style.minHeight = (parsed.bottomArea / parsed.zoom) + 'px';
		style.minWidth = (parsed.thumbWidth / parsed.zoom) + 'px';
		style.bottom = 0;
		style.display = 'block';
		style.left = (parsed.thumbStartX / parsed.zoom) + 'px';
	}
	if (scrollYAxis) {
		let thumb = thumbsYAxis.get(content);
		if (!thumb) {
			thumb = createThumb(content);
			thumbsYAxis.set(content, thumb);
		}
		let style = thumb.style;
		style.minWidth = (parsed.rightArea / parsed.zoom) + 'px';
		style.minHeight = (parsed.thumbHeight / parsed.zoom) + 'px';
		style.display = 'block';
		style.right = 0;
		style.top = (parsed.thumbStartY / parsed.zoom) + 'px';
	}
	updateScrollPosition(content, parsed);
	aEvent.stopPropagation();
	aEvent.preventDefault();
	chrome.sendMessageToJava({ gecko: { type : 'Panning:Override' } });
}

var thumbsXAxis = new WeakMap();
var thumbsYAxis = new WeakMap();

function handleWindow(aWindow)
{
	var doc = aWindow.document;
	if (doc.documentElement.getAttribute('windowtype') != TYPE_BROWSER)
		return;

	aWindow.addEventListener('touchstart', handleTouchStart, true);
	aWindow.addEventListener('touchend', handleTouchEnd, true);
	aWindow.addEventListener('touchmove', handleTouchMove, true);
}

function createThumb(aWindow) {
	var thumb = aWindow.document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
	aWindow.document.documentElement.appendChild(thumb);
	var style = thumb.style;
	style.display = 'none';
	style.zIndex = 65000;
	style.background = 'red';
	style.border = '2px solid red';
	style.position = 'fixed';
	style.MozTransition = 'top 0.2s linier, left 0.2s linier, right 0.2s linier, bottom 0.2s linier, min-width 0.2s ease, min-height 0.2s ease';
	style.margin = 'auto';
	return thumb;
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

	thumbsXAxis = undefined;
	thumbsYAxis = undefined;
	WindowManager = undefined;
	myPrefs.destroy();
	myPrefs = undefined;
	prefs = undefined;
	config = undefined;
}
