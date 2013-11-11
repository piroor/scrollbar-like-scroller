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
myPrefs.define('thumbWidth',     38,   'thumb.width');
myPrefs.define('thumbHeight',    38,   'thumb.height');
myPrefs.define('thumbMinWidth',  80,   'thumb.minWidth');
myPrefs.define('thumbMinHeight', 80,   'thumb.minHeight');

Cu.import('resource://gre/modules/Services.jsm');

const TYPE_BROWSER = 'navigator:browser';

const MIN_SCROLLABLE_SIZE = 0.1;
const MAX_SCROLLBAR_SIZE = 0.5;

function parseTouchEvent(aEvent) {
	var touch = aEvent.touches[0];
	if (!touch)
		throw new Error('there is no touch!');

	var [chrome, content, parsed] = parseClientEvent(aEvent);
	parsed.eventX = touch.clientX * parsed.zoom;
	parsed.eventY = touch.clientY * parsed.zoom;
	parsed.rightEdgeTouching = parsed.canScrollYAxis && parsed.width - parsed.eventX <= parsed.rightArea;
	parsed.bottomEdgeTouching = parsed.canScrollXAxis && parsed.height - parsed.eventY <= parsed.bottomArea;

	return [chrome, content, parsed];
}

function parseClientEvent(aEvent) {
	var chrome = WindowManager.getWindow(TYPE_BROWSER);
	var content = aEvent.originalTarget;
	content = content.defaultView || content.ownerDocument.defaultView;
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
		scrollMaxY : (viewport.pageBottom - viewport.height) / viewport.zoom
	};
	parsed.rightArea = Math.min(viewport.width * MAX_SCROLLBAR_SIZE, myPrefs.areaSizeRight);
	parsed.bottomArea = Math.min(viewport.height * MAX_SCROLLBAR_SIZE, myPrefs.areaSizeBottom);
	parsed.canScrollXAxis = parsed.scrollMaxX / viewport.zoom / viewport.width > MIN_SCROLLABLE_SIZE;
	parsed.canScrollYAxis = parsed.scrollMaxY / viewport.zoom / viewport.height > MIN_SCROLLABLE_SIZE;

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
		parsed.thumbVisualWidth = Math.min(viewport.width * MAX_SCROLLBAR_SIZE, myPrefs.thumbWidth);

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
		parsed.thumbVisualHeight = Math.min(viewport.height * MAX_SCROLLBAR_SIZE, myPrefs.thumbHeight);
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
var STATE_DETECTED = 1;
var STATE_READY    = 2;
var STATE_HANDLING = 3;
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
	startX = parsed.eventX;
	startY = parsed.eventY;
	startTime = Date.now();
	if (myPrefs.thumbEnabled) {
		state = STATE_DETECTED;
		if (parsed.rightEdgeTouching) {
			scrollYAxis = parsed.eventY >= parsed.thumbStartY && parsed.eventY <= parsed.thumbEndY;
			showThumbYAxis(content, parsed, 0.5);
		}
		if (parsed.bottomEdgeTouching) {
			scrollXAxis = parsed.eventX >= parsed.thumbStartX && parsed.eventX <= parsed.thumbEndX;
			showThumbXAxis(content, parsed, 0.5);
		}
		if (!scrollXAxis && !scrollYAxis)
			return;
	}
	state = STATE_READY;
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
	hideThumb(content, thumbsXAxis);
	hideThumb(content, thumbsYAxis);
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
	if (state != STATE_HANDLING) {
		if (!tryActivateScrollbar(parsed)) {
			if (scrollXAxis)
				showThumbXAxis(content, parsed, 0.5);
			if (scrollYAxis)
				showThumbYAxis(content, parsed, 0.5);
			return;
		}
		let timer = clearThumbsTimers.get(chrome);
		if (timer) {
			chrome.clearTimeout(timer);
			clearThumbsTimers.delete(chrome);
		}
	}
	if (scrollXAxis)
		showThumbXAxis(content, parsed, 1);
	if (scrollYAxis)
		showThumbYAxis(content, parsed, 1);
	updateScrollPosition(content, parsed);
	aEvent.stopPropagation();
	aEvent.preventDefault();
	chrome.sendMessageToJava({ gecko: { type : 'Panning:Override' } });
}

function tryActivateScrollbar(aParsedTouch) {
	if (Date.now() - startTime < myPrefs.startDelay)
		return false;
	var threshold = myPrefs.startThreshold;
	scrollXAxis = scrollXAxis && aParsedTouch.bottomEdgeTouching && Math.abs(aParsedTouch.eventX - startX) >= threshold;
	scrollYAxis = scrollYAxis && aParsedTouch.rightEdgeTouching && Math.abs(aParsedTouch.eventY - startY) >= threshold;
	if (!scrollXAxis && !scrollYAxis)
		return false;
	state = STATE_HANDLING;
	return true;
}

var clearThumbsTimers = new WeakMap();
function handleScrollEvent(aEvent) {
	if (state != STATE_NONE)
		return;
	var [chrome, content, parsed] = parseClientEvent(aEvent);
	if (parsed.canScrollXAxis)
		showThumbXAxis(content, parsed, 0.5);
	if (parsed.canScrollYAxis)
		showThumbYAxis(content, parsed, 0.5);

	var timer = clearThumbsTimers.get(chrome);
	if (timer)
		chrome.clearTimeout(timer);
	timer = chrome.setTimeout(function() {
		hideThumb(content, thumbsXAxis);
		hideThumb(content, thumbsYAxis);
		clearThumbsTimers.delete(chrome);
	}, 500);
	clearThumbsTimers.set(chrome, timer);
}

var thumbsXAxis = new WeakMap();
var thumbsYAxis = new WeakMap();

function showThumbXAxis(aWindow, aParsedTouch, aOpacity) {
	if (!myPrefs.thumbEnabled)
		return;
	var thumb = thumbsXAxis.get(aWindow);
	if (!thumb) {
		thumb = createThumb(aWindow);
		thumbsXAxis.set(aWindow, thumb);
	}
	var mergin = myPrefs.thumbExpandedArea;
	updateThumbAppearance({
		thumb       : thumb,
		width       : aParsedTouch.thumbWidth - (mergin * 2),
		height      : aParsedTouch.thumbVisualHeight,
		parsedTouch : aParsedTouch
	});
	var style = thumb.style;
	style.bottom = 0;
	style.display = 'block';
	style.left = ((aParsedTouch.thumbStartX + mergin) / aParsedTouch.zoom) + 'px';
	style.opacity = aOpacity;
}

function showThumbYAxis(aWindow, aParsedTouch, aOpacity) {
	if (!myPrefs.thumbEnabled)
		return;
	var thumb = thumbsYAxis.get(aWindow);
	if (!thumb) {
		thumb = createThumb(aWindow);
		thumbsYAxis.set(aWindow, thumb);
	}
	var mergin = myPrefs.thumbExpandedArea;
	updateThumbAppearance({
		thumb       : thumb,
		width       : aParsedTouch.thumbVisualWidth,
		height      : aParsedTouch.thumbHeight - (mergin * 2),
		parsedTouch : aParsedTouch
	});
	var style = thumb.style;
	style.right = 0;
	style.display = 'block';
	style.top = ((aParsedTouch.thumbStartY + mergin) / aParsedTouch.zoom) + 'px';
	style.opacity = aOpacity;
}

function updateThumbAppearance(aParams) {
	var style = aParams.thumb.style;
	var parsed = aParams.parsedTouch;
	style.minHeight = (aParams.height / parsed.zoom) + 'px';
	style.minWidth = (aParams.width / parsed.zoom) + 'px';
	style.borderWidth = (thumbBorderWidth / parsed.zoom) + 'px';
	style.borderRadius = style.MozBorderRadius = (thumbBorderRadius / parsed.zoom) + 'px';
}

function hideThumb(aWindow, aThumbs) {
	var thumb = aThumbs.get(aWindow);
	if (thumb) {
		thumb.parentNode.removeChild(thumb);
		aThumbs.delete(aWindow);
	}
}

var thumbBorderWidth = 4;
var thumbBorderRadius = 8;
function createThumb(aWindow) {
	var thumb = aWindow.document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
	aWindow.document.documentElement.appendChild(thumb);
	var style = thumb.style;
	style.display = 'none';
	style.zIndex = 65000;
	style.background = 'rgba(0, 0, 0, 0.5)';
	style.border = thumbBorderWidth + 'px solid rgba(255, 255, 255, 0.75)';
	style.borderRadius = style.MozBorderRadius = thumbBorderRadius + 'px';
	style.position = 'fixed';
	style.transition = style.MozTransition = [
		'top 0.2s linier',
		'left 0.2s linier',
		'right 0.2s linier',
		'bottom 0.2s linier',
		'opacity 0.2s ease'
	].join('\n');
	style.margin = 'auto';
	return thumb;
}


function handleWindow(aWindow)
{
	var doc = aWindow.document;
	if (doc.documentElement.getAttribute('windowtype') != TYPE_BROWSER)
		return;

	aWindow.addEventListener('touchstart', handleTouchStart, true);
	aWindow.addEventListener('touchend', handleTouchEnd, true);
	aWindow.addEventListener('touchmove', handleTouchMove, true);
	aWindow.addEventListener('scroll', handleScrollEvent, true);
}

WindowManager.getWindows(TYPE_BROWSER).forEach(handleWindow);
WindowManager.addHandler(handleWindow);

function shutdown()
{
	WindowManager.getWindows(TYPE_BROWSER).forEach(function(aWindow) {
		aWindow.removeEventListener('touchstart', handleTouchStart, true);
		aWindow.removeEventListener('touchend', handleTouchEnd, true);
		aWindow.removeEventListener('touchmove', handleTouchMove, true);
		aWindow.removeEventListener('scroll', handleScrollEvent, true);
	});

	clearThumbsTimers = undefined;
	thumbsXAxis = undefined;
	thumbsYAxis = undefined;
	WindowManager = undefined;
	myPrefs.destroy();
	myPrefs = undefined;
	prefs = undefined;
	config = undefined;
}
