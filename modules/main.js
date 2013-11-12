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

const ANIMATION_DURATION_OPACITY = 500;

function getCurrentStateFromTouchEvent(aEvent) {
	var touch = aEvent.touches[0];
	if (!touch)
		throw new Error('there is no touch!');

	var [chrome, content, state] = getCurrentState(aEvent);
	state.eventX = touch.clientX * state.zoom;
	state.eventY = touch.clientY * state.zoom;

	state.leftEdgeTouching = state.canScrollVertically && state.eventX <= state.leftArea;
	state.rightEdgeTouching = state.canScrollVertically && state.width - state.eventX <= state.rightArea;
	state.canScrollVertically = state.leftEdgeTouching || state.rightEdgeTouching;
	state.onVerticalThumb = state.eventY >= state.vThumbStart && state.eventY <= state.vThumbEnd;

	state.topEdgeTouching = state.canScrollHorizontally && state.eventY <= state.topArea;
	state.bottomEdgeTouching = state.canScrollHorizontally && state.height - state.eventY <= state.bottomArea;
	state.canScrollHorizontally = state.topEdgeTouching || state.bottomEdgeTouching;
	state.onHorizontalThumb = state.eventX >= state.hThumbStart && state.eventX <= state.hThumbEnd;

	if (myPrefs.debug && aEvent.type != 'touchmove')
		chrome.NativeWindow.toast.show(aEvent.type+'\n'+
			JSON.stringify(state).replace(/,/g,',\n'), 'short');

	return [chrome, content, state];
}

function getCurrentState(aEvent) {
	var chrome = WindowManager.getWindow(TYPE_BROWSER);
	var content = chrome.BrowserApp.selectedTab.browser.contentWindow;
	if (aEvent) {
		content = aEvent.originalTarget;
		content = content.defaultView || content.ownerDocument.defaultView;
	}
	var viewport = chrome.BrowserApp.selectedTab.getViewport();
	var [pageWidth, pageHeight] = chrome.BrowserApp.selectedTab.getPageSize(content.document, viewport.width, viewport.height);
	var state = {
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
	state.leftArea = Math.min(viewport.width * MAX_SCROLLBAR_SIZE, myPrefs.areaSizeLeft);
	state.rightArea = Math.min(viewport.width * MAX_SCROLLBAR_SIZE, myPrefs.areaSizeRight);
	state.topArea = Math.min(viewport.width * MAX_SCROLLBAR_SIZE, myPrefs.areaSizeTop);
	state.bottomArea = Math.min(viewport.height * MAX_SCROLLBAR_SIZE, myPrefs.areaSizeBottom);
	state.canScrollHorizontally = state.scrollMaxX / viewport.zoom / viewport.width > MIN_SCROLLABLE_SIZE;
	state.canScrollVertically = state.scrollMaxY / viewport.zoom / viewport.height > MIN_SCROLLABLE_SIZE;

	var expandedArea = myPrefs.thumbExpandedArea * viewport.zoom;

	var vThumbStart     = state.scrollY - expandedArea;
	var vThumbEnd       = state.scrollY + state.height + expandedArea;
	var vThumbHeight    = (vThumbEnd - vThumbStart) / state.pageHeight * state.height;
	var vThumbMinHeight = myPrefs.vThumbMinHeight;
	if (vThumbHeight < vThumbMinHeight) {
		let expand = (vThumbMinHeight - vThumbHeight) / state.height * state.pageHeight / 2;
		vThumbStart -= expand;
		vThumbEnd   += expand;
	}
	state.vThumbStart  = vThumbStart / state.pageHeight * state.height;
	state.vThumbEnd    = vThumbEnd / state.pageHeight * state.height;
	state.vThumbHeight = state.vThumbEnd - state.vThumbStart;
	state.vThumbWidth  = Math.min(viewport.width * MAX_SCROLLBAR_SIZE, myPrefs.vThumbWidth);

	var hThumbStart    = state.scrollX - expandedArea;
	var hThumbEnd      = state.scrollX + state.width + expandedArea;
	var hThumbWidth    = (hThumbEnd - hThumbStart) / state.pageWidth * state.width;
	var hThumbMinWidth = myPrefs.hThumbMinWidth;
	if (hThumbWidth < hThumbMinWidth) {
		let expand = (hThumbMinWidth - hThumbWidth) / state.width * state.pageWidth / 2;
		hThumbStart -= expand;
		hThumbEnd   += expand;
	}
	state.hThumbStart  = hThumbStart / state.pageWidth * state.width;
	state.hThumbEnd    = hThumbEnd / state.pageWidth * state.width;
	state.hThumbWidth  = state.hThumbEnd - state.hThumbStart;
	state.hThumbHeight = Math.min(viewport.height * MAX_SCROLLBAR_SIZE, myPrefs.hThumbHeight);

	return [chrome, content, state];
}

var scrollHorizontally = false;
var scrollVertically = false;
function updateScrollPosition(aWindow, aState) {
	var x = aWindow.scrollX;
	var y = aWindow.scrollY;
	if (scrollHorizontally) {
		let maxX = aState.scrollMaxX;
		let offset = Math.max(aState.width * parseFloat(myPrefs.offsetX), myPrefs.offsetMinX);
		let position = calculateThumbPositionPercentage(offset, aState.width, aState.eventX);
		x = maxX * position;
	}
	if (scrollVertically) {
		let maxY = aState.scrollMaxY;
		let offset = Math.max(aState.height * parseFloat(myPrefs.offsetY), myPrefs.offsetMinY);
		let position = calculateThumbPositionPercentage(offset, aState.height, aState.eventY);
		y = maxY * position;
	}
	aWindow.scrollTo(x, y);
}

function calculateThumbPositionPercentage(aOffset, aSize, aPosition) {
	let scrollbarSize = aSize - (aOffset * 2);
	let percentage = (aPosition - aOffset) / scrollbarSize;
	return Math.min(Math.max(0, percentage), 1)
}

var scrollState = STATE_NONE;
var startTime = -1;
var startX = -1;
var startY = -1;

function handleTouchStart(aEvent) {
	if (aEvent.touches.length != 1)
		return;
	var [chrome, content, state] = getCurrentStateFromTouchEvent(aEvent);
	startX = state.eventX;
	startY = state.eventY;
	if (!state.canScrollVertically &&
		!state.canScrollHorizontally)
		return;
	scrollHorizontally = false;
	scrollVertically = false;
	startTime = Date.now();
	if (state.canScrollVertically) {
		scrollVertically = state.onVerticalThumb;
		showVerticalThumb(content, state, 0.5);
	}
	if (state.canScrollHorizontally) {
		scrollHorizontally = state.onHorizontalThumb;
		showHorizontalThumb(content, state, 0.5);
	}
	if (!scrollHorizontally && !scrollVertically)
		return;
	if (myPrefs.startDelay) {
		let timer = showHideThumbsTimers.get(content);
		if (timer)
			content.clearTimeout(timer);
		timer = content.setTimeout(function() {
			showHideThumbsTimers.delete(content);
			if (scrollVertically)
				showVerticalThumb(content, state, 1);
			if (scrollHorizontally)
				showHorizontalThumb(content, state, 1);
		}, myPrefs.startDelay);
		showHideThumbsTimers.set(content, timer);
	}
	scrollState = STATE_READY;
}

function handleTouchEnd(aEvent) {
	if (scrollState == STATE_NONE)
		return;
	startTime = -1;
	scrollHorizontally = false;
	scrollVertically = false;
	var content = aEvent.originalTarget;
	content = content.defaultView || content.ownerDocument.defaultView;
	var chrome = WindowManager.getWindow(TYPE_BROWSER);
	clearThumbsWithDelay(content);
	if (scrollState == STATE_HANDLING) {
		aEvent.stopPropagation();
		aEvent.preventDefault();
		chrome.sendMessageToJava({ gecko: { type : 'Panning:Override' } });
	}
	content.setTimeout(function() {
		scrollState = STATE_NONE;
	}, 0);
}

function handleTouchMove(aEvent) {
	if (scrollState == STATE_NONE)
		return;
	if (aEvent.touches.length != 1) {
		scrollState = STATE_NONE;
		return;
	}
	var [chrome, content, state] = getCurrentStateFromTouchEvent(aEvent);
	if (scrollState != STATE_HANDLING) {
		if (!tryActivateScrollbar(state)) {
			if (scrollHorizontally)
				showHorizontalThumb(content, state, 0.5);
			if (scrollVertically)
				showVerticalThumb(content, state, 0.5);
			return;
		}
		scrollState = STATE_HANDLING;
		cancelThumbsShowHide(content);
	}
	if (scrollVertically) {
		showVerticalThumb(content, state, 1);
		hideThumb(content, horizontalThumbs);
	}
	if (scrollHorizontally) {
		showHorizontalThumb(content, state, 1);
		hideThumb(content, verticalThumbs);
	}
	if (!scrollHorizontally && !scrollVertically)
		return;
	updateScrollPosition(content, state);
	aEvent.stopPropagation();
	aEvent.preventDefault();
	chrome.sendMessageToJava({ gecko: { type : 'Panning:Override' } });
}

function tryActivateScrollbar(aState) {
	if (Date.now() - startTime < myPrefs.startDelay)
		return false;
	var threshold = myPrefs.startThreshold;
	scrollHorizontally = scrollHorizontally && aState.onHorizontalThumb && Math.abs(aState.eventX - startX) >= threshold;
	scrollVertically = scrollVertically && aState.onVerticalThumb && Math.abs(aState.eventY - startY) >= threshold;
	return scrollHorizontally || scrollVertically;
}

function handleScrollEvent(aEvent) {
	if (scrollState != STATE_NONE)
		return;
	var [chrome, content, state] = getCurrentState(aEvent);
	if (state.canScrollHorizontally)
		showHorizontalThumb(content, state, 0.5);
	if (state.canScrollVertically)
		showVerticalThumb(content, state, 0.5);
	clearThumbsWithDelay(content);
}

var showHideThumbsTimers = new WeakMap();
function clearThumbsWithDelay(aWindow) {
	var timer = showHideThumbsTimers.get(aWindow);
	if (timer)
		aWindow.clearTimeout(timer);
	timer = aWindow.setTimeout(function() {
		hideThumb(aWindow, horizontalThumbs);
		hideThumb(aWindow, verticalThumbs);
		showHideThumbsTimers.delete(aWindow);
	}, 500);
	showHideThumbsTimers.set(aWindow, timer);
}

function cancelThumbsShowHide(aWindow) {
	var timer = showHideThumbsTimers.get(aWindow);
	if (timer) {
		aWindow.clearTimeout(timer);
		showHideThumbsTimers.delete(aWindow);
	}
}

var horizontalThumbs = new WeakMap();
var verticalThumbs = new WeakMap();

function showHorizontalThumb(aWindow, aState, aOpacity) {
	var thumb = horizontalThumbs.get(aWindow);
	if (!thumb) {
		thumb = createThumb(aWindow, AXIS_HORIZONTALLY);
		horizontalThumbs.set(aWindow, thumb);
	}
	updateThumbAppearance({
		thumb  : thumb,
		width  : aState.hThumbWidth,
		height : aState.hThumbHeight,
		state  : aState
	});
	var style = thumb.style;
	if (startY < aState.height / 3 && aState.topArea > 0) {
		style.top    = 0;
		style.bottom = 'auto';
	}
	else if (aState.bottomArea > 0) {
		style.top    = 'auto';
		style.bottom = 0;
	}
	else {
		style.display = 'none';
		return thumb;
	}
	style.display = 'block';
	style.left = (aState.hThumbStart / aState.zoom) + 'px';
	style.opacity = aOpacity;
	return thumb;
}

function showVerticalThumb(aWindow, aState, aOpacity) {
	var thumb = verticalThumbs.get(aWindow);
	if (!thumb) {
		thumb = createThumb(aWindow, AXIS_VERTICALLY);
		verticalThumbs.set(aWindow, thumb);
	}
	updateThumbAppearance({
		thumb  : thumb,
		width  : aState.vThumbWidth,
		height : aState.vThumbHeight,
		state  : aState
	});
	var style = thumb.style;
	if (startX < aState.width / 3 && aState.leftArea > 0) {
		style.left  = 0;
		style.right = 'auto';
	}
	else if (aState.rightArea > 0) {
		style.left  = 'auto';
		style.right = 0;
	}
	else {
		style.display = 'none';
		return thumb;
	}
	style.display = 'block';
	style.top = (aState.vThumbStart / aState.zoom) + 'px';
	style.opacity = aOpacity;
	return thumb;
}

function updateThumbAppearance(aParams) {
	var style = aParams.thumb.style;
	var state = aParams.state;
	style.minHeight = (aParams.height / state.zoom) + 'px';
	style.minWidth = (aParams.width / state.zoom) + 'px';
	style.borderWidth = (THUMB_BORDER_WIDTH / state.zoom) + 'px';
	style.borderRadius = style.MozBorderRadius = (THUMB_BORDER_RADIUS / state.zoom) + 'px';
}

function hideThumb(aWindow, aThumbs) {
	var thumb = aThumbs.get(aWindow);
	if (thumb) {
		thumb.style.opacity = 0;
		aWindow.setTimeout(function() {
			aThumbs.delete(aWindow);
			thumb.parentNode.removeChild(thumb);
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
	style.background   = 'linear-gradient(135deg, ' + [
	                       'rgba(0, 0, 0, 0.5) 0%',
	                       'rgba(40, 52, 59, 0.5) 50%',
	                       'rgba(0, 0, 0, 0.5) 100%'
	                     ].join(',') + ')';
	style.border       = THUMB_BORDER_WIDTH + 'px solid rgba(255, 255, 255, 0.75)';
	style.borderRadius = style.MozBorderRadius = THUMB_BORDER_RADIUS + 'px';
	style.position     = 'fixed';
	style.transition   = style.MozTransition = 'opacity ' + ANIMATION_DURATION_OPACITY + 'ms ease';
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
