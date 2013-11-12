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
myPrefs.define('thumbExpandedArea', 16,   'thumb.expandedArea');
myPrefs.define('vThumbWidth',       38,   'thumb.vertical.width');
myPrefs.define('vThumbMinHeight',   80,   'thumb.vertical.minHeight');
myPrefs.define('hThumbHeight',      38,   'thumb.horizontal.height');
myPrefs.define('hThumbMinWidth',    80,   'thumb.horizontal.minWidth');

Cu.import('resource://gre/modules/Services.jsm');

const TYPE_BROWSER = 'navigator:browser';

const MIN_SCROLLABLE_SIZE = 0.1;
const MAX_SCROLLBAR_SIZE  = 0.3;

const THUMB_BORDER_WIDTH  = 4;
const THUMB_BORDER_RADIUS = 8;

const STATE_NONE     = 0;
const STATE_READY    = 1;
const STATE_HANDLING = 2;

const AXIS_VERTICALLY   = 1;
const AXIS_HORIZONTALLY = 2;

const ANIMATION_DURATION_OPACITY = 200;

function parseTouchEvent(aEvent) {
	var touch = aEvent.touches[0];
	if (!touch)
		throw new Error('there is no touch!');

	var [chrome, content, parsed] = parseClientEvent(aEvent);
	parsed.eventX = touch.clientX * parsed.zoom;
	parsed.eventY = touch.clientY * parsed.zoom;

	parsed.leftEdgeTouching = parsed.canScrollVertically && parsed.eventX <= parsed.leftArea;
	parsed.rightEdgeTouching = parsed.canScrollVertically && parsed.width - parsed.eventX <= parsed.rightArea;
	parsed.canScrollVertically = parsed.leftEdgeTouching || parsed.rightEdgeTouching;
	parsed.onVerticalThumb = parsed.eventY >= parsed.vThumbStart && parsed.eventY <= parsed.vThumbEnd;

	parsed.topEdgeTouching = parsed.canScrollHorizontally && parsed.eventY <= parsed.topArea;
	parsed.bottomEdgeTouching = parsed.canScrollHorizontally && parsed.height - parsed.eventY <= parsed.bottomArea;
	parsed.canScrollHorizontally = parsed.topEdgeTouching || parsed.bottomEdgeTouching;
	parsed.onHorizontalThumb = parsed.eventX >= parsed.hThumbStart && parsed.eventX <= parsed.hThumbEnd;

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

	var expandedArea = myPrefs.thumbExpandedArea * viewport.zoom;

	var vThumbStart     = parsed.scrollY - expandedArea;
	var vThumbEnd       = parsed.scrollY + parsed.height + expandedArea;
	var vThumbHeight    = (vThumbEnd - vThumbStart) / parsed.pageHeight * parsed.height;
	var vThumbMinHeight = myPrefs.vThumbMinHeight;
	if (vThumbHeight < vThumbMinHeight) {
		let expand = (vThumbMinHeight - vThumbHeight) / parsed.height * parsed.pageHeight / 2;
		vThumbStart -= expand;
		vThumbEnd   += expand;
	}
	parsed.vThumbStart  = vThumbStart / parsed.pageHeight * parsed.height;
	parsed.vThumbEnd    = vThumbEnd / parsed.pageHeight * parsed.height;
	parsed.vThumbHeight = parsed.vThumbEnd - parsed.vThumbStart;
	parsed.vThumbWidth  = Math.min(viewport.width * MAX_SCROLLBAR_SIZE, myPrefs.vThumbWidth);

	var hThumbStart    = parsed.scrollX - expandedArea;
	var hThumbEnd      = parsed.scrollX + parsed.width + expandedArea;
	var hThumbWidth    = (hThumbEnd - hThumbStart) / parsed.pageWidth * parsed.width;
	var hThumbMinWidth = myPrefs.hThumbMinWidth;
	if (hThumbWidth < hThumbMinWidth) {
		let expand = (hThumbMinWidth - hThumbWidth) / parsed.width * parsed.pageWidth / 2;
		hThumbStart -= expand;
		hThumbEnd   += expand;
	}
	parsed.hThumbStart  = hThumbStart / parsed.pageWidth * parsed.width;
	parsed.hThumbEnd    = hThumbEnd / parsed.pageWidth * parsed.width;
	parsed.hThumbWidth  = parsed.hThumbEnd - parsed.hThumbStart;
	parsed.hThumbHeight = Math.min(viewport.height * MAX_SCROLLBAR_SIZE, myPrefs.hThumbHeight);

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
	if (!parsed.canScrollVertically &&
		!parsed.canScrollHorizontally)
		return;
	scrollHorizontally = false;
	scrollVertically = false;
	startTime = Date.now();
	if (parsed.canScrollVertically) {
		scrollVertically = parsed.onVerticalThumb;
		showVerticalThumb(content, parsed, 0.5);
	}
	if (parsed.canScrollHorizontally) {
		scrollHorizontally = parsed.onHorizontalThumb;
		showHorizontalThumb(content, parsed, 0.5);
	}
	if (!scrollHorizontally && !scrollVertically)
		return;
	state = STATE_READY;
}

function handleTouchEnd(aEvent) {
	if (state == STATE_NONE)
		return;
	startTime = -1;
	scrollHorizontally = false;
	scrollVertically = false;
	var content = aEvent.originalTarget;
	content = content.defaultView || content.ownerDocument.defaultView;
	clearThumbsWithDelay(content, chrome);
	if (state == STATE_HANDLING) {
		aEvent.stopPropagation();
		aEvent.preventDefault();
		let chrome = WindowManager.getWindow(TYPE_BROWSER);
		chrome.sendMessageToJava({ gecko: { type : 'Panning:Override' } });
	}
	content.setTimeout(function() {
		state = STATE_NONE;
	}, 0);
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
			if (scrollHorizontally)
				showHorizontalThumb(content, parsed, 0.5);
			if (scrollVertically)
				showVerticalThumb(content, parsed, 0.5);
			return;
		}
		state = STATE_HANDLING;
		cancelClearThumbs(chrome);
	}
	if (scrollVertically) {
		showVerticalThumb(content, parsed, 1);
		hideThumb(content, horizontalThumbs);
	}
	if (scrollHorizontally) {
		showHorizontalThumb(content, parsed, 1);
		hideThumb(content, verticalThumbs);
	}
	if (!scrollHorizontally && !scrollVertically)
		return;
	updateScrollPosition(content, parsed);
	aEvent.stopPropagation();
	aEvent.preventDefault();
	chrome.sendMessageToJava({ gecko: { type : 'Panning:Override' } });
}

function tryActivateScrollbar(aParsedTouch) {
	if (Date.now() - startTime < myPrefs.startDelay)
		return false;
	var threshold = myPrefs.startThreshold;
	scrollHorizontally = scrollHorizontally && aParsedTouch.onHorizontalThumb && Math.abs(aParsedTouch.eventX - startX) >= threshold;
	scrollVertically = scrollVertically && aParsedTouch.onVerticalThumb && Math.abs(aParsedTouch.eventY - startY) >= threshold;
	return scrollHorizontally || scrollVertically;
}

function handleScrollEvent(aEvent) {
	if (state != STATE_NONE)
		return;
	var [chrome, content, parsed] = parseClientEvent(aEvent);
	if (parsed.canScrollHorizontally)
		showHorizontalThumb(content, parsed, 0.5);
	if (parsed.canScrollVertically)
		showVerticalThumb(content, parsed, 0.5);
	clearThumbsWithDelay(content, chrome);
}

var clearThumbsTimers = new WeakMap();
function clearThumbsWithDelay(aWindow, aChromeWindow) {
	var chrome = aChromeWindow || WindowManager.getWindow(TYPE_BROWSER);
	var timer = clearThumbsTimers.get(chrome);
	if (timer)
		chrome.clearTimeout(timer);
	timer = chrome.setTimeout(function() {
		hideThumb(aWindow, horizontalThumbs);
		hideThumb(aWindow, verticalThumbs);
		clearThumbsTimers.delete(chrome);
	}, 500);
	clearThumbsTimers.set(chrome, timer);
}

function cancelClearThumbs(aChromeWindow) {
	var chrome = aChromeWindow || WindowManager.getWindow(TYPE_BROWSER);
	var timer = clearThumbsTimers.get(chrome);
	if (timer) {
		chrome.clearTimeout(timer);
		clearThumbsTimers.delete(chrome);
	}
}

var horizontalThumbs = new WeakMap();
var verticalThumbs = new WeakMap();

function showHorizontalThumb(aWindow, aParsedTouch, aOpacity) {
	var thumb = horizontalThumbs.get(aWindow);
	if (!thumb) {
		thumb = createThumb(aWindow, AXIS_HORIZONTALLY);
		horizontalThumbs.set(aWindow, thumb);
	}
	updateThumbAppearance({
		thumb       : thumb,
		width       : aParsedTouch.hThumbWidth,
		height      : aParsedTouch.hThumbHeight,
		parsedTouch : aParsedTouch
	});
	var style = thumb.style;
	if (startY < aParsedTouch.height / 3 && aParsedTouch.topArea > 0) {
		style.top    = 0;
		style.bottom = 'auto';
	}
	else if (aParsedTouch.bottomArea > 0) {
		style.top    = 'auto';
		style.bottom = 0;
	}
	else {
		style.display = 'none';
		return thumb;
	}
	style.display = 'block';
	style.left = (aParsedTouch.hThumbStart / aParsedTouch.zoom) + 'px';
	style.opacity = aOpacity;
	return thumb;
}

function showVerticalThumb(aWindow, aParsedTouch, aOpacity) {
	var thumb = verticalThumbs.get(aWindow);
	if (!thumb) {
		thumb = createThumb(aWindow, AXIS_VERTICALLY);
		verticalThumbs.set(aWindow, thumb);
	}
	updateThumbAppearance({
		thumb       : thumb,
		width       : aParsedTouch.vThumbWidth,
		height      : aParsedTouch.vThumbHeight,
		parsedTouch : aParsedTouch
	});
	var style = thumb.style;
	if (startX < aParsedTouch.width / 3 && aParsedTouch.leftArea > 0) {
		style.left  = 0;
		style.right = 'auto';
	}
	else if (aParsedTouch.rightArea > 0) {
		style.left  = 'auto';
		style.right = 0;
	}
	else {
		style.display = 'none';
		return thumb;
	}
	style.display = 'block';
	style.top = (aParsedTouch.vThumbStart / aParsedTouch.zoom) + 'px';
	style.opacity = aOpacity;
	return thumb;
}

function updateThumbAppearance(aParams) {
	var style = aParams.thumb.style;
	var parsed = aParams.parsedTouch;
	style.minHeight = (aParams.height / parsed.zoom) + 'px';
	style.minWidth = (aParams.width / parsed.zoom) + 'px';
	style.borderWidth = (THUMB_BORDER_WIDTH / parsed.zoom) + 'px';
	style.borderRadius = style.MozBorderRadius = (THUMB_BORDER_RADIUS / parsed.zoom) + 'px';
}

function hideThumb(aWindow, aThumbs) {
	var thumb = aThumbs.get(aWindow);
	if (thumb) {
		thumb.style.opacity = 0;
		aWindow.setTimeout(function() {
			thumb.parentNode.removeChild(thumb);
			aThumbs.delete(aWindow);
		}, ANIMATION_DURATION_OPACITY);
	}
}

function createThumb(aWindow, aAxis) {
	var thumb = aWindow.document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
	aWindow.document.documentElement.appendChild(thumb);
	var style = thumb.style;
	style.display      = 'none';
	style.zIndex       = 65000;
	style.opacity      = 0;
	style.background   = 'rgba(0, 0, 0, 0.5)';
	style.border       = THUMB_BORDER_WIDTH + 'px solid rgba(255, 255, 255, 0.75)';
	style.borderRadius = style.MozBorderRadius = THUMB_BORDER_RADIUS + 'px';
	style.position     = 'fixed';
	var transitions = ['opacity ' + ANIMATION_DURATION_OPACITY + 'ms ease'];
	if (aAxis == AXIS_VERTICALLY) {
		transitions.push('top 0.2s linier');
		transitions.push('bottom 0.2s linier');
	}
	else {
		transitions.push('left 0.2s linier');
		transitions.push('right 0.2s linier');
	}
	style.transition   = style.MozTransition = transitions.join(',');
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
