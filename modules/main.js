/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

load('lib/WindowManager');
load('lib/prefs');

var myPrefs = prefs.createStore('extensions.scrollbar-like-scroller@piro.sakura.ne.jp.');
myPrefs.define('debug',          false);
myPrefs.define('areaSizeLeft',   64, 'areaSize.left');
myPrefs.define('areaSizeRight',  64, 'areaSize.right');
myPrefs.define('areaSizeTop',    64, 'areaSize.top');
myPrefs.define('areaSizeBottom', 64, 'areaSize.buttom');
myPrefs.define('startThreshold', 12);
myPrefs.define('startDelay',     150);
myPrefs.define('offsetX',        '0.05', 'offset.x');
myPrefs.define('offsetMinX',     64,     'offset.minX');
myPrefs.define('offsetY',        '0.05', 'offset.y');
myPrefs.define('offsetMinY',     64,     'offset.minY');
myPrefs.define('thumbEnabled',      true, 'thumb.enabled');
myPrefs.define('thumbExpandedArea', 16,   'thumb.expandedArea');
myPrefs.define('vThumbWidth',       38,   'thumb.vertical.width');
myPrefs.define('vThumbMinHeight',   80,   'thumb.vertical.minHeight');
myPrefs.define('hThumbHeight',      38,   'thumb.horizontal.height');
myPrefs.define('hThumbMinWidth',    80,   'thumb.horizontal.minWidth');

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
	parsed.leftEdgeTouching = parsed.canScrollVertically && parsed.eventX <= parsed.leftArea;
	parsed.rightEdgeTouching = parsed.canScrollVertically && parsed.width - parsed.eventX <= parsed.rightArea;
	parsed.topEdgeTouching = parsed.canScrollHorizontally && parsed.eventY <= parsed.topArea;
	parsed.bottomEdgeTouching = parsed.canScrollHorizontally && parsed.height - parsed.eventY <= parsed.bottomArea;

	return [chrome, content, parsed];
}

function parseClientEvent(aEvent) {
	var chrome = WindowManager.getWindow(TYPE_BROWSER);
	var content = aEvent.originalTarget;
	content = content.defaultView || content.ownerDocument.defaultView;
	var viewport = chrome.BrowserApp.selectedTab.getViewport();
	var [pageWidth, pageHeight] = chrome.BrowserApp.selectedTab.getPageSize(content.document, viewport.width, viewport.height);
	var parsed = {
		zoom       : viewport.zoom,
		width      : viewport.width,
		height     : viewport.height,
		pageWidth  : viewport.pageRight,
		pageHeight : viewport.pageBottom,
		scrollX    : viewport.x,
		scrollY    : viewport.y,
		scrollMaxX : (viewport.pageRight - viewport.width) / viewport.zoom,
		scrollMaxY : (viewport.pageBottom - viewport.height) / viewport.zoom
	};
	parsed.leftArea = Math.min(viewport.width * MAX_SCROLLBAR_SIZE, myPrefs.areaSizeLeft);
	parsed.rightArea = Math.min(viewport.width * MAX_SCROLLBAR_SIZE, myPrefs.areaSizeRight);
	parsed.topArea = Math.min(viewport.width * MAX_SCROLLBAR_SIZE, myPrefs.areaSizeTop);
	parsed.bottomArea = Math.min(viewport.height * MAX_SCROLLBAR_SIZE, myPrefs.areaSizeBottom);
	parsed.canScrollHorizontally = parsed.scrollMaxX / viewport.zoom / viewport.width > MIN_SCROLLABLE_SIZE;
	parsed.canScrollVertically = parsed.scrollMaxY / viewport.zoom / viewport.height > MIN_SCROLLABLE_SIZE;

	if (myPrefs.thumbEnabled) {
		let expandedArea = myPrefs.thumbExpandedArea * viewport.zoom;

		let vThumbStart     = parsed.scrollY - expandedArea;
		let vThumbEnd       = parsed.scrollY + parsed.height + expandedArea;
		let vThumbHeight    = (vThumbEnd - vThumbStart) / parsed.pageHeight * parsed.height;
		let vThumbMinHeight = myPrefs.vThumbMinHeight;
		if (vThumbHeight < vThumbMinHeight) {
			let expand = (vThumbMinHeight - vThumbHeight) / parsed.height * parsed.pageHeight / 2;
			vThumbStart -= expand;
			vThumbEnd   += expand;
		}
		parsed.vThumbStart  = vThumbStart / parsed.pageHeight * parsed.height;
		parsed.vThumbEnd    = vThumbEnd / parsed.pageHeight * parsed.height;
		parsed.vThumbHeight = parsed.vThumbEnd - parsed.vThumbStart;
		parsed.vThumbWidth  = Math.min(viewport.width * MAX_SCROLLBAR_SIZE, myPrefs.vThumbWidth);

		let hThumbStart    = parsed.scrollX - expandedArea;
		let hThumbEnd      = parsed.scrollX + parsed.width + expandedArea;
		let hThumbWidth    = (hThumbEnd - hThumbStart) / parsed.pageWidth * parsed.width;
		let hThumbMinWidth = myPrefs.hThumbMinWidth;
		if (hThumbWidth < hThumbMinWidth) {
			let expand = (hThumbMinWidth - hThumbWidth) / parsed.width * parsed.pageWidth / 2;
			hThumbStart -= expand;
			hThumbEnd   += expand;
		}
		parsed.hThumbStart  = hThumbStart / parsed.pageWidth * parsed.width;
		parsed.hThumbEnd    = hThumbEnd / parsed.pageWidth * parsed.width;
		parsed.hThumbWidth  = parsed.hThumbEnd - parsed.hThumbStart;
		parsed.hThumbHeight = Math.min(viewport.height * MAX_SCROLLBAR_SIZE, myPrefs.hThumbHeight);
	}

	if (myPrefs.debug && aEvent.type != 'touchmove')
		chrome.NativeWindow.toast.show(aEvent.type+'\n'+
			JSON.stringify(parsed).replace(/,/g,',\n'), 'short');

	return [chrome, content, parsed];
}

var scrollHorizontally = false;
var scrollVertically = false;
function updateScrollPosition(aWindow, aParsedTouch) {
	var x = aWindow.scrollX;
	var y = aWindow.scrollY;
	if (scrollHorizontally) {
		let maxX = aParsedTouch.scrollMaxX;
		let offset = Math.max(aParsedTouch.width * parseFloat(myPrefs.offsetX), myPrefs.offsetMinX);
		let position = calculateThumbPositionPercentage(offset, aParsedTouch.width, aParsedTouch.eventX);
		x = maxX * position;
	}
	if (scrollVertically) {
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
	startX = parsed.eventX;
	startY = parsed.eventY;
	if (!parsed.leftEdgeTouching &&
		!parsed.rightEdgeTouching &&
		!parsed.topEdgeTouching &&
		!parsed.bottomEdgeTouching)
		return;
	scrollHorizontally = false;
	scrollVertically = false;
	startTime = Date.now();
	if (myPrefs.thumbEnabled) {
		state = STATE_DETECTED;
		if (parsed.leftEdgeTouching || parsed.rightEdgeTouching) {
			scrollVertically = parsed.eventY >= parsed.vThumbStart && parsed.eventY <= parsed.vThumbEnd;
			showVerticalThumb(content, parsed, 0.5);
		}
		if (parsed.topEdgeTouching || parsed.bottomEdgeTouching) {
			scrollHorizontally = parsed.eventX >= parsed.hThumbStart && parsed.eventX <= parsed.hThumbEnd;
			showHorizontalThumb(content, parsed, 0.5);
		}
		if (!scrollHorizontally && !scrollVertically)
			return;
	}
	state = STATE_READY;
}

function handleTouchEnd(aEvent) {
	if (state == STATE_NONE)
		return;
	state = STATE_NONE;
	startTime = -1;
	scrollHorizontally = false;
	scrollVertically = false;
	var content = aEvent.originalTarget;
	content = content.defaultView || content.ownerDocument.defaultView;
	hideThumb(content, horizontalThumbs);
	hideThumb(content, verticalThumbs);
	aEvent.stopPropagation();
	aEvent.preventDefault();
	var chrome = WindowManager.getWindow(TYPE_BROWSER);
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
		if (!myPrefs.thumbEnabled && !tryActivateScrollbar(parsed)) {
			if (scrollHorizontally)
				showHorizontalThumb(content, parsed, 0.5);
			if (scrollVertically)
				showVerticalThumb(content, parsed, 0.5);
			return;
		}
		state = STATE_HANDLING;
		let timer = clearThumbsTimers.get(chrome);
		if (timer) {
			chrome.clearTimeout(timer);
			clearThumbsTimers.delete(chrome);
		}
	}
	if (scrollHorizontally)
		showHorizontalThumb(content, parsed, 1);
	if (scrollVertically)
		showVerticalThumb(content, parsed, 1);
	updateScrollPosition(content, parsed);
	aEvent.stopPropagation();
	aEvent.preventDefault();
	chrome.sendMessageToJava({ gecko: { type : 'Panning:Override' } });
}

function tryActivateScrollbar(aParsedTouch) {
	if (Date.now() - startTime < myPrefs.startDelay)
		return false;
	var threshold = myPrefs.startThreshold;
	scrollHorizontally = scrollHorizontally && (aParsedTouch.topEdgeTouching || aParsedTouch.bottomEdgeTouching) && Math.abs(aParsedTouch.eventX - startX) >= threshold;
	scrollVertically = scrollVertically && (aParsedTouch.leftEdgeTouching || aParsedTouch.rightEdgeTouching) && Math.abs(aParsedTouch.eventY - startY) >= threshold;
	if (!scrollHorizontally && !scrollVertically)
		return false;
	return true;
}

var clearThumbsTimers = new WeakMap();
function handleScrollEvent(aEvent) {
	if (state != STATE_NONE)
		return;
	var [chrome, content, parsed] = parseClientEvent(aEvent);
	if (parsed.canScrollHorizontally)
		showHorizontalThumb(content, parsed, 0.5);
	if (parsed.canScrollVertically)
		showVerticalThumb(content, parsed, 0.5);

	var timer = clearThumbsTimers.get(chrome);
	if (timer)
		chrome.clearTimeout(timer);
	timer = chrome.setTimeout(function() {
		hideThumb(content, horizontalThumbs);
		hideThumb(content, verticalThumbs);
		clearThumbsTimers.delete(chrome);
	}, 500);
	clearThumbsTimers.set(chrome, timer);
}

var horizontalThumbs = new WeakMap();
var verticalThumbs = new WeakMap();

function showHorizontalThumb(aWindow, aParsedTouch, aOpacity) {
	if (!myPrefs.thumbEnabled)
		return;
	var thumb = horizontalThumbs.get(aWindow);
	if (!thumb) {
		thumb = createThumb(aWindow);
		horizontalThumbs.set(aWindow, thumb);
	}
	updateThumbAppearance({
		thumb       : thumb,
		width       : aParsedTouch.hThumbWidth,
		height      : aParsedTouch.hThumbHeight,
		parsedTouch : aParsedTouch
	});
	var style = thumb.style;
	if (startY < aParsedTouch.height / 3) {
		style.top    = 0;
		style.bottom = 'auto';
	}
	else {
		style.top    = 'auto';
		style.bottom = 0;
	}
	style.display = 'block';
	style.left = (aParsedTouch.hThumbStart / aParsedTouch.zoom) + 'px';
	style.opacity = aOpacity;
}

function showVerticalThumb(aWindow, aParsedTouch, aOpacity) {
	if (!myPrefs.thumbEnabled)
		return;
	var thumb = verticalThumbs.get(aWindow);
	if (!thumb) {
		thumb = createThumb(aWindow);
		verticalThumbs.set(aWindow, thumb);
	}
	updateThumbAppearance({
		thumb       : thumb,
		width       : aParsedTouch.vThumbWidth,
		height      : aParsedTouch.vThumbHeight,
		parsedTouch : aParsedTouch
	});
	var style = thumb.style;
	if (startX < aParsedTouch.width / 3) {
		style.left  = 0;
		style.right = 'auto';
	}
	else {
		style.left  = 'auto';
		style.right = 0;
	}
	style.display = 'block';
	style.top = (aParsedTouch.vThumbStart / aParsedTouch.zoom) + 'px';
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
	style.display      = 'none';
	style.zIndex       = 65000;
	style.background   = 'rgba(0, 0, 0, 0.5)';
	style.border       = thumbBorderWidth + 'px solid rgba(255, 255, 255, 0.75)';
	style.borderRadius = style.MozBorderRadius = thumbBorderRadius + 'px';
	style.position     = 'fixed';
	style.transition   = style.MozTransition = [
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
	horizontalThumbs = undefined;
	verticalThumbs = undefined;
	WindowManager = undefined;
	myPrefs.destroy();
	myPrefs = undefined;
	prefs = undefined;
	config = undefined;
}
