'use strict';

function ReadCtrl($scope, $window, feedsService, articlesService, downloadService) {
    
    var Q = require('q');
    var organizer = require('./helpers/articlesOrganizer');
    
    var pageIndex = 0;
    var articlesPerPage = 50;
    var presentedArticles = [];
    var unreadBeforeThisPage = 0;
    var unreadAfterThisPage = 0;
    
    var articlesList = angular.element(".js-articles-list");
    
    function downloadFeeds() {
        if (feedsService.feeds.length === 0 || downloadService.isWorking) {
            return;
        }
        
        downloadService.download()
        .then(showArticles,
        function (failMessage) {
            if (failMessage === 'No connection') {
                $scope.$emit('showNotification', 'It looks like there is no internet connection. Only old articles are shown.');
            }
            showArticles();
        },
        function (progress) {
            var ratio = Math.round(progress.completed / progress.total * 100);
            angular.element('.refreshing__progress-bar').css('width', ratio + '%');
        });
        
        $scope.state = 'refreshing';
        angular.element('.refreshing__progress-bar').css('width', '0%');
    }
    
    function showArticles() {
        var from = pageIndex * articlesPerPage;
        var to = from + articlesPerPage;
        
        var feedUrls;
        if ($scope.selectedCategory.type === 'feed') {
            feedUrls = [$scope.selectedCategory.url];
        } else {
            feedUrls = $scope.selectedCategory.feeds.map(function (feed) {
                return feed.url;
            });
        }
        
        var options = {};
        if ($scope.selectedTag) {
            options.tagId = $scope.selectedTag._id;
        }
        
        articlesService.getArticles(feedUrls, from, to, options)
        .then(function (result) {
            $scope.isPrevPage = (from > 0);
            $scope.isNextPage = (to <= result.numAll);
            
            unreadBeforeThisPage = result.unreadBefore;
            unreadAfterThisPage = result.unreadAfter;
            
            renderArticles(result.articles);
            $scope.$apply();
        });
    }
    
    function renderArticles(articles) {
        organizer.sortChronologically(articles);
        presentedArticles = articles;
        $scope.days = organizer.organizeByDays(articles);
        $scope.state = 'articles';
        
        // little hack to scroll to top every time articles list was updated,
        // but articles list is display: none sometimes and then you have
        // to wait for it to appear to set the scroll
        var interval = setInterval(function () {
            var articlesList = angular.element('.js-articles-list');
            if (articlesList.scrollTop() !== 0) {
                articlesList.scrollTop(0);
            } else {
                clearInterval(interval);
                lazyLoadImages();
            }
        }, 1);
    }
    
    function markAllAsRead() {
        var promises = [];
        $scope.days.forEach(function (day) {
            day.articles.forEach(function (art) {
                if (!art.isRead) {
                    promises.push(art.setIsRead(true));
                }
            });
        });
        Q.all(promises)
        .then(function () {
            // above code changes to read only articles on this side
            // this code marks as read everything on other pages of this list
            var feedUrls = $scope.selectedCategory.feeds.map(function (feed) {
                return feed.url;
            });
            return articlesService.markAllAsReadInFeeds(feedUrls);
        })
        .then(function () {
            unreadBeforeThisPage = 0;
            unreadAfterThisPage = 0;
            $scope.$apply();
        });
    }
    
    $scope.feedsTree = feedsService.tree;
    $scope.all = feedsService;
    $scope.days = [];
    
    $scope.refresh = downloadFeeds;
    $scope.markAllAsRead = markAllAsRead;
    
    // could be any element of feedsService.tree
    $scope.selectedCategory = $scope.all;
    $scope.selectCategory = function (cat) {
        $scope.selectedCategory = cat;
        pageIndex = 0;
        if ($scope.state !== 'noFeeds' && $scope.state !== 'refreshing') {
            showArticles();
        }
    };
    
    $scope.onTagSelected = function () {
        pageIndex = 0;
        showArticles();
    };
    
    $scope.prevPage = function () {
        if ($scope.isPrevPage) {
            pageIndex -= 1;
            showArticles();
        }
    };
    
    $scope.nextPage = function () {
        if ($scope.isNextPage) {
            pageIndex += 1;
            showArticles();
        }
    };
    
    $scope.$on('articleReadStateChanged', function () {
        checkIfAllRead();
        // needed to update unreadArticlesCount, which was recounted automaticly
        // but scope doesn't know it happened
        $scope.$apply();
    });
    
    function checkIfAllRead() {
        if ($scope.selectedCategory.unreadArticlesCount === 0) {
            $scope.$emit('showNotification', 'Everything read here.');
        }
    }
    
    //-----------------------------------------------------
    // Initial actions
    //-----------------------------------------------------
    
    if (feedsService.feeds.length === 0) {
        $scope.state = 'noFeeds';
    } else if ($scope.$parent.lastSignificantEvent === 'appJustStarted' ||
               $scope.$parent.lastSignificantEvent === 'feedAdded' ||
               $scope.$parent.lastSignificantEvent === 'feedsImported') {
        downloadFeeds();
        $scope.$parent.lastSignificantEvent = null;
    } else {
        showArticles();
    }
    
    //-----------------------------------------------------
    // Lazy load images
    //-----------------------------------------------------
    
    var autoScrolling = false;
    
    function lazyLoadImages() {
        if (autoScrolling) {
            // we don't want to load images while autoScrolling,
            // because height of loaded image can raise from 0 to X pixels
            // and it messes with point in page we are scrolling to
            return;
        }
        angular.element('img[data-lazy-src]').each(function (i, elem) {
            var currScroll = angular.element(".js-articles-list").scrollTop();
            var range = $window.outerHeight * 5;
            if (elem.offsetTop >= currScroll &&
                elem.offsetTop < currScroll + range) {
                var jqElem = angular.element(elem);
                var src = jqElem.attr('data-lazy-src');
                jqElem.attr('src', src);
                jqElem.removeAttr('data-lazy-src');
            }
        });
    }
    
    articlesList.scroll(lazyLoadImages);
    
    //-----------------------------------------------------
    // Key bindings
    //-----------------------------------------------------
    
    function keyDownBindings(event) {
        if ($scope.state !== 'articles') {
            return;
        }
        switch (event.keyCode) {
            // up
            case 38:
                scrollTo('-1');
                event.preventDefault();
                break;
            // down
            case 40:
                scrollTo('+1');
                event.preventDefault();
                break;
            // space
            case 32:
                //just prevent default behaviour, to not allow to scroll by space
                event.preventDefault();
                break;
        }
    }
    
    function keyUpBindings(event) {
        if ($scope.state !== 'articles') {
            return;
        }
        switch (event.keyCode) {
            // left
            case 37:
                scrollTo('prev');
                event.preventDefault();
                break;
            // right
            case 39:
                scrollTo('next');
                event.preventDefault();
                break;
            // space
            case 32:
                markFirstAsReadAndScrollToNext();
                event.preventDefault();
                break;
            // enter
            case 13:
                markAllAsRead();
                event.preventDefault();
                break;
        }
    }
    
    document.addEventListener('keydown', keyDownBindings, false);
    document.addEventListener('keyup', keyUpBindings, false);
    
    $scope.$on('$destroy', function () {
        document.removeEventListener('keydown', keyDownBindings, false);
        document.removeEventListener('keyup', keyUpBindings, false);
    });
    
    //-----------------------------------------------------
    // Scrolling to articles
    //-----------------------------------------------------
    
    var currScrollPos;
    var targetScrollPos;
    var scrollInterval;
    
    /**
     * Checks if any part of given article is visible on screen.
     */
    function articleVisibleInViewport(article) {
        var el = angular.element('#' + article.id);
        var bounds = el[0].getBoundingClientRect();
        var notVisible = bounds.bottom < 0 || bounds.top > articlesList.height();
        return !notVisible;
    }
    
    /**
     * Returns first article from top which is partially visible on screen.
     */
    function getFirstVisibleArticle() {
        for (var i = 0; i < presentedArticles.length; i += 1) {
            if (articleVisibleInViewport(presentedArticles[i])) {
                break;
            }
        }
        return presentedArticles[i];
    }
    
    /**
     * Returns next or previous neighbour to given article;
     */
    function getArticleNeighbour(what, referenceArticle) {
        for (var i = 0; i < presentedArticles.length; i += 1) {
            if (presentedArticles[i] === referenceArticle) {
                if (what === 'prev') {
                    if (i === 0) {
                        return null; // first article doesn't have previous
                    }
                    return presentedArticles[i - 1];
                } else if (what === 'next') {
                    if (i === presentedArticles.length - 1) {
                        return null; // last article doesn't have next
                    }
                    return presentedArticles[i + 1];
                }
            }
        }
        
        return null;
    }
    
    function getNextUnreadArticle(referenceArticle) {
        var referenceIndex;
        var mode = 'searchingReference';
        
        for (var i = 0; i < presentedArticles.length; i += 1) {
            if (mode === 'searchingUnread') {
                if (i === referenceIndex) {
                    // done full circle and no unread article found
                    return null;
                } else if (!presentedArticles[i].isRead) {
                    return presentedArticles[i];
                }
                if (i === presentedArticles.length - 1) {
                    // search once again from beginning
                    i = -1;
                }
            }
            if (mode === 'searchingReference') {
                if (presentedArticles[i] === referenceArticle) {
                    referenceIndex = i;
                    mode = 'searchingUnread';
                }
            }
        }
        
        return null;
    }
    
    function scrollTo(what) {
        var position;
        var article;
        
        switch (what) {
            case '+1':
            case '-1':
                var distance = 300;
                if (what === '-1') { distance = -distance; }
                position = articlesList.scrollTop() + distance;
                break;
            case 'nextUnread':
                article = getNextUnreadArticle(getFirstVisibleArticle());
                if (article) {
                    // there is still unread article on this page
                    position = angular.element('#' + article.id)[0].offsetTop - 20;
                } else {
                    // all articles on current page are read
                    if (unreadAfterThisPage > 0) {
                        position = articlesList[0].scrollHeight;
                    } else if (unreadBeforeThisPage > 0) {
                        position = 0;
                    } else {
                        // no article to scroll to
                        return false;
                    }
                }
                break;
            case 'prev':
            case 'next':
                article = getArticleNeighbour(what, getFirstVisibleArticle());
                if (article) {
                    position = angular.element('#' + article.id)[0].offsetTop - 20;
                } else {
                    position = (what === 'prev') ? 0 : articlesList[0].scrollHeight;
                }
                break;
        }
        
        if (position < 0) {
            position = 0;
        } else if (position > articlesList[0].scrollHeight) {
            position = articlesList[0].scrollHeight;
        }
        
        targetScrollPos = position;
        if (scrollInterval === undefined) {
            autoScrolling = true;
            currScrollPos = articlesList.scrollTop();
            scrollInterval = setInterval(autoScrollLoop, 17);
        }
        
        return true;
    }
    
    function autoScrollLoop() {
        var nextScrollPos = currScrollPos + ((targetScrollPos - currScrollPos) / 8);
        
        // if end of scroll
        if (Math.abs(nextScrollPos - currScrollPos) < 0.1) {
            articlesList.scrollTop(targetScrollPos);
            clearInterval(scrollInterval);
            scrollInterval = undefined;
            autoScrolling = false;
            // while autoScrolling we have suspended images lazy loading
            // so now event have to be fired to let them load
            articlesList.scroll();
        }
        
        articlesList.scrollTop(nextScrollPos);
        currScrollPos = nextScrollPos;
    }
    
    function markFirstAsReadAndScrollToNext() {
        var article = getFirstVisibleArticle();
        article.setIsRead(true)
        .then(function () {
            $scope.$apply();
            if (!scrollTo('nextUnread')) {
                checkIfAllRead();
            }
        });
    }
    
    articlesList.bind('contextmenu', markFirstAsReadAndScrollToNext);
    
}