(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        //Allow using this built library as an AMD module
        //in another project. That other project will only
        //see this AMD call, not the internal modules in
        //the closure below.
        define('jssdk', [], factory);
		root.Origin = require('jssdk');
    } else {
        //Browser globals case. Just assign the
        //result to a property on the global.
        root.Origin = factory();
    }
}(this, function () {
/**
 * @license almond 0.3.2 Copyright jQuery Foundation and other contributors.
 * Released under MIT license, http://github.com/requirejs/almond/LICENSE
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part, normalizedBaseParts,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name) {
            name = name.split('/');
            lastIndex = name.length - 1;

            // If wanting node ID compatibility, strip .js from end
            // of IDs. Have to do this here, and not in nameToUrl
            // because node allows either .js or non .js to map
            // to same file.
            if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
            }

            // Starts with a '.' so need the baseName
            if (name[0].charAt(0) === '.' && baseParts) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that 'directory' and not name of the baseName's
                //module. For instance, baseName of 'one/two/three', maps to
                //'one/two/three.js', but we want the directory, 'one/two' for
                //this normalization.
                normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                name = normalizedBaseParts.concat(name);
            }

            //start trimDots
            for (i = 0; i < name.length; i++) {
                part = name[i];
                if (part === '.') {
                    name.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    // If at the start, or previous value is still ..,
                    // keep them so that when converted to a path it may
                    // still work when converted to a path, even though
                    // as an ID it is less than ideal. In larger point
                    // releases, may be better to just kick out an error.
                    if (i === 0 || (i === 1 && name[2] === '..') || name[i - 1] === '..') {
                        continue;
                    } else if (i > 0) {
                        name.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
            //end trimDots

            name = name.join('/');
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {
        if (typeof name !== 'string') {
            throw new Error('See almond README: incorrect module build, no module name');
        }

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("../bower_components/almond/almond", function(){});

(function(root) {
define("promise", [], function() {
  return (function() {
(function(global) {
	if(typeof module !== 'undefined' && module.exports) {
		module.exports = global.Promise ? global.Promise : Promise;
	} else if (!global.Promise) {
		global.Promise = Promise;
	}

	var asap = (function() {
		var callbacks, timeout, hiddenDiv;
		if(global.process && process.nextTick === 'function') {
			return process.nextTick;
		} else if(global.MutationObserver) {
			callbacks = [];
			hiddenDiv = document.createElement("div");
			(new MutationObserver(executeCallbacks)).observe(hiddenDiv, { attributes: true });
			return function (callback) {
				if( !callbacks.length) {
					hiddenDiv.setAttribute('yes', 'no');
				}
				callbacks.push(callback);
			};
		} else if(global.setImmediate) {
			return global.setImmediate;
		} else {
			callbacks = [];
			return function (callback){
				callbacks.push(callback);
				if(!timeout) {
					timeout = setTimeout(executeCallbacks, 0);
				}
			};
		}

		function executeCallbacks() {
			var cbList = callbacks;
			timeout = void 0;
			callbacks = [];
			for(var i = 0, len = cbList.length; i < len; i++) {
				cbList[i]();
			}
		}
	})();

	function bind(fn, thisArg) {
		return function() {
			fn.apply(thisArg, arguments);
		}
	}

	function isArray(value) {
		return Array.isArray ? Array.isArray(value) : Object.prototype.toString.call(value) === "[object Array]"
	}

	function Promise(fn) {
		if (typeof this !== 'object') throw new TypeError('Promises must be constructed via new')
		if (typeof fn !== 'function') throw new TypeError('not a function')
		this._state = null
		this._value = null
		this._deferreds = []

		doResolve(fn, bind(resolve, this), bind(reject, this))
	}

	function handle(deferred) {
		var me = this;
		if (this._state === null) {
			this._deferreds.push(deferred)
			return
		}
		asap(function() {
			var cb = me._state ? deferred.onFulfilled : deferred.onRejected
			if (cb === null) {
				(me._state ? deferred.resolve : deferred.reject)(me._value)
				return
			}
			var ret
			try {
				ret = cb(me._value)
			}
			catch (e) {
				deferred.reject(e)
				return
			}
			deferred.resolve(ret)
		})
	}

	function resolve(newValue) {
		try { //Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
			if (newValue === this) throw new TypeError('A promise cannot be resolved with itself.')
			if (newValue && (typeof newValue === 'object' || typeof newValue === 'function')) {
				var then = newValue.then
				if (typeof then === 'function') {
					doResolve(bind(then, newValue), bind(resolve, this), bind(reject, this))
					return
				}
			}
			this._state = true
			this._value = newValue
			finale.call(this)
		} catch (e) { reject.call(this, e) }
	}

	function reject(newValue) {
		this._state = false
		this._value = newValue
		finale.call(this)
	}

	function finale() {
		for (var i = 0, len = this._deferreds.length; i < len; i++)
			handle.call(this, this._deferreds[i])
		this._deferreds = null
	}

	function Handler(onFulfilled, onRejected, resolve, reject){
		this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null
		this.onRejected = typeof onRejected === 'function' ? onRejected : null
		this.resolve = resolve
		this.reject = reject
	}

	/**
	 * Take a potentially misbehaving resolver function and make sure
	 * onFulfilled and onRejected are only called once.
	 *
	 * Makes no guarantees about asynchrony.
	 */
	function doResolve(fn, onFulfilled, onRejected) {
		var done = false;
		try {
			fn(function (value) {
				if (done) return
				done = true
				onFulfilled(value)
			}, function (reason) {
				if (done) return
				done = true
				onRejected(reason)
			})
		} catch (ex) {
			if (done) return
			done = true
			onRejected(ex)
		}
	}

	Promise.prototype['catch'] = function (onRejected) {
		return this.then(null, onRejected);
	};

	Promise.prototype.then = function(onFulfilled, onRejected) {
		var me = this;
		return new Promise(function(resolve, reject) {
			handle.call(me, new Handler(onFulfilled, onRejected, resolve, reject))
		})
	};

	Promise.all = function () {
		var args = Array.prototype.slice.call(arguments.length === 1 && isArray(arguments[0]) ? arguments[0] : arguments);

		return new Promise(function (resolve, reject) {
			if (args.length === 0) return resolve([]);
			var remaining = args.length;
			function res(i, val) {
				try {
					if (val && (typeof val === 'object' || typeof val === 'function')) {
						var then = val.then;
						if (typeof then === 'function') {
							then.call(val, function (val) { res(i, val) }, reject);
							return;
						}
					}
					args[i] = val;
					if (--remaining === 0) {
						resolve(args);
					}
				} catch (ex) {
					reject(ex);
				}
			}
			for (var i = 0; i < args.length; i++) {
				res(i, args[i]);
			}
		});
	};

	Promise.resolve = function (value) {
		return new Promise(function (resolve) {
			resolve(value);
		});
	};

	Promise.reject = function (value) {
		return new Promise(function (resolve, reject) {
			reject(value);
		});
	};

	Promise.race = function (values) {
		return new Promise(function (resolve, reject) {
			for(var i = 0, len = values.length; i < len; i++) {
				values[i].then(resolve, reject);
			}
		});
	};
})(this);

return root.Promise = Promise;
  }).apply(root, arguments);
});
}(this));

/*jshint strict: false */
/*jshint unused: false */

define('core/Communicator',[], function() {

    /**
    * Determine if the events are equal
    * @param {object} event1
    * @param {object} event2
    * @return {Boolean}
    * @method eventsEqual
    */
    function eventsEqual(event1, event2) {
        return (event1.callback === event2.callback && event1.context === event2.context);
    }

    /**
     * Determines if the event is already in the map
     * @param {Array} arr - array to check
     * @param {object} eventObject - the event information object that we want to check
     * @return {Boolean} determines if it is in the arr or not
     * @method inCallbacks
     */
    function inCallbacks(arr, eventObject) {
        for (var i = 0, j = arr.length; i < j; i++) {
            if (eventsEqual(arr[i], eventObject)) {
                return true;
            }
        }
        return false;
    }

    //use console to output error instead of logger so that we don't create a circular dependency with telemetry
    function outputError(e) {
        if (typeof console.error === 'undefined') {
            console.log(e.message + e.stack);
        } else {
            console.error(e.message + e.stack);
        }
    }

    /**
     * Execute all of the callbacks passed in with the arguments provided
     * @param {Array} callbacks - array of callback objects
     * @param {Array} args - array of arguments to pass to the callbacks
     * @return {void}
     * @method executeCallbacks
     */
    function executeCallbacks(callbacks, args) {
        // execute all of the callbacks, a callback may mutate
        // the state of the array,
        var callbacksCopy = callbacks.slice();
        for (var i = 0, len = callbacksCopy.length; i < len; i++) {
            var callbackObj = callbacksCopy[i];
            //since the callback could cause exception, we want to make sure we trap it
            //and not have it stop the rest of the callbacks from executing
            try {
                callbackObj.callback.apply(callbackObj.context, args);
            } catch (e) {
                outputError(e);
            }
        }
    }

    /**
     * Get the callbacks that are not applied using once,
     * that is callbacks that will be fired again the next
     * time the event is fired.
     * @param {Array} callbacks - array of callbacks objects
     * @return {Array} callbacks - array of callback objects
     * @method getPersistentCallbacks
     */
    function getPersistentCallbacks(callbacks) {
        return callbacks.filter(function(item) {
            return !item.once;
        });
    }

    /**
     * Add an event to the event map
     * @param {object} map - the event map
     * @param {string} eventName - the event name
     * @param {object} eventObject - the event information object
     * @return {void}
     * @method addEvent
     */
    function addEvent(map, eventName, eventObject) {
        if (typeof eventName === 'undefined') {
            throw new Error('Communicator._addEvent: eventName is undefined');
        }
        if (!map[eventName]) {
            map[eventName] = [];
        }
        if (!inCallbacks(map[eventName], eventObject)) {
            map[eventName].push(eventObject);
        }
    }

    /**
     * Create an object with handlers to detach and reattach the event
     * @param {object} obj - the communicator instance
     * @param {string} eventName - the event name to create handlers for
     * @param {object} eventOjbect - the event info object
     * @return {object}
     * @method createHandlers
     */
    function createHandlers(obj, eventName, eventObject) {
        return {
            detach: function() {
                obj.off.call(obj, eventName, eventObject.callback, eventObject.context);
            },
            attach: function() {
                addEvent(obj.map, eventName, eventObject);
            }
        };
    }

    /**
    * @param {Function} fn - the callback function
    * @param {object} context - the event context
    * @param {Boolean} once - if the event should be fired more than once
    * @return {object} the event object
    * @method createEvent
    */
    function createEvent(fn, context, once) {
        var eventContext = context || window;
        return {
            'callback': fn,
            'context': eventContext,
            'once': once
        };
    }

    /**
     * @class Communicator
     */
    function Communicator() {
        this.map = {};
    }

    /**
     * Subscribe to an event so when the event is fired, the callback
     * is executed in the context passed
     * @param {string} eventName - the event name
     * @param {Function} fn - the callback
     * @param {object} context - the context (what this refers to)
     * @return {void}
     * @method on
     */
    Communicator.prototype.on = function(eventName, fn, context) {
        var eventObject = createEvent(fn, context, false);
        addEvent(this.map, eventName, eventObject);
        return createHandlers(this, eventName, eventObject);
    };

    /**
     * Subscribe to an event for the first time that it is fired. When
     * the event is fired for the first time, the callback is fired
     * in the context passed.  Note that this callback is only fired ONCE
     * hence once.
     * @param {string} eventName - the event name
     * @param {Function} fn - the callback
     * @param {object} context - the context (what this refers to)
     * @return {void}
     * @method once
     */
    Communicator.prototype.once = function(eventName, fn, context) {
        var eventObject = createEvent(fn, context, true);
        addEvent(this.map, eventName, eventObject);
        return createHandlers(this, eventName, eventObject);
    };

    /**
     * Remove event subscription
     * @param {string} eventName - the event name
     * @param {Function} fn - the callback
     * @return {void}
     * @method off
     */
    Communicator.prototype.off = function(eventName, fn, context) {
        if (typeof eventName === 'undefined') {
            throw new Error('Communicator.fire: eventName is undefined');
        }
        var callbacks = this.map[eventName],
            eventObject = createEvent(fn, context);
        if (callbacks) {
            for (var i = 0, j = callbacks.length; i < j; i++) {
                if (eventsEqual(callbacks[i], eventObject)) {
                    this.map[eventName].splice(i, 1);
                    break;
                }
            }
        }
    };

    /**
     * Fire the given event, passing in all arguments that are assed
     * @param {string} eventName - the event name
     * @return {void}
     * @method fire
     */
    Communicator.prototype.fire = function(eventName) {
        if (typeof eventName === 'undefined') {
            throw new Error('Communicator.fire: eventName is undefined');
        }
        if (this.map[eventName]) {
            var callbacks = this.map[eventName],
                args = [].slice.call(arguments, 1);
            executeCallbacks(callbacks, args);
            this.map[eventName] = getPersistentCallbacks(callbacks);
        }
    };

    return Communicator;

 });
/*jshint strict: false */
/*jshint unused: false */

define('core/utils',['core/Communicator'], function(Communicator) {
    /**
     * utility functions
     * @module module:utils
     * @memberof module:Origin
     */
    var TYPES = {
        'undefined': 'undefined',
        'number': 'number',
        'boolean': 'boolean',
        'string': 'string',
        '[object Function]': 'function',
        '[object RegExp]': 'regexp',
        '[object Array]': 'array',
        '[object Date]': 'date',
        '[object Error]': 'error'
    };

    var OS_UNKNOWN = 'UnknownOS';
    var OS_WINDOWS = 'PCWIN';
    var OS_MAC = 'MAC';
    var OS_LINUX = 'Linux';
    var osName = OS_UNKNOWN;

    function setOS() {
        if (window.navigator.appVersion.indexOf('Win') !== -1) {
            osName = OS_WINDOWS;
        } else if (window.navigator.appVersion.indexOf('Mac') !== -1) {
            osName = OS_MAC;
        } else if (window.navigator.appVersion.indexOf('Linux') !== -1) {
            osName = OS_LINUX;
        }
    }

    /**
     *
     * @return {String} the type
     */
    function type(o) {
        return TYPES[typeof o] || TYPES[Object.prototype.toString.call(o)] || (o ? 'object' : 'null');
    }

    /**
     *
     * @return {Boolean}
     */
    function isObject(o) {
        var t = type(o);
        return (o && (t === 'object')) || false;
    }

    /**
     * Mix the data together
     * @return {void}
     */
    function mix(oldData, newData) {
        for (var key in newData) {
            if (!newData.hasOwnProperty(key)) {
                continue;
            }
            if (isObject(oldData[key]) && isObject(newData[key])) {
                mix(oldData[key], newData[key]);
            } else {
                oldData[key] = newData[key];
            }
        }
    }

    /**
     * Check if the chain of arguments are defined in the object
     * @param {object} obj - the object to check
     * @param {Array} chain - the chain of properties to check in the object
     * @return {Boolean}
     */
    function isChainDefined(obj, chain) {
        var tobj = obj;
        for (var i = 0, j = chain.length; i < j; i++) {
            if (typeof(tobj[chain[i]]) !== 'undefined') {
                tobj = tobj[chain[i]];
            } else {
                return false;
            }
        }

        return true;
    }

    /**
     * returns the object associated with the defined chain, null if undefined
     * @param {object} obj - the object to check
     * @param {Array} chain - the chain of properties to check in the object
     * @return {Object}
     */
    function getProperty(obj, chain) {
        if (!obj) {
            return null;
        }

        var tobj = obj;
        for (var i = 0, j = chain.length; i < j; i++) {
            if (typeof(tobj[chain[i]]) !== 'undefined') {
                tobj = tobj[chain[i]];
            } else {
                return null;
            }
        }
        return tobj;
    }

    function replaceInObject(data, replacementObject) {
        for (var key in data) {
            if (!data.hasOwnProperty(key)) {
                continue;
            }
            if (typeof data[key] === 'object') {
                replaceInObject(data[key], replacementObject);
            } else {
                for (var prop in replacementObject) {
                    if (replacementObject.hasOwnProperty(prop) && (typeof(data[key]) === 'string')) {
                        data[key] = data[key].replace(prop, replacementObject[prop]);
                    }
                }
            }
        }
    }

    function normalizeOverrides(overrides) {
        //the prod and live versions of env and cmsstage respectively are represented in the apis by omission of any env or cmsstage in the path
        //so we blank them out here
        if (overrides.env.toLowerCase() === 'production') {
            overrides.env = '';
        }

        if (overrides.cmsstage.toLowerCase() === 'live') {
            overrides.cmsstage = '';
        }

        return overrides;
    }



    function replaceTemplatedValuesInConfig(configObject) {
        var env = '',
            version = '',
            cmsstage = '',
            replaceMap;

        if (configObject.overrides) {

            //for prod and live overrides we set them to blank as the urls represent prod/live by omitting env
            normalizeOverrides(configObject.overrides);
            if (configObject.overrides.env) {
                env = configObject.overrides.env + '.';
            }

            if (configObject.overrides.version) {
                version = configObject.overrides.version + '.';
            }

            if (configObject.overrides.cmsstage) {
                cmsstage = configObject.overrides.cmsstage + '/';
            }
        }

        //first we replace the override information in the hostname section
        replaceInObject(configObject.hostname, {
            '{base}': configObject.hostname.base,
            '{env}': env,
            '{version}': version,
            '{cmsstage}': cmsstage
        });

        replaceMap = {
            '{baseapi}': configObject.hostname.baseapi,
            '{basedata}': configObject.hostname.basedata,
            '{basenoversion}': configObject.hostname.basenoversion,
            '{cdn}': configObject.hostname.cdn,
            '{websocket}': configObject.hostname.websocket
        };

        //then lets replace the tokens with the actual hosts in the urls
        replaceInObject(configObject.urls, replaceMap);
        replaceInObject(configObject.dictionary, replaceMap);

    }

    /**
     * Create RFC4122 Vesion 4 UUID value with window.crypto if applicable
     * @method
     * @static
     * @return {string} UUID string
     */
    function generateUUID() {
        /* jshint -W016 */
        var uuid;
        // if window.crypto is supported
        if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
            var idx = -1;
            var buf = new Uint32Array(4);
            window.crypto.getRandomValues(buf);
            uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                idx++;
                var r = (buf[idx>>3] >> ((idx%8)*4))&15;
                var v = c === 'x' ? r : (r&0x3|0x8);
                return v.toString(16);
            });
        } else {
            var d = new Date().getTime();
            //use high-precision timer if available
            if (window.performance && typeof window.performance.now === 'function') {
                d += window.performance.now(); 
            }
            uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = (d + Math.random()*16)%16 | 0;
                d = Math.floor(d/16);
                var v = c === 'x' ? r : (r&0x3|0x8);
                return v.toString(16);
            });
        }
        /* jshint +W016 */
        return uuid;
    }    

    setOS();

    return /**@ lends Origin.module:utils */ {
        Communicator: Communicator,

        /**
         * returns the object associated with the defined chain, null if undefined
         * @method
         * @static
         * @param {object} obj - the object to check
         * @param {Array} chain - the chain of properties to check in the object
         * @return {Object}
         */
        getProperty: getProperty,

        /**
         * Check if the chain of arguments are defined in the object
         * @method
         * @static
         * @param {object} obj - the object to check
         * @param {Array} chain - the chain of properties to check in the object
         * @return {Boolean}
         */
        isChainDefined: isChainDefined,

        /**
         * Mix the data together
         * @method
         * @static
         * @param {object} obj1 - the destination object to mix to
         * @param {object} obj2 - the object to mix from
         */
        mix: mix,
        /**
         * Replaces tokens in config files replaces tokens such as env, cmsstage, version in an object
         * @method
         * @static
         * @param {object} configObject The config object
         */
        replaceTemplatedValuesInConfig: replaceTemplatedValuesInConfig,
        /**
         * return the OS
         * @method
         * @static
         * @return {String}
         */
        os: function() {
            return osName;
        },

        /**
         * Create RFC4122 Vesion 4 UUID value with window.crypto if applicable
         * @method
         * @static
         * @return {string} UUID string
         */
        generateUUID: generateUUID,

        /**
         * OS Constants
         */
        OS_UNKNOWN: OS_UNKNOWN,
        OS_WINDOWS: OS_WINDOWS,
        OS_MAC: OS_MAC,
        OS_LINUX: OS_LINUX

    };
});

/*jshint strict: false */
/*jshint unused: false */

// Just a pass thru to send a telemetry event

// should have NO dependency on anything that requires Origin to be initialized
define('core/telemetry',['core/utils'], function(utils) {
    /**
     * telemtry functions
     * @module module:telemetry
     * @memberof module:Origin
     */

    var myEvents = new utils.Communicator(),

        publicEventEnums = {
            TELEMETRY_EVENT: 'telemetrySendEvent',
            TELEMETRY_PIN_EVENT: 'telemetryPinSendEvent',
            TELEMETRY_PAGEVIEW: 'telemetrySendPageView',
            TELEMETRY_TRANSACTION_EVENT: 'telemetryTransactionEvent',
            TELEMETRY_CLIENT_ACTION: 'telemetryClientAction',
            TELEMETRY_PERFORMANCE_TIMER: 'telemetryPerformanceTimer',
            TELEMETRY_CUSTOM_DIMENSION: 'telemetrySetCustomDimension',

            // social events
            TELEMETRY_FRIEND_REMOVE: 'telemetryFriendRemove',
            TELEMETRY_FRIEND_REMOVE_BLOCK: 'telemetryFriendRemoveBlock',
            TELEMETRY_FRIEND_BLOCK: 'telemetryFriendBlock',
            TELEMETRY_FRIEND_UNBLOCK: 'telemetryFriendUnblock',
            TELEMETRY_FRIEND_REQUEST_ACCEPT: 'telemetryFriendRequestAccept',
            TELEMETRY_FRIEND_REQUEST_REJECT: 'telemetryFriendRequestReject',
            TELEMETRY_FRIEND_REQUEST_SEND: 'telemetryFriendRequestSend',
            TELEMETRY_FRIEND_REQUEST_CANCEL: 'telemetryFriendRequestCancel',
            TELEMETRY_FRIEND_REQUEST_CANCEL_BLOCK: 'telemetryFriendRequestCancelBlock',
            TELEMETRY_FRIEND_REQUEST_IGNORE_BLOCK: 'telemetryFriendRequestIgnoreBlock',
            // friend recommendation
            TELEMETRY_FRIEND_RECOMMENDATION_ADD: 'telemetryFriendRecommendationAdd',
            TELEMETRY_FRIEND_RECOMMENDATION_DISMISS: 'telemetryFriendRecommendationDismiss',
            TELEMETRY_FRIEND_RECOMMENDATION_MORE_INFO: 'telemetryFriendRecommendationMoreInfo',

            // Game Library Context Menu
            TELEMETRY_GAMELIBRARY_CONTEXTMENU: 'telemetryGameLibraryContextMenu',

            // Home Tile DOM loaded
            TELEMETRY_ELEMENT_DOM_LOADED: 'telemetryElementDomLoaded',

            // Store Carousel Rotate
            TELEMETRY_CAROUSEL_ROTATE_EVENT: 'origin-telemetry-carousel-rotate',

            // OGD Cog Menu
            TELEMETRY_OGD_COGMENU: 'telemetryOGDCogMenu',

            // Gifting
            TELEMETRY_GIFTING_NO_SEARCH_RESULT: 'telemetryGiftingNoSearchResults',
            TELEMETRY_GIFTING_START_FLOW: 'telemetryGiftingStartFlow',
            TELEMETRY_GIFTING_MESSAGE_PAGE: 'telemetryGiftingMessagePage',

            // Home Video Tiles Events
            TELEMETRY_TILE_VIDEO_STARTED: 'telemetryHometileVideoStarted',
            TELEMETRY_TILE_VIDEO_ENDED: 'telemetryHometileVideoEnded',

            //game library
            TELEMETRY_DOUBLE_CLICK_LAUNCH_GAME: 'telemetryGameLibraryDoubleClickLaunchGame',
            TELEMETRY_DOUBLE_CLICK_DOWNLOAD_GAME: 'telemetryGameLibraryDoubleClickDownloadGame'
        },

        trackerTypes = {
            TRACKER_MARKETING: 'TRACKER_MARKETING',
            TRACKER_DEV: 'TRACKER_DEV'
        };

    /* jshint camelcase: false */

    /**
     * A transaction item object that can be sent in a transaction event to both GA and PIN.
     *
     * See also {@link sendTransactionEvent}
     *
     * @typedef {Object} TransactionItem
     * @type {Object}
     *
     * @property {string} id - The Item ID, sent to both GA and PIN.
     * @property {string} gaCategory - The category sent to GA as the ItemData.category.
     * @property {string} pinCategory - The category sent to PIN as the asset item category.
     * @property {string} name - The item name, sent to both GA and PIN.
     * @property {float} price - The price of the item, in the currency units specified in {@link sendTransactionEvent}.
     * @property {string} revenueModel - This is the receipt.products[i].type value
     */
    function TransactionItem(id, gaCategory, pinCategory, name, price, revenueModel) {
        this.id = id;
        this.gaCategory = gaCategory;
        this.pinCategory = pinCategory;
        this.name = name;
        this.price = price;
        this.revenueModel = revenueModel;
    }

    /**
     * Fires an event to send transaction telemetry to both GA and PIN.  Not all of the fields and properties of the
     * transactionItems are applicable to both, and so will only be sent to the appropriate service.
     *
     * @param {string} transactionId - The transaction ID sent to both GA and PIN.
     * @param {string} storeId - The Store ID to be sent to both GA and PIN.
     * @param {string} currency - The ISO 4217 currency code.
     * @param {float} revenue - The total revenue to be recorded in GA, in currency units specified by {@link currency}.
     * @param {float} tax - The tax amount to be sent to both GA and PIN, in currency units specified by {@link currency}.
     * @param {TransactionItem[]} transactionItems - The items that were purchased.
     * @method
     * @example
     *
     * // Create a transaction item.
     * var items = [];
     * items.push(new TransactionItem('OFB_EAST:1234', 'cat', 'cat', 'Super Mario Brothers', 49.95, 'full_game');
     *
     * // Send the transaction.
     * sendTransactionEvent('1234', 'web', 'USD', 49.95, 5, items);
     */
    function sendTransactionEvent(transactionId, storeId, currency, revenue, tax, transactionItems) {
        myEvents.fire(publicEventEnums.TELEMETRY_TRANSACTION_EVENT, transactionId, storeId, currency, revenue, tax, transactionItems);
    }

    /**
     * Fires a telemetry event to send to both GA and PIN.
     *
     * @param {string} trackerType - The tracker to send to, one of either
     *              'TRACKER_MARKETING' or 'TRACKER_DEV'.
     *
     * @param {string} eventCategory - The GA eventCategory field, typically the
     *              object interacted with, e.g., 'video'.  This is used as the event name
     *              for sending a PIN event..  The event tags will be prefixed with 'origin_'
     *
     * @param {string} eventAction - The GA eventAction field, typically the type of
     *              interaction (e.g. 'play')
     *
     * @param {string} eventLabel - The GA eventLabel field, typically useful for
     *              categorizing events (e.g. 'Fall Campaign')
     *
     * @param {Object} pinFieldsObject - Additional fields to transmit, packed as an
     *              object.  These are passed on to PIN verbatim, and on to GA via the
     *              packParamsAsDimension() function, which extracts only those fields
     *              that are relevant to GA as 'dimensions'.  This ultimately becomes the
     *              fieldsObject passed to GA.
     *
     * @param {number} eventValue - The GA eventValue field, typically a numeric. Optional
     *              value associated with the event (e.g., 42)
     */
    function sendTelemetryEvent(trackerType, eventCategory, eventAction, eventLabel, pinFieldsObject, eventValue, additionalPinParams) {
        myEvents.fire(publicEventEnums.TELEMETRY_EVENT, trackerType, eventCategory, eventAction, eventLabel, pinFieldsObject, eventValue, additionalPinParams);
    }

    /**
     * Fires a telemetry event to send to both GA and PIN.
     *
     * @param {string} trackerType - The tracker to send to, one of either
     *              'TRACKER_MARKETING' or 'TRACKER_DEV'.
     *
     * @param {string} eventCategory - The PIN event name from PIN taxonomy.
     *              Ex. 'login', 'boot_start'
     *
     * @param {string} eventAction - The GA eventAction field, typically the type of
     *              interaction (e.g. 'play')
     *
     * @param {string} eventLabel - The GA eventLabel field, typically useful for
     *              categorizing events (e.g. 'Fall Campaign')
     *
     * @param {Object} pinFieldsObject - Additional fields to transmit, packed as an
     *              object.  These are passed on to PIN verbatim, and on to GA via the
     *              packParamsAsDimension() function, which extracts only those fields
     *              that are relevant to GA as 'dimensions'.  This ultimately becomes the
     *              fieldsObject passed to GA.
     *
     * @param {number} eventValue - The GA eventValue field, typically a numeric. Optional
     *              value associated with the event (e.g., 42)
     */
    function sendStandardPinEvent(trackerType, eventCategory, eventAction, eventLabel, pinFieldsObject, eventValue) {
        myEvents.fire(publicEventEnums.TELEMETRY_PIN_EVENT, trackerType, eventCategory, eventAction, eventLabel, pinFieldsObject, eventValue);
    }


    /**
     * Fire dom loaded telemetry event
     *
     * @method
     */
    function sendDomLoadedTelemetryEvent() {
         myEvents.fire(publicEventEnums.TELEMETRY_ELEMENT_DOM_LOADED); 
    }

    /**
     * Send login/logout telemetry event
     *
     * @param {string} action - "login" or "logout"
     * @param {string} type - "SPA" or "nucleus"
     * @param {string} status - "success", "error"
     * @param {string} statuscode - "normal"
     * @method
     */
    function sendLoginEvent(action, type, status, statuscode) {
        /*jshint camelcase:false */
        // use standard PIN event - login
        sendStandardPinEvent(trackerTypes.TRACKER_MARKETING, action, type, status, {
            'status': status,
            'type': type,
            'status_code':statuscode
        });
        /*jshint camelcase:true */
    }

    function sendErrorEvent(errMessage, errDescription, toPINdetail) {
        //use custom event
        sendTelemetryEvent(trackerTypes.TRACKER_DEV, 'error', errMessage, errDescription, toPINdetail);
    }

    function sendPerformanceTimerEvent(area, startTime, endTime, duration, extraDetail) {
        myEvents.fire(publicEventEnums.TELEMETRY_PERFORMANCE_TIMER, area, startTime, endTime, duration, extraDetail);
    }

    function sendMarketingEvent(category, action, label, value, params, additionalPinParams) {
        sendTelemetryEvent(trackerTypes.TRACKER_MARKETING, category, action, label, params, value, additionalPinParams);
    }

    function sendPageView(page, title, params) {
        myEvents.fire(publicEventEnums.TELEMETRY_PAGEVIEW, page, title, params);
    }

    /**
     * send client action
     * @method
     * @param {string} action
     * @param {string} target
     */
    function sendClientAction(action, target) {
        myEvents.fire(publicEventEnums.TELEMETRY_CLIENT_ACTION, action, target);
    }

    /**
     * set custom dimension
     * @method
     * @param {number} dimension slot
     * @param {string} dimension data
     */
    function setCustomDimension(dimension, data) {
        myEvents.fire(publicEventEnums.TELEMETRY_CUSTOM_DIMENSION, dimension, data);
    }

    utils.mix(myEvents, publicEventEnums);


    return /**@ lends Origin.module:telemetry */ {

        events: myEvents,
        trackerTypes: trackerTypes,

        /**
         *  Creates a transaction item object that can be sent in a transaction event to both GA and PIN.
         *
         * See also {@link sendTransactionEvent}
         *
         * @param {string} id - The Item ID, sent to both GA and PIN.
         * @param {string} gaCategory - The category sent to GA as the ItemData.category.
         * @param {string} pinCategory - The category sent to PIN as the asset item category.
         * @param {string} name - The item name, sent to both GA and PIN.
         * @param {float} price - The price of the item, in the currency units specified in {@link sendTransactionEvent}.
         * @param {string} revenueModel - The PIN revenue model: Must be one of the following: full_game, pdlc, mtx, virtual
         * @constructor
         */
        TransactionItem: TransactionItem,

        /**
         * Fires an event to send transaction telemetry to both GA and PIN.  Not all of the fields and properties of the
         * transactionItems are applicable to both, and so will only be sent to the appropriate service.
         *
         * @param {string} transactionId - The transaction ID sent to both GA and PIN.
         * @param {string} storeId - The Store ID to be sent to both GA and PIN.
         * @param {string} currency - The ISO 4217 currency code.
         * @param {float} revenue - The total revenue to be recorded in GA, in currency units specified by {@link currency}.
         * @param {float} tax - The tax amount to be sent to both GA and PIN, in currency units specified by {@link currency}.
         * @param {TransactionItem[]} transactionItems - The items that were purchased.
         * @method
         * @example
         *
         * // Create a transaction item.
         * var items = [];
         * items.push(new TransactionItem('OFB_EAST:1234', 'cat', 'cat', 'Super Mario Brothers', 49.95, 'full_game');
         *
         * // Send the transaction.
         * sendTransactionEvent('1234', 'web', 'USD', 49.95, 5, items);
         */
        sendTransactionEvent: sendTransactionEvent,

        /**
         * fires an event to send telemetry with origin_ prefix on the event name
         * passes along arguments in the triggered event
         *
         * @method
         */
        sendTelemetryEvent: sendTelemetryEvent,

        /**
         * fires an event to send telemetry
         * passes along arguments in the triggered event
         *
         * @method
         * @param {string} trackerType
         * @param {string} action
         * @param {string} type
         * @param {string} status
         * @param {string} statuscode
         */
        sendStandardPinEvent: sendStandardPinEvent,

        /**
         * Fire dom loaded telemetry event
         *
         * @method
         */
        sendDomLoadedTelemetryEvent: sendDomLoadedTelemetryEvent,

        /**
         * fires a login event to dev tracker
         * @method
         * @param {string} action
         * @param {string} type
         * @param {string} status
         * @param {string} statuscode
         */
        sendLoginEvent: sendLoginEvent,

        /**
         * fires an error event to dev tracker
         * @method
         * @param {string} errMessage
         * @param {string} errDescription
         * @param {string} toPINdetail
         */
        sendErrorEvent: sendErrorEvent,

        /**
         * fires a performance timer event to dev tracker
         * @method
         * @param {string} area
         * @param {float} startTime
         * @param {float} endTIme
         * @param {float} duration
         */
        sendPerformanceTimerEvent: sendPerformanceTimerEvent,

        /**
         * fires an event to the marketing tracker
         * @method
         * @param {string} category event category, e.g. click
         * @param {string} action
         * @param {string} label
         * @param {integer} value GA integer value
         * @param {object} params param object, any additional data
         */
        sendMarketingEvent: sendMarketingEvent,

        /**
         * sends a page view event to marketing tracker
         * @method
         * @param {string} page
         * @param {object} params
         */
        sendPageView: sendPageView,

        /**
         * send client action
         * @method
         * @param {string} action
         * @param {string} target
         */
        sendClientAction: sendClientAction,

        /**
         * set custom dimenion
         * @method
         * @param {number} dimension slot
         * @param {string} dimension data
         */
        setCustomDimension: setCustomDimension
    };
});

/*jshint unused: false */
/*jshint strict: false */
/*jshint undef: false */
define('core/logger',['core/telemetry'], function(telemetry) {
    /**
     * A wrapper for console log
     * @module module:log
     * @memberof module:Origin
     * @private
     */
    var jssdkPrefix = '[JSSDK]',
        jssdkColor = 'background: #000077; color: #cccccc',
        //normally we would pass this down via overrides, but the logging bindings happen on jssdk parse
        //so we don't have chance to do so.
        showlogging = window.location.href.indexOf('showlogging=true') > -1;


    function handleLoggingError(err) {
        console.error(err.message);
    }


    //this should eventually be separated out into its own module and sendError should be pulled out of logging too.
    function buildAndSendErrorData(errorArgs) {
        var date = new Date(),
            data = {
                errorMessage: errorArgs[0],
                url: window.location.href
            },
            errDescription = '',
            errorObject;

        // if an error object was passed, extract important info from it
        if (errorArgs.length > 1) {
            errorObject = errorArgs[1];

            if (typeof errorObject === 'object') {
                data.errorDescription = errorObject.message;
                data.errorStack = errorObject.stack;
                data.errorStatus = errorObject.status;
                if (errorObject.response && errorObject.response.error && errorObject.response.error.failure && errorObject.response.error.failure.cause) {
                    data.errorCause = errorObject.response.error.failure.cause;
                }
            }
        }

        // include the timestamp only for GA
        data.time = date.toUTCString();
        errDescription = JSON.stringify(data);
        delete data.time;

        telemetry.sendErrorEvent(data.errorMessage, errDescription, data);
    }

    function justSendError() {
        var args = [];
        //convert arguments to a real array
        args = Array.prototype.slice.call(arguments);

        buildAndSendErrorData(args);
    }

    function logAndSendError(bindFn) {
        return function() {
            var args = Array.prototype.slice.call(arguments);

            bindFn.apply(console, arguments);

            buildAndSendErrorData(args);
        };
    }

    function getBindFunction(type, prefix, color, isChrome) {
        if (showlogging) {
            if (typeof OriginGamesManager !== 'undefined') {
                return window.console[type].bind(console, '%c' + prefix, color);
            } else if (isChrome) {
                return window.console[type].bind(console, '%c' + prefix, color);
            } else {
                return window.console[type].bind(console);
            }
        } else {
            return function() {};
        }
    }

    /**
     * @param {string} msg The string you want to log
     * @return {promise}
     */
    function logMessage(type, prefix, color) {

        var isChrome = navigator && navigator.userAgent && (navigator.userAgent.indexOf('Chrome') !== -1),
            bindFn;

        //special case handling of just sending error to telemetry, and not logging
        //need to do this for now since buildAndSendErrorData is in this file
        //should eventually move it out
        if (type === 'senderror') {
            return justSendError;
        } else {
            //if a browser doesn't support a particular type of console messaging just default to log
            if (typeof console[type] === 'undefined') {
                type = 'log';
            }

            bindFn = getBindFunction(type, prefix, color, isChrome);

            if (type === 'error') {
                return logAndSendError(bindFn);
            } else if (type === 'senderror') {
                return justSendError;
            } else {
                return bindFn;
            }
        }
    }



    function logMessageJSSDK(type) {
        return logMessage(type, jssdkPrefix, jssdkColor);
    }


    /**
     * @namespace
     * @memberof privObjs
     * @private
     * @alias log
     */
    return /** @lends module:Origin.module:log */ {
        log: logMessageJSSDK('log'),
        info: logMessageJSSDK('info'),
        warn: logMessageJSSDK('warn'),
        error: logMessageJSSDK('error'),
        debug: logMessageJSSDK('debug'),
        publicObjs: {
            /**
             * @method
             * @param {string} msg The string you want to log
             * @return {promise}
             */
            message: logMessage
        }
    };
});
/*jshint unused: false */
/*jshint strict: false */
define('core/user',[], function() {

    /**
     * user related data
     * @module module:user
     * @memberof module:Origin
     */

    var VALUE_CLEARED = '';

    var data = {
        auth: {
            accessToken: ''
        },
        originId: '',
        personaId: '',
        userPID: '',
        underAge: false,
        userStatus: '',
        dob: '',
        email: '',
        emailStatus: '',
        emailSignup: false,
        showPersona: '',
        tfaSignup: false,
        registrationDate: ''
    };

    function setAccessToken(token) {
        data.auth.accessToken = token;
    }

    function setAccessTokenExpireDate(expireDate) {
        data.auth.expireDate = expireDate;
    }

    function getAccessToken() {
        return data.auth.accessToken;
    }

    function isAccessTokenExpired() {
        return Date.now() > data.auth.expireDate;
    }

    function setOriginId(originId) {
        data.originId = originId;
    }

    function setUserStatus(userStatus) {
        data.userStatus = userStatus;
    }

    function getOriginId() {
        return data.originId;
    }

    function setUnderAge(flag) {
        data.underAge = flag;
    }

    function setPersonaId(personaId) {
        data.personaId = personaId;
    }

    function getPersonaId() {
        return data.personaId;
    }

    function setUserPid(userId) {
        data.userPID = userId;
    }

    function getUserPid() {
        return data.userPID;
    }

    function setShowPersona(showPersona) {
        data.showPersona = showPersona;
    }

    function getUserStatus() {
        return data.userStatus;
    }

    function getShowPersona() {
        return data.showPersona;
    }

    function setDob(dob) {
        data.dob = dob;
    }

    function getDob() {
        return data.dob;
    }

    function setUserEmail(email) {
        data.email = email;
    }

    function getUserEmail() {
        return data.email;
    }

    function setUserEmailVerifyStatus(status) {
        data.emailStatus = status;
    }

    function getUserEmailVerifyStatus() {
        return data.emailStatus;
    }

    function setUserGlobalEmailStatus(status) {
        data.emailSignup = (status === 'true');
    }

    function getUserGlobalEmailStatus() {
        return data.emailSignup;
    }

    function setTFAStatus(status) {
        data.tfaSignup = status;
    }

    function getTFAStatus() {
        return data.tfaSignup;
    }

    function setRegistrationDate(registrationDate) {
        data.registrationDate = registrationDate;
    }

    function getRegistrationDate() {
        return data.registrationDate;
    }

    function clearUserGlobalEmailStatus() {
        data.emailSignup = false;
    }

    function clearUserEmail() {
        data.email = VALUE_CLEARED;
    }

    function clearUserEmailStatus() {
        data.emailStatus = VALUE_CLEARED;
    }

    function clearAccessToken() {
        data.auth.accessToken = VALUE_CLEARED;
    }

    function clearUserStatus() {
        data.userStatus = VALUE_CLEARED;
    }

    function clearAccessTokenExpireDate() {
        data.auth.expireDate = VALUE_CLEARED;
    }

    function clearOriginId() {
        data.originId = VALUE_CLEARED;
    }

    function clearPersonaId() {
        data.personaId = VALUE_CLEARED;
    }

    function clearShowPersona() {
        data.showPersona = VALUE_CLEARED;
    }

    function clearUserPid() {
        data.userPID = VALUE_CLEARED;
    }

    function clearTFAStatus() {
        data.tfaSignup = false;
    }

    function clearRegistrationDate() {
        data.registrationDate = VALUE_CLEARED;
    }

    function clearUserAuthInfo() {
        clearAccessToken();
        clearUserPid();
        clearOriginId();
        clearPersonaId();
        clearShowPersona();
        clearUserEmail();
        clearUserEmailStatus();
        clearUserGlobalEmailStatus();
        clearTFAStatus();
        clearRegistrationDate();
        clearUserStatus();
    }

    function getUnderage() {
        return data.underAge;
    }

    return {

        //These are exposed by the JSSDK
        publicObjs: /** @lends module:Origin.module:user */{
            /**
             * returns the JSSDK access_token
             * @return {string}
             * @method
             */
            accessToken: getAccessToken,

            /**
             * returns the true if the access token is expired based off of the expires_in property in response
             * @return {boolean}
             * @method
             */
            isAccessTokenExpired: isAccessTokenExpired,

            /**
             * return logged in user's originId
             * @return {string}
             * @method
             */
            originId: getOriginId,

            /**
             * return logged in user's personaId
             * @return {string}
             * @method
             */
            personaId: getPersonaId,

            /**
             * returns logged in user's nucleus Id
             * @return {string}
             * @method
             */
            userPid: getUserPid,

            /**
             * returns whether logged in user's underAge or not
             * @return {boolean}
             * @method
             */
            underAge: getUnderage,

            /**
             * Returns user's status: ACTIVE/BANNED/etc
             */
            userStatus: getUserStatus,

            /**
             * returns the logged in user's date of birth
             * @return {string}
             * @method
             */
            dob: getDob,

            /**
             * returns the logged in user's email address
             * @return {string}
             * @method
             */
            email: getUserEmail,

            /**
             * returns the logged in user's email verification status
             * @return {string}
             * @method
             */
            emailStatus: getUserEmailVerifyStatus,

            /**
             * returns the logged in user's global Origin email sign up status
             * @return {string}
             * @method
             */
            globalEmailSignup: getUserGlobalEmailStatus,

            /**
             * returns the logged in user's showPersona setting
             * @type {string}
             * @method
             */
            showPersona: getShowPersona,

            /**
             * returns whether logged in user has signed up for TFA or not
             * @return {boolean}
             * @method
             */
            tfaSignup: getTFAStatus,

            /**
             * returns date that logged in user registered their Origin account
             * @return {boolean}
             * @method
             */
            registrationDate: getRegistrationDate
        },

        //These are not exposed by the JSSDK, are used by auth to manage userInfo's internal data.
        setOriginId: setOriginId,
        setAccessToken: setAccessToken,
        setAccessTokenExpireDate: setAccessTokenExpireDate,
        setUnderAge: setUnderAge,
        setPersonaId: setPersonaId,
        setUserPid: setUserPid,
        setUserStatus: setUserStatus,
        setShowPersona: setShowPersona,
        setDob: setDob,
        setUserEmail: setUserEmail,
        setUserEmailVerifyStatus: setUserEmailVerifyStatus,
        setUserGlobalEmailStatus: setUserGlobalEmailStatus,
        setTFAStatus: setTFAStatus,
        setRegistrationDate: setRegistrationDate,

        clearPersonaId: clearPersonaId,
        clearUserPid: clearUserPid,
        clearUserStatus: clearUserStatus,
        clearShowPersona: clearShowPersona,
        clearUserAuthInfo: clearUserAuthInfo,
        clearOriginId: clearOriginId,
        clearAccessToken: clearAccessToken,
        clearUserEmail: clearUserEmail,
        clearUserEmailStatus: clearUserEmailStatus,
        clearUserGlobalEmailStatus: clearUserGlobalEmailStatus,
        clearAccessTokenExpireDate: clearAccessTokenExpireDate,
        clearTFAStatus: clearTFAStatus,
        clearRegistrationDate: clearRegistrationDate
    };


});
/*jshint unused: false */
/*jshint strict: false */
define('core/events',[
    'core/utils'
], function(utils) {

    /**
     * The Origin JSSDK notfies integrators of the following events. Use <i>Origin.events.on(Origin.events.eventName, callback)</i> to register a listener. Use <i>Origin.events.off(Origin.events.eventName, callback)</i> to unregister a listener.
     * @module module:events
     * @memberof module:Origin
     */

    var publicEventEnums = {
        /**
         * The Origin JSSDK authenticated successfully and we have an access token and user pid. No objects are passed with this event.
         * @event AUTH_USERPIDRETRIEVED
         */
        AUTH_USERPIDRETRIEVED: 'authUserPidRetrieved',
        /**
         * The Origin JSSDK authenticated successfully and we have an access token and user pid. No objects are passed with this event.
         * @event AUTH_SUCCESS_LOGIN
         */
        AUTH_SUCCESS_LOGIN: 'authSuccessLogin',
        /**
         * fired when authentication succeeds after coming back online from offline mode. No objects are passed with this event.
         * @event AUTH_SUCCESS_POST_OFFLINE
         */
        AUTH_SUCCESS_POST_OFFLINE: 'authSuccessPostOffline',
        /**
         * fired when authentication succeeds after loginType APP_RETRY_LOGIN is passed in as parameter to login
         * @event AUTH_SUCCESS_RETRY
         */
        AUTH_SUCCESS_RETRY: 'authSuccessRetry',
        /**
         * The Origin JSSDK cannot authenticate and the integrator must ask the user to login. No objects are passed with this event.
         * @event AUTH_FAILED_CREDENTIAL
         */
        AUTH_FAILED_CREDENTIAL: 'authFailedCredential',
        /**
         * fired when authentication fails after coming back online from offline mode. No objects are passed with this event.
         * @event AUTH_FAILED_POST_OFFLINE
         */
        AUTH_FAILED_POST_OFFLINE: 'authFailedPostOffline',
        /**
         * fired when authentication fails after loginType APP_RETRY_LOGIN is passed in as parameter to login
         * @event AUTH_FAILED_RETRY
         */
        AUTH_FAILED_RETRY: 'authFailedRetry',
        /**
         * The Origin JSSDK has logged out. No objects are passed with this event. No objects are passed with this event.
         * @event AUTH_LOGGEDOUT
         */
        AUTH_LOGGEDOUT: 'authLoggedOut',
        /**
         * The user has successfully connected to the chat server. No objects are passed with this event.
         * @event XMPP_CONNECTED
         */
        XMPP_CONNECTED: 'xmppConnected',
        /**
         * The user has been disconnected to the chat server. No objects are passed with this event.
         * @event XMPP_DISCONNECTED
         * @memberof Origin.events
         */
        XMPP_DISCONNECTED: 'xmppDisconnected',
        /**
         * The user has logged in with the same resource somewhere else and will be dioscnnected. No objects are passed with this event.
         * @event XMPP_USERCONFLICT
         */
        XMPP_USERCONFLICT: 'xmppUserConflict',
        /**
         * This object is passed through the {@link Origin.events.event:xmppIncomingMsg Origin.events.xmppIncomingMsg} event
         * @typedef xmppMsgObject
         * @type {object}
         * @property {string} jid The user's jabber id.
         * @property {string} msgBody The chat message.
         * @property {string} chatState possible chat states for users
         *   <ul>
            <li>'ACTIVE' - User is actively participating in the chat session.
            <li>'INACTIVE' - User has not been actively participating in the chat session.
            <li>'GONE' - User has effectively ended their participation in the chat session
            <li>'PAUSED' - User had been composing but now has stopped.
            <li>'COMPOSING' - User is composing a message.
            </ul>
         */
        /**
         * This event notifies users of any incoming chat messages. A {@link xmppMsgObject} is passed with the event.
         * @event XMPP_INCOMINGMSG
         *
         */
        XMPP_INCOMINGMSG: 'xmppIncomingMsg',

        //currently not passing this parameter back in xmppPresenceObject because this data doesn't exist in the C++ client presence info
        /*
         @property {string} presenceType States to describe the current user's presence.
            <ul>
            <li>'AVAILABLE' - Signals that the user is online and available for communication.
            <li>'UNAVAILABLE' - Signals that the entity is no longer available for communication.
            <li>'SUBSCRIBE' - The sender wishes to subscribe to the recipient's presence.
            <li>'SUBSCRIBED' - The sender has allowed the recipient to receive their presence.
           <li>'UNSUBSCRIBE' - The sender is unsubscribing from another entity's presence.
            <li>'UNSUBSCRIBED' - The subscription request has been denied or a previously-granted subscription has been cancelled.
            <li>'PROBE' - A request for an entity's current presence; SHOULD be generated only by a server on behalf of a user.
            <li>'ERROR' - An error has occurred regarding processing or delivery of a previously-sent presence stanza.
            </ul>
        */

        /**
         * This object is passed through the {@link Origin.events.event:xmppPresenceChanged Origin.events.xmppPresenceChanged} event
         * @typedef xmppPresenceObject
         * @type {object}
         * @property {string} jid The user's jabber id.
         * @property {string} show Specifies the particular availability status of an entity or specific resource.
            <ul>
            <li>'ONLINE' = The entity is online and available.
            <li>'AWAY' - The entity or resource is temporarily away.
            <li>'CHAT' - The entity or resource is actively interested in chatting.
            <li>'DND' - The entity or resource is busy (dnd = "Do Not Disturb").
            <li>'XA' - The entity or resource is away for an extended period (xa = "eXtended Away").
            </ul>
         */
        /**
         * This event notifies users of any presence changes of users you're subscribed to. A {@link xmppPresenceObject} is passed with the event.
         * @event XMPP_PRESENCECHANGED
         *
         */
        XMPP_PRESENCECHANGED: 'xmppPresenceChanged',

        /**
         * This object is passed through the {@link Origin.events.event:xmppPresenceVisibilityChanged Origin.events.xmppPresenceVisibilityChanged} event
         * @typedef xmppPresenceObject
         * @type {object}
         * @property {string} jid The user's jabber id.
         * @property {boolean} show Specifies the particular visibility of the user.
         */
        /**
         * This event notifies users of any presence visibility changes of users you're subscribed to. A {@link xmppPresenceObject} is passed with the event.
         * @event XMPP_PRESENCEVISIBILITYCHANGED
         *
         */
        XMPP_PRESENCEVISIBILITYCHANGED: 'xmppPresenceVisibilityChanged',

        /**
         * This object is passed through the {@link Origin.events.event:xmppRosterChanged Origin.events.xmppRosterChanged} event
         * @typedef xmppRosterChangeObject
         * @type {object}
         * @property {string} jid The user's jabber id.
         * @property {string} substate The subscription state of the user.
            <ul>
            <li>'NONE' = The user does not have a subscription to the contact's presence, and the contact does not have a subscription to the user's presenc
            <li>'TO' - The user has a subscription to the contact's presence, but the contact does not have a subscription to the user's presence.
            <li>'FROM' - The contact has a subscription to the user's presence, but the user does not have a subscription to the contact's presence.
            <li>'BOTH' - The user and the contact have subscriptions to each other's presence (also called a "mutual subscription").
            <li>'REMOVE' - The contact has removed the user.
            </ul>
         */
        /**
         * This event notifies users the their social roster has changed. A {@link xmppRosterChangeObject} is passed with the event.
         * @event XMPP_ROSTERCHANGED
         *
         */
        XMPP_ROSTERCHANGED: 'xmppRosterChanged',

        /**
         * This object is a part of the {@link clientGamesObject}
         * @typedef progressObject
         * @type {object}
         * @property {boolean} active true if the game is running a download/update/repair/install
         * @property {string} phase
         * @property {string} phaseDisplay The display text for the progress state.
         * @property {number} The progress range from 0 to 1.
         * @property {string} progressState additional progressInfo
         */
        /**
         * This object is a part of the {@link clientGamesObject}
         * @typedef dialogInfoObject
         * @type {object}
         * @property {boolean} showCancel Integrator should show a cancel dialog
         * @property {boolean} showDownloadInfo Integrator should show a download info dialog
         * @property {boolean} showEula Integrator should show a eula dialog
         */
        /**
         * This object is passed through the {@link Origin.events.event:clientGamesChanged Origin.events.clientGamesChanged} event
         * @typedef clientGamesObject
         * @type {object}
         * @property {bool} cancellable Can the game download be cancelled.
         * @property {dialogInfoObject} dialogInfo Info related to download dialog.
         * @property {bool} downloadable Can the game be downloaded.
         * @property {bool} downloading Is the game downloading.
         * @property {bool} installable Can the game be installed.
         * @property {bool} installed Is the game installed.
         * @property {bool} installing Is the game installing.
         * @property {bool} pausable Can the game downloadbe paused.
         * @property {bool} playable Is the game playable.
         * @property {bool} playing Is the user playing.
         * @property {string} productId The product id of the game.
         * @property {progressObject} progressInfo Progress related info, only valid if the active flag is true.
         * @property {number} queueIndex The position in the download queue.
         * @property {bool} queueSkippingEnabled Can the queue be skipped.
         * @property {bool} repairSupported Is repairing supported for this game.
         * @property {bool} repairing Is the game repairing.
         * @property {bool} resumable Can the game be resumed.
         * @property {bool} updateSupported Is updating supported for this game.
         * @property {bool} updating Is the game updating
         */
        /**
         * This event is fired when we receive updated game status info. It will also fire when you call {@link Origin.client.games.requestGamesStatus}. A {@link clientGamesObject} is passed with the event.
         * @event CLIENT_GAMES_CHANGED
         *
         */
        CLIENT_GAMES_CHANGED: 'clientGamesChanged',
        /**
         * This event is fired when we receive updated game status info. It will also fire when you call {@link Origin.client.games.requestGamesStatus}. A {@link clientGamesObject} is passed with the event.
         * @event CLIENT_GAMES_CHANGED
         *
         */
        CLIENT_GAMES_CLOUD_USAGE_CHANGED: 'clientGamesCloudUsageChanged',
        /**
         * This event is fired when a dialog should be show. A dynamic json object is passed with this event
         * @event CLIENT_DIALOGOPEN
         */
        CLIENT_DIALOGOPEN: 'clientGamesDialogOpen',
        /**
         * This event is fired when a dialog should be closed. A dynamic json object is passed with this event
         * @event CLIENT_DIALOGCLOSED
         */
        CLIENT_DIALOGCLOSED: 'clientGamesDialogClosed',
        /**
         * This event is fired when a dialog should be updated. A dynamic json object is passed with this event
         * @event CLIENT_DIALOGCHANGED
         */
        CLIENT_DIALOGCHANGED: 'clientGamesDialogChanged',
        /**
         * This event is fired when the user clicks on the dock icon.
         * @event CLIENT_DOCK_ICONCLICKED
         */
        CLIENT_DESKTOP_DOCKICONCLICKED: 'clientDockIconClicked',
        /**
         * This event is fired when we receive a SDK signal from the game to report a user
         * @event CLIENT_GAME_REQUESTREPORTUSER
         */
        CLIENT_GAME_REQUESTREPORTUSER: 'clientGameRequestReportUser',
        /**
         * This event is fired when we receive a SDK signal from the game to invite friends
         * @event CLIENT_GAME_INVITEFRIENDSTOGAME
         */
        CLIENT_GAME_INVITEFRIENDSTOGAME: 'clientGameInviteFriendsToGame',
        /**
         * This event is fired when we receive a SDK signal from the game to start a conversation
         * @event CLIENT_GAME_STARTCONVERSATION
         */
        CLIENT_GAME_STARTCONVERSATION: 'clientGameStartConversation',
        /**
         * This event is fired when we receive a signal that the initial base game update has been completed
         * @event CLIENT_GAMES_BASEGAMESUPDATED
         */
        CLIENT_GAMES_BASEGAMESUPDATED: 'clientGamesBaseGamesUpdated',
        /**
         * This event is fired when we receive a list of games that have either been added or removed. A list of added offerIds and a list of removed offerIds are passed with the event.
         * @event CLIENT_GAMES_LISTCHANGED
         */
        CLIENT_GAMES_LISTCHANGED: 'clientGamesListChanged',
        /**
         * This event is fired when we receive an updated progress status info.
         * @event CLIENT_GAMES_PROGRESSCHANGED
         */
        CLIENT_GAMES_PROGRESSCHANGED: 'clientGamesProgressChanged',
        /**
         * This event is fired when we receive an signal telling us that a game's operation failed (download, update, repair, etc)
         * @event CLIENT_GAMES_OPERATIONFAILED
         */
        CLIENT_GAMES_OPERATIONFAILED: 'clientGamesOperationFailed',
        /**
         * This event is fired when the client has updated play time for a game.
         * @event CLIENT_GAMES_PLAYTIMECHANGED
         */
        CLIENT_GAMES_PLAYTIMECHANGED: 'clientGamesPlayTimeChanged',
        /**
         * This event is fired when we receive a change in downloadqueue with a list of queue info for each entitlement
         * @event CLIENT_GAMES_DOWNLOADQUEUECHANGED
         */
        CLIENT_GAMES_DOWNLOADQUEUECHANGED: 'clientGamesDownloadQueueChanged',
        /**
         * This event is fired when a NOG has been updated
         * @event CLIENT_GAMES_NOGUPDATED
         */
        CLIENT_GAMES_NOGUPDATED: 'clientGamesNogUpdated',
        /**
         * This event is fired when the user's trial time for a game has been updated
         * @event CLIENT_GAMES_TRIALTIMEUPDATED
         */
        CLIENT_GAMES_TRIALTIMEUPDATED: 'clientGamesTrialTimeUpdated',
        /**
         * This event is fired when the Origin client connection state has changed. A boolean is passed with the event. True means the client went online. False means the client went offline. [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_ONLINESTATECHANGED
         */
        CLIENT_ONLINESTATECHANGED: 'clientOnlineStateChanged',
        /**
         * This event is fired when the user clicks the titlebar offline mode button [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_CLICKEDOFFLINEMODEBUTTON
         */
        CLIENT_CLICKEDOFFLINEMODEBUTTON: 'clientClickedOfflineModeButton',
        /**
         * This event is fired when the chat roster is loaded initially. [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_SOCIAL_ROSTERLOADED
         */
        CLIENT_SOCIAL_ROSTERLOADED: 'clientSocialRosterLoaded',
        /**
         * This event is fired when the presence has changed for the user or friends. [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_SOCIAL_PRESENCECHANGED
         */
        CLIENT_SOCIAL_PRESENCECHANGED: 'clientSocialPresenceChanged',
        /**
         * This event is fired when the block list has changed. [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_SOCIAL_BLOCKLISTCHANGED
         */
        CLIENT_SOCIAL_BLOCKLISTCHANGED: 'clientSocialBlockListChanged',
        /**
         * This event is fired when the social connection has changed. [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_SOCIAL_CONNECTIONCHANGED
         */
        CLIENT_SOCIAL_CONNECTIONCHANGED: 'clientSocialConnectionChanged',
        /**
         * This event is fired when a new message is received from client. [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_SOCIAL_MESSAGERECEIVED
         */
        CLIENT_SOCIAL_MESSAGERECEIVED: 'clientSocialMessageReceived',
        /**
         * This event is fired when the chat state has changes from client. [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_SOCIAL_CHATSTATERECEIVED
         */
        CLIENT_SOCIAL_CHATSTATERECEIVED: 'clientSocialChatStateReceived',
        /**
         * This event is fired when a friend has been added or removed. [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_SOCIAL_ROSTERCHANGED
         */
        CLIENT_SOCIAL_ROSTERCHANGED: 'clientSocialRosterChanged',
        /**
         * This event is fired when a friend invites you to a game. [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_SOCIAL_GAMEINVITERECEIVED
         */
        CLIENT_SOCIAL_GAMEINVITERECEIVED: 'clientSocialGameInviteReceived',
        /**
         * This event is fired when the chat window associated with a friend is to be shown)
         * @event CLIENT_SOCIAL_SHOWCHATWINDOWFORFRIEND
         */
        CLIENT_SOCIAL_SHOWCHATWINDOWFORFRIEND: 'showChatWindowForFriend',
        /**
        * This event is fired when a user accepts a game invite. [ONLY TRIGGERED IN EMBEDDED BROWSER]
        * @event CLIENT_SOCIAL_GAMEINVITEFLOWSTARTED
        */
        CLIENT_SOCIAL_GAMEINVITEFLOWSTARTED: 'gameInviteFlowStarted',
        /**
        * This event is fired when the game invite flow is successful. [ONLY TRIGGERED IN EMBEDDED BROWSER]
        * @event CLIENT_SOCIAL_GAMEINVITEFLOWSUCCESS
        */
        CLIENT_SOCIAL_GAMEINVITEFLOWSUCCESS: 'gameInviteFlowSuccess',
        /**
        * This event is fired when the game invite flow fails. [ONLY TRIGGERED IN EMBEDDED BROWSER]
        * @event CLIENT_SOCIAL_GAMEINVITEFLOWFAILED
        */
        CLIENT_SOCIAL_GAMEINVITEFLOWFAILED: 'gameInviteFlowFailed',
        /**
        * This event is fired when the user leaves a party [ONLY TRIGGERED IN EMBEDDED BROWSER]
        * @event CLIENT_SOCIAL_LEAVINGPARTY
        */
        CLIENT_SOCIAL_LEAVINGPARTY: 'leavingParty',
        /**
         * This event is fired when the friends list pop out needs to be brought into focus. [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_SOCIAL_FOCUSONFRIENDSLIST
         */
        CLIENT_SOCIAL_FOCUSONFRIENDSLIST: 'focusOnFriendsList',
        /**
         * This event is fired when the chat window pop out needs to be brought into focus. [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_SOCIAL_FOCUSONACTIVECHATWINDOW
         */
        CLIENT_SOCIAL_FOCUSONACTIVECHATWINDOW: 'focusOnActiveChatWindow',
        /**
         * This event is fired when there is a SID update [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_SIDRENEWAL
         */
        CLIENT_SIDRENEWAL: 'clientSidRenewal',
        /**
         * An entitlement was added to the content operation queue.
         * @event CLIENT_OPERATIONQUEUE_ENQUEUED
         * @property {Object} offer id of entitlement being added to queue
         */
        CLIENT_OPERATIONQUEUE_ENQUEUED: 'clientOperationQueueEnqueued',
        /**
         * An entitlement was removed to the content operation queue.
         * @event CLIENT_OPERATIONQUEUE_REMOVED
         * @property {String} offer id of entitlement being removed
         * @property {Boolean} true/false if the children entitlements should be removed
         * @property {Boolean} true/false if we enqueue the next item
         */
        CLIENT_OPERATIONQUEUE_REMOVED: 'clientOperationQueueRemoved',
        /**
         * An entitlement was added to the content operation queue completed list.
         * @event CLIENT_OPERATIONQUEUE_ADDEDTOCOMPLETE
         * @property {Object} offer id of entitlement that was added to the completed list
         */
        CLIENT_OPERATIONQUEUE_ADDEDTOCOMPLETE: 'clientOperationQueueAddedToComplete',
        /**
         * The content operation queue completed list was cleared.
         * @event CLIENT_OPERATIONQUEUE_COMPLETELISTCLEARED
         */
        CLIENT_OPERATIONQUEUE_COMPLETELISTCLEARED: 'clientOperationQueueCompleteListCleared',
        /**
         * Has the head item gone into or out of an install state
         * @event CLIENT_OPERATIONQUEUE_HEADBUSY
         * @property {Boolean} True/false if the head of the queue went in or out of busy
         */
        CLIENT_OPERATIONQUEUE_HEADBUSY: 'clientOperationQueueHeadBusy',
        /**
         * The head of the operation queue has changed.
         * @event CLIENT_OPERATIONQUEUE_HEADCHANGED
         * @property {Object} Offer id of the new head entitlement
         * @property {Object} Offer id of the old head entitlement
         */
        CLIENT_OPERATIONQUEUE_HEADCHANGED: 'clientOperationQueueHeadChanged',
        /**
         * This event is fired when the settings have been updated
         * @event CLIENT_SETTINGS_UPDATESETTINGS
         */
        CLIENT_SETTINGS_UPDATESETTINGS: 'clientSettingsUpdateSettings',
        /**
         * This event is fired when returning from a settings dialog
         * @event CLIENT_SETTINGS_RETURN_FROM_DIALOG
         */
        CLIENT_SETTINGS_RETURN_FROM_DIALOG: 'clientSettingsReturnFromDialog',
        /**
         * This event is fired when there is an error setting a setting (e.g. hotkey conflict)
         * @event CLIENT_SETTINGS_ERROR
         */
        CLIENT_SETTINGS_ERROR: 'clientSettingsError',
        /**
         * This event is fired when a voice device like a headset is added [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_VOICE_DEVICEADDED
         */
        CLIENT_VOICE_DEVICEADDED: 'clientVoiceDeviceAdded',
        /**
         * This event is fired when a voice device like a headset is removed [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_VOICE_DEVICEREMOVED
         */
        CLIENT_VOICE_DEVICEREMOVED: 'clientVoiceDeviceRemoved',
        /**
         * This event is fired when the default voice device changed [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_VOICE_DEFAULTDEVICECHANGED
         */
        CLIENT_VOICE_DEFAULTDEVICECHANGED: 'clientVoiceDefaultDeviceChanged',
        /**
         * This event is fired when a voice device like a headset has changed  [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_VOICE_DEVICECHANGED
         */
        CLIENT_VOICE_DEVICECHANGED: 'clientVoiceDeviceChanged',
        /**
         * This event is fired when there is a voice level change  [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_VOICE_VOICELEVEL
         */
        CLIENT_VOICE_VOICELEVEL: 'clientVoiceVoiceLevel',
        /**
         * This event is fired when the voice device is under threshold [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_VOICE_UNDERTHRESHOLD
         */
        CLIENT_VOICE_UNDERTHRESHOLD: 'clientVoiceUnderthreshold',
        /**
         * This event is fired when the voice device is over threshold [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_VOICE_OVERTHRESHOLD
         */
        CLIENT_VOICE_OVERTHRESHOLD: 'clientVoiceOverthreshold',
        /**
         * This event is fired when we have made a voice connection [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_VOICE_VOICECONNECTED
         */
        CLIENT_VOICE_VOICECONNECTED: 'clientVoiceConnected',
        /**
         * This event is fired when we have stopped a voice connection [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_VOICE_VOICEDISCONNECTED
         */
        CLIENT_VOICE_VOICEDISCONNECTED: 'clientVoiceDisconnected',
        /**
         * This event is fired when we the test microphone is enabled [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_VOICE_ENABLETESTMICROPHONE
         */
        CLIENT_VOICE_ENABLETESTMICROPHONE: 'clientEnableTestMicrophone',
        /**
         * This event is fired when we the test microphone is disabled [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_VOICE_DISABLETESTMICROPHONE
         */
        CLIENT_VOICE_DISABLETESTMICROPHONE: 'clientDisableTestMicrophone',
        /**
         * This event is fired when we should clear the level indicator [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_VOICE_CLEARLEVELINDICATOR
         */
        CLIENT_VOICE_CLEARLEVELINDICATOR: 'clientVoiceClearLevelIndicator',
        /**
         * This event is fired when a voice call event occurs [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_VOICE_VOICECALLEVENT
         */
        CLIENT_VOICE_VOICECALLEVENT: 'clientVoiceCallEvent',
        /**
         * This event is fired when the enbedded client causes navigation to the MyGames tab [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_NAV_MYGAMES
         */
        CLIENT_NAV_ROUTECHANGE: 'clientNavRouteChange',
        /**
         * This event is fired when the enbedded client causes navigation to the Store tab by Product Id [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_NAV_STOREBYPRODUCTID
         */
        CLIENT_NAV_STOREBYPRODUCTID: 'navigateToStoreByProductId',
        /**
         * This event is fired when the enbedded client causes navigation to the Store tab by Master Title [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_NAV_STOREBYMASTERTITLE
         */
        CLIENT_NAV_STOREBYMASTERTITLEID: 'navigateToStoreByMasterTitleId',
        /**
         * This event is fired when the enbedded client causes the find friends modal to open [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_NAV_OPENMODAL_FINDFRIENDS
         */
        CLIENT_NAV_OPENMODAL_FINDFRIENDS: 'clientOpenModalFindFriends',
        /**
         * This event is fired when the enbedded client causes the download queue flyout to open [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_NAV_OPEN_DOWNLOADQUEUE
         */
        CLIENT_NAV_OPEN_DOWNLOADQUEUE: 'clientOpenDownloadQueue',
        /**
         * This event is fired when the enbedded client causes the search box to focus [ONLY TRIGGERED IN EMBEDDED BROWSER]
         * @event CLIENT_NAV_FOCUSONSEARCH
         */
        CLIENT_NAV_FOCUSONSEARCH: 'focusOnSearch',
        /**
         * The client is requesting a pending update stripe.
         * @event CLIENT_NAV_SHOW_PENDING_UPDATE_STRIPE
         */
        CLIENT_NAV_SHOW_PENDING_UPDATE_STRIPE: 'showPendingUpdateSitestripe',
        /**
         * The client is requesting a pending update stripe with countdown.
         * @event CLIENT_NAV_SHOW_PENDING_UPDATE_COUNTDOWN_STRIPE
         */
        CLIENT_NAV_SHOW_PENDING_UPDATE_COUNTDOWN_STRIPE: 'showPendingUpdateCountdownSitestripe',
        /**
         * The client is requesting a kick offline stripe.
         * @event CLIENT_NAV_SHOW_PENDING_UPDATE_KICKED_OFFLINE_STRIPE
         */
        CLIENT_NAV_SHOW_PENDING_UPDATE_KICKED_OFFLINE_STRIPE: 'showPendingUpdateKickedOfflineSitestripe',
        /**
         * The client is requesting to open the game details page
         * @event CLIENT_NAV_OPEN_GAME_DETAILS
         */
        CLIENT_NAV_OPEN_GAME_DETAILS: 'openGameDetails',
        /**
         * The client is requesting to open subscription checkout
         * @event CLIENT_NAV_RENEW_SUBSCRIPTION
         */
        CLIENT_NAV_RENEW_SUBSCRIPTION: 'renewSubscription',
        /**
         * The client has been either minimized or restored. A boolean is passed in to indicate if the client just became visible.
         * @event CLIENT_VISIBILITY_CHANGED
         */
        CLIENT_VISIBILITY_CHANGED: 'clientVisibilityChanged',

        /**
         * The client popout has closed
         * @event CLIENT_POP_OUT_CLOSED
         */
        CLIENT_POP_OUT_CLOSED: 'clientPopoutClosed',
        /**
         * This event is fired when the settings data is ready.
         * @event SETTINGS_DATAREADY
         */
        SETTINGS_DATAREADY: 'settingsDataReady',
        /**
         * This event is fired when the settings data failed to retrieve.
         * @event SETTINGS_DATAFAILURE
         */
        SETTINGS_DATAFAILURE: 'settingsDataFailure',
        /**
         * This event is fired when a voice call event occurs.
         * @event VOICE_CALL
         * @memberof Origin.events
         */
        VOICE_CALL: 'voiceCall',
        /**
         * This event is fired when a voice level change occurs.
         * @event VOICE_LEVEL
         * @memberof Origin.events
         */
        VOICE_LEVEL: 'voiceLevel',
        /**
         * This event is fired when a voice device is added.
         * @event VOICE_DEVICE_ADDED
         * @memberof Origin.events
         */
        VOICE_DEVICE_ADDED: 'voiceDeviceAdded',
        /**
         * This event is fired when a voice device is removed.
         * @event VOICE_DEVICE_REMOVED
         * @memberof Origin.events
         */
        VOICE_DEVICE_REMOVED: 'voiceDeviceRemoved',

        /**
         * This event is fired when a default audio device was changed.
         * @event VOICE_DEFAULT_DEVICE_CHANGED
         * @memberof Origin.events
         */
        VOICE_DEFAULT_DEVICE_CHANGED: 'voiceDefaultDeviceChanged',
        /**
         * This event is fired when a voice device is changed. [FOR WINDOWS XP]
         * @event VOICE_DEVICE_CHANGED
         * @memberof Origin.events
         */
        VOICE_DEVICE_CHANGED: 'voiceDeviceChanged',
        /**
         * This event is fired when the voice level is under the activation threshold.
         * @event VOICE_UNDER_THRESHOLD
         * @memberof Origin.events
         */
        VOICE_UNDER_THRESHOLD: 'voiceUnderThreshold',

        /**
         * This event is fired when the voice level is over the activation threshold.
         * @event VOICE_OVER_THRESHOLD
         * @memberof Origin.events
         */
        VOICE_OVER_THRESHOLD: 'voiceOverThreshold',
        /**
         * This event is fired when a voice channel is connected.
         * @event VOICE_CONNECTED
         * @memberof Origin.events
         */
        VOICE_CONNECTED: 'voiceConnected',
        /**
         * This event is fired when a voice channel is disconnected.
         * @event VOICE_DISCONNECTED
         * @memberof Origin.events
         */
        VOICE_DISCONNECTED: 'voiceDisconnected',

        /**
         * This event is fired when the client wants to enable the 'test mic' action link.
         * @event VOICE_ENABLE_TEST_MICROPHONE
         * @memberof Origin.events
         */
        VOICE_ENABLE_TEST_MICROPHONE: 'voiceEnableTestMicrophone',
        /**
         * This event is fired when the client wants to disable the 'test mic' action link.
         * @event VOICE_DEVICE_ADDED
         * @memberof Origin.events
         */
        VOICE_DISABLE_TEST_MICROPHONE: 'voiceDisableTestMicrophone',
        /**
         * This event is fired when the client wants to clear the 'test mic' level indicator.
         * @event VOICE_CLEAR_LEVEL_INDICATOR
         * @memberof Origin.events
         */
        VOICE_CLEAR_LEVEL_INDICATOR: 'voiceClearLevelIndicator',

        /**
         * This event is fired when the locale value changes
         * @event LOCALE_CHANGED
         */
        LOCALE_CHANGED: 'localeChanged',

        /**
         * This event is fired when the language code value changes
         * @event LANGUAGE_CODE_CHANGED
         */
        LANGUAGE_CODE_CHANGED: 'languageCodeChanged',

        /**
         * This event is fired when the country code value changes
         * @event COUNTRY_CODE_CHANGED
         */
        COUNTRY_CODE_CHANGED: 'countryCodeChanged',

        /**
         * This event is fired when the three letter country code value changes
         * @event THREE_LETTER_COUNTRY_CODE_CHANGED
         */
        THREE_LETTER_COUNTRY_CODE_CHANGED: 'threeLetterCountryCodeChanged',

        /**
         * This event is fired when the currency code changes
         * @event CURRENCY_CODE_CHANGED
         */
        CURRENCY_CODE_CHANGED: 'currencyCodeChanged',

        /**
         * This event notifies users of changes to the block list.
         * @event XMPP_BLOCKLISTCHANGED
         *
         */
        XMPP_BLOCKLISTCHANGED: 'xmppBlockListChanged',
        /**
         * This event is fired when the user receives a game invite from a friend
         * @event XMPP_GAMEINVITERECEIVED
         *
         */
        XMPP_GAMEINVITERECEIVED: 'xmppGameInviteReceived',

        /**
         * This event is fired when the user begins joining a game or party
         * @event XMPP_GAMEINVITEFLOWSTARTED
         *
         */
        XMPP_GAMEINVITEFLOWSTARTED: 'xmppGameInviteFlowStarted',
        /**
         * This event is fired when a game or party is successfully joined
         * @event XMPP_GAMEINVITEFLOWSUCCESS
         *
         */
        XMPP_GAMEINVITEFLOWSUCCESS: 'xmppGameInviteFlowSuccess',
        /**
         * This event is fired when a game or party fails to join
         * @event XMPP_GAMEINVITEFLOWFAILED
         *
         */
        XMPP_GAMEINVITEFLOWFAILED: 'xmppGameInviteFlowFailed',
        /**
         * This event is fired when a user exits a party
         * @event XMPP_LEAVINGPARTY
         *
         */
        XMPP_LEAVINGPARTY: 'xmppLeavingParty',

        /**
         * This event notifies users of changes to the achievements.
         * @event DIRTYBITS_ACHIEVEMENTS
         *
         */
        DIRTYBITS_ACHIEVEMENTS: 'dirtyBitAchievements',
        /**
         * This event notifies users of changes to social groups.
         * @event DIRTYBITS_GROUP
         *
         */
        DIRTYBITS_GROUP: 'dirtyBitsGroups',
        /**
         * This event notifies users of changes to email.
         * @event DIRTYBITS_EMAIL
         *
         */
        DIRTYBITS_EMAIL: 'dirtyBitsEmail',
        /**
         * This event notifies users of changes to password.
         * @event DIRTYBITS_PASSWORD
         *
         */
        DIRTYBITS_PASSWORD: 'dirtyBitsPassword',
        /**
         * This event notifies users of changes to origin id.
         * @event DIRTYBITS_ORIGINID
         *
         */
        DIRTYBITS_ORIGINID: 'dirtyBitsOriginId',
        /**
         * This event notifies users of changes to game lib.
         * @event DIRTYBITS_GAMELIB
         *
         */
        DIRTYBITS_GAMELIB: 'dirtyBitsGameLib',
        /**
         * This event notifies users of changes to users privacy settings.
         * @event DIRTYBITS_PRIVACY
         *
         */
        DIRTYBITS_PRIVACY: 'dirtyBitsPrivacy',
        /**
         * This event notifies users of changes to avatar.
         * @event DIRTYBITS_AVATAR
         *
         */
        DIRTYBITS_AVATAR: 'dirtyBitsAvatar',
        /**
         * This event notifies users of changes to a users entitlement.
         * @event DIRTYBITS_ENTITLEMENT
         *
         */
        DIRTYBITS_ENTITLEMENT: 'dirtyBitsEntitlement',
        /**
         * This event notifies users of changes to catalog.
         * @event DIRTYBITS_CATALOG
         *
         */
        DIRTYBITS_CATALOG: 'dirtyBitsCatalog',
        /**
         * This event notifies users of changes to a users subscription.
         * @event DIRTYBITS_SUBSCRIPTION
         *
         */
        DIRTYBITS_SUBSCRIPTION: 'dirtyBitsSubscription',
        /**
         * The client is requesting to redraw video player
         * @event CLIENT_NAV_REDRAW_VIDEO_PLAYER
         */
        CLIENT_NAV_REDRAW_VIDEO_PLAYER: 'redrawVideoPlayer'

    };

    // add private event enums here
    /** @namespace
     * @memberof privObjs
     * @alias events
     * @private
     */
    var privateEventEnums = {
        priv: {
            /**
             * @event REMOTE_CLIENT_SETUP
             * @memberof publicObj.events.priv
             */
            REMOTE_CLIENT_SETUP: 'remoteClientSetup',
            /**
             * @event REMOTE_CLIENT_AVAILABLE
             * @memberof publicObj.events.priv
             */
            REMOTE_CLIENT_AVAILABLE: 'remoteClientAvailable',
            /**
             * @event REMOTE_STATUS_SENDACTION
             * @memberof publicObj.events.priv
             */
            REMOTE_STATUS_SENDACTION: 'remoteStatusSendAction',
            /**
             * @event REMOTE_CONFIRMATION_FROM_CLIENT
             * @memberof publicObj.events.priv
             */
            REMOTE_CONFIRMATION_FROM_CLIENT: 'remoteConfirmationFromClient',
            /**
             * @event REMOTE_STATUS_UPDATE_FROM_CLIENT
             * @memberof publicObj.events.priv
             */
            REMOTE_STATUS_UPDATE_FROM_CLIENT: 'remoteStatusUpdateFromClient',
            /**
             * @event REMOTE_SEND_CONFIRMATION_TO_CLIENT
             * @memberof publicObj.events.priv
             */
            REMOTE_SEND_CONFIRMATION_TO_CLIENT: 'remoteSendConfirmationToClient',
            /**
             * @event REMOTE_STATUS_INIT
             * @memberof publicObj.events.priv
             */
            REMOTE_STATUS_INIT: 'remoteStatusInit',
            /**
             * Alternate way of triggering login, in case login() is inaccessible due to circular dependency
             * @event AUTH_TRIGGERLOGIN
             * @memberof publicObj.events.priv
             *
             */
            AUTH_TRIGGERLOGIN: 'authTriggerLogin',
            /**
             * fired when login as a result of invalid auth (triggered when 401/403 response received)  succeeds
             * @event AUTH_SUCCESS_POST_AUTHINVALID
             * @memberof publicObj.events.priv
             */
            AUTH_SUCCESS_POST_AUTHINVALID: 'authSuccessPostAuthInvalid',
            /**
             * fired when login as a result of invalid auth (triggered when 401/403 response received)  fails
             * @event AUTH_FAILED_POST_AUTHINVALID
             * @memberof publicObj.events.priv
             */
            AUTH_FAILED_POST_AUTHINVALID: 'authFailedPostAuthInvalid'

        }
    };

    /**
     *
     * Connect a function to one of the Origin JSSDK events
     * @method on
     * @memberof module:Origin.module:events
     * @param {OriginEvent} event one of the event enums described below
     * @param {function} callback the function to be triggered when the event is fired
     * @param {object=} context - the context (what this refers to)
     */

    /**
     *
     * Connect a function to one of the Origin JSSDK events and disconnected after the callback is triggered
     * @method once
     * @memberof module:Origin.module:events
     * @param {OriginEvent} event one of the event enums described below
     * @param {function} callback the function to be triggered when the event is fired
     * @param {object=} context - the context (what this refers to)
     */

    /**
     *
     * Disconnect a function from one of the Origin JSSDK events
     * @method off
     * @memberof module:Origin.module:events
     * @param {OriginEvent} event one of the event enums described below
     * @param {function} callback the function to be disconnected
     * @param {object=} context - the context (what this refers to)
     */
    //for events that are meant to be used by integrators
    var events = new utils.Communicator();

    utils.mix(events, publicEventEnums);
    utils.mix(events, privateEventEnums);

    return events;
});

/*jshint strict: false */
/*jshint unused: false */

define('core/locale',[
    'core/events',
], function(events) {
    /**
     * Locale collection
     * @module module:locale
     * @memberof module:Origin
     */
    var locale = {
            'locale': {
                'value': 'en_US',
                'event': events.LOCALE_CHANGED
            },
            'languageCode': {
                'value': 'en',
                'event': events.LANGUAGE_CODE_CHANGED
            },
            'countryCode': {
                'value': 'US',
                'event': events.COUNTRY_CODE_CHANGED
            },
            'threeLetterCountryCode': {
                'value': 'USA',
                'event': events.THREE_LETTER_COUNTRY_CODE_CHANGED
            },
            'currencyCode': {
                'value': 'USD',
                'event': events.CURRENCY_CODE_CHANGED
            }
        },

        //map from cq5 locale to eadp locale by country, if entry is missing, then no need to map
        //table is set here: https://confluence.ea.com/pages/viewpage.action?spaceKey=EBI&title=Origin+X+EADP+Store+Front+Mappings
        locale2eadplocale = {
            'en_US': {
                'AU': 'en_AU',
                'BE': 'en_BE',
                'BR': 'en_BR',
                'CA': 'en_CA',
                'DE': 'en_DE',
                'DK': 'en_DK',
                'ES': 'en_ES',
                'FI': 'en_FI',
                'FR': 'en_FR',
                'GB': 'en_GB',
                'HK': 'en_HK',
                'IE': 'en_IE',
                'IN': 'en_IN',
                'IT': 'en_IT',
                'JP': 'en_JP',
                'KR': 'en_KR',
                'MX': 'en_MX',
                'NL': 'en_NL',
                'NO': 'en_NO',
                'NZ': 'en_NZ',
                'PL': 'en_PL',
                'RU': 'en_RU',
                'SE': 'en_SE',
                'SG': 'en_SG',
                'TH': 'en_TH',
                'TW': 'en_TW',
                'ZA': 'en_ZA'
            },

            'fr_FR': {
                'BE': 'fr_BE'
            },

            'nl_NL': {
                'BE': 'nl_BE'
            }
        };



    /**
     * Set a local value if the input value is different and not falsy
     * @param {string} key   The collection key name
     * @param {string} value The value to set
     */
    function set(key, value) {
        if(!value || locale[key].value === value) {
            return;
        }

        locale[key].value = value;
        events.fire(locale[key].event);
    }

    /**
     * Get a value
     * @param  {string} key the key to look up
     * @return {string} the value
     */
    function get(key) {
        return locale[key].value;
    }

    /**
     * set the locale
     * @param {string} locale in the format of locale_country eg. en_US
     */
    function setLocale(locale) {
        set('locale', locale);
    }

    /**
     * set the language code
     * @param {string} the ISO_3166-1 alpha 2 upper cased language code eg. en
     */
    function setLanguageCode(languageCode) {
        set('languageCode', languageCode);
    }

    /**
     * set the country code
     * @param {string} the ISO_3166-1 alpha 2 upper cased country code eg. US
     */
    function setCountryCode(countryCode) {
        set('countryCode', countryCode.toUpperCase());
    }

    /**
     * set the three letter country code
     * @param {string} the ISO_3166-1 alpha 3 upper cased country code eg. USA
     */
    function setThreeLetterCountryCode(threeLetterCountryCode) {
        set('threeLetterCountryCode', threeLetterCountryCode.toUpperCase());
    }

    /**
     * set the currency code
     * @param {string} the three letter currency code eg. USD
     */
    function setCurrencyCode(currencyCode) {
        set('currencyCode', currencyCode.toUpperCase());
    }

    /**
     * retrieve the locale
     * @return {string} locale in the format of locale_country eg. en_US
     */
    function getLocale(locale) {
        return get('locale');
    }

    /**
     * retrieve the language code
     * @return {string} the ISO_3166-1 alpha 2 upper cased language code eg. en
     */
    function getLanguageCode(languageCode) {
        return get('languageCode');
    }

    /**
     * retrieve the country code
     * @return {string} the ISO_3166-1 alpha 2 upper cased country code eg. US
     */
    function getCountryCode(countryCode) {
        return get('countryCode');
    }

    /**
     * Retrieve the 3 letter country code
     * @return {string} the ISO_3166-1 alpha 3 upper cased country code eg. USA
     */
    function getThreeLetterCountryCode(threeLetterCountryCode) {
        return get('threeLetterCountryCode');
    }

    /**
     * Retrive the currency code
     * @return {string} the ISO_4217  currency code eg. USD
     */
    function getCurrencyCode(currencyCode) {
        return get('currencyCode');
    }

    /**
     * EADP locale differs from CQ5 locales so we need to remap it, e.g. en-us.CAN => en-ca.CAN
     * @param {string} language 2-letter language, e.g. en
     * @param {string} country 2-letter country code
     * @return {string} eadpLocale locale to be used for catalog
     */
    function getEADPlocale(language, country) {
        var eadpLocale = language;

        if (locale2eadplocale[language] && locale2eadplocale[language][country]) {
            eadpLocale = locale2eadplocale[language][country];
        }
        return eadpLocale;
    }

    //we expose this as Origin.locale in jssdk.js
    return /** @lends module:Origin.module:locale */{
        /**
         * set the locale
         * @param {string} locale in the format of locale_country eg. en_US
         * @method
         */
        setLocale: setLocale,

        /**
         * set the language code
         * @param {string} the ISO_3166-1 alpha 2 upper cased language code eg. en
         * @method
         */
        setLanguageCode: setLanguageCode,

        /**
         * set the country code
         * @param {string} the ISO_3166-1 alpha 2 upper cased country code eg. US
         * @method
         */
        setCountryCode: setCountryCode,

        /**
         * set the three letter country code
         * @param {string} the ISO_3166-1 alpha 3 upper cased country code eg. USA
         * @method
         */
        setThreeLetterCountryCode: setThreeLetterCountryCode,

        /**
         * set the country code
         * @param {string} the three letter currency code eg. USD
         * @method
         */
        setCurrencyCode: setCurrencyCode,

        /**
         * retrieve the locale
         * @return {string} locale in the format of locale_country eg. en_US
         * @method
         */
        locale: getLocale,

        /**
         * EADP locale differs from CQ5 locales so we need to remap it, e.g. en-us.CAN => en-ca.CAN
         * @param {string} language 2-letter language, e.g. en
         * @param {string} country 3-letter country code
         * @return {string} eadpLocale locale to be used for catalog
         */
        eadpLocale: getEADPlocale,

        /**
         * retrieve the language code
         * @return {string} the ISO_3166-1 alpha 2 upper cased language code eg. en
         * @method
         */
        languageCode: getLanguageCode,

        /**
         * retrieve the country code
         * @return {string} the ISO_3166-1 alpha 2 upper cased country code eg. US
         * @method
         */
        countryCode: getCountryCode,

        /**
         * Retrieve the 3 letter country code
         * @return {string} the ISO_3166-1 alpha 3 upper cased country code eg. USA
         * @method
         */
        threeLetterCountryCode: getThreeLetterCountryCode,

        /**
         * Retrive the currency code
         * @return {string} the ISO_4217  currency code eg. USD
         * @method
         */
        currencyCode: getCurrencyCode
    };
});
/*jshint strict: false */define('generated/jssdkconfig.js',[], function () { return {'hostname':{'base':'origin.com','baseapi':'https://{env}api{num}.{base}/{cmsstage}','basedata':'https://{env}data{num}.{base}/{cmsstage}','basenoversion':'https://{env}api{num}.{base}/{cmsstage}','cdn':'https://cdn.{env}','websocket':'wss://{env}'},'osminversion':{'macosx':7,'windowsnt':6.1},'urls':{'consolidatedEntitlements':'{baseapi}ecommerce2/consolidatedentitlements/{userId}?machine_hash=1','catalogInfo':'{baseapi}ecommerce2/public/supercat/{productId}/{locale}','catalogInfoPrivate':'{baseapi}ecommerce2/private/supercat/{productId}/{locale}','catalogInfoLMD':'{baseapi}ecommerce2/offerUpdatedDate?offerIds={productId}','criticalCatalogInfo':'{basenoversion}supercat/{country2letter}/{locale}/supercat-PCWIN_MAC-{country2letter}-{locale}.json.gz','offerIdbyPath':'{baseapi}ecommerce2/public/offerId{path}.{country2letter}','basegameOfferIdByMasterTitleId':'{baseapi}ecommerce2/public/basegame/masterTitleId/{masterTitleId}.{country2letter}','atomUsers':'{baseapi}atom/users?userIds={userIdList}','atomGameUsage':'{baseapi}atom/users/{userId}/games/{masterTitleId}/usage','atomGameLastPlayed':'{baseapi}atom/users/{userId}/games/lastplayed','atomGamesOwnedForUser':'{baseapi}atom/users/{userId}/other/{otherUserId}/games','atomFriendsForUser':'{baseapi}atom/users/{userId}/other/{otherUserId}/friends?page={page}','atomFriendCountForUser':'{baseapi}atom/users/{userId}/other/{otherUserId}/friends/count','atomReportUser':'{baseapi}atom/users/{userId}/reportUser/{otherUserId}','atomCommonGames':'{baseapi}atom/users/{userId}/commonGames?friendIds={friendsIds}','giftingEligibility':'{baseapi}/gifting/users/{userId}/offers/{offerId}/giftingEligibility?userIds={recipientIds}','settingsData':'{baseapi}atom/users/{userId}/privacySettings','appSettings':'{baseapi}atom/users/{userId}/appSettings','feedStories':'https://dl.qa.feeds.x.origin.com/feeds/{feedType}/{locale}/{index}','ocdByPath':'{basedata}ocd','dirtyBitsServer':'{websocket}dirtybits.api.origin.com/dirtybits/web/events/{userPid}?at={accessToken}','userVaultInfo':'{baseapi}ecommerce2/vaultInfo/Origin%20Membership','searchStore':'{baseapi}xsearch/store/{locale}/{threeLetterCountry}/products?searchTerm={q}','searchPeople':'{baseapi}xsearch/users?userId={userId}&searchTerm={searchkeyword}&start={start}','localOriginClientBeaconVersion':'https://clienttolocalhostonly.com:3212/version','localOriginClientPing':'https://clienttolocalhostonly.com:3214/ping','localHostClientGameLaunch':'https://clienttolocalhostonly.com:3214/game/launch?offerIds={offerIds}&autoDownload={autoDownload}','origin2ClientGameLaunch':'origin2://game/launch?offerIds={offerIds}&autoDownload={autoDownload}','directEntitle':'{baseapi}supercarp/freegames/{offerId}/users/{userId}/checkoutwithcart','vaultEntitle':'{baseapi}supercarp/users/{userId}/subscriptions/{subscriptionId}/checkout/{offerId}','vaultRemove':'{baseapi}supercarp/users/{userId}/subscriptions/{subscriptionId}/entitlements','ratingsOffers':'{baseapi}supercarp/rating/offers','ratingsBundle':'{baseapi}supercarp/rating/byob','anonRatingsOffers':'{baseapi}supercarp/rating/offers/anonymous','anonRatingsBundle':'{baseapi}supercarp/rating/byob/anonymous','currencyFormatter':'{basedata}defaults/web-defaults/localization/currency.json ','odcProfile':'{basedata}odc/profiles/{profile}.{language}.tidy.xjson','walletBalance':'{baseapi}ecommerce2/billingaccount/{userId}/wallet?currency={currency}','vcCheckout':'{baseapi}ecommerce2/vccheckout/{userId}?currency={currency}&profile={profile}','wishlistGetOfferList':'{baseapi}gifting/users/{userId}/wishlist','wishlistAddOffer':'{baseapi}gifting/users/{userId}/wishlist?offerId={offerId}','wishlistRemoveOffer':'{baseapi}gifting/users/{userId}/wishlist?offerId={offerId}','wishlistUpdateOrder':'{baseapi}gifting/users/{userId}/wishlist/dragndrop','userIdEncode':'{baseapi}gifting/idobfuscate/users/{userId}/encode','userIdDecode':'{baseapi}gifting/idobfuscate/users/{userId}/decode','giftData':'{baseapi}ecommerce2/consolidatedentitlements/{userId}?machine_hash=1','getGifts':'{baseapi}gifting/users/{userId}/gifts','getGift':'{baseapi}gifting/users/{userId}/gifts/{giftId}','updateGiftStatus':'{baseapi}gifting/users/{userId}/gifts/{giftId}/updateStatus','idObsfucationEncodePair':'{baseapi}gifting/idobfuscate/users/{id}/encodePair','idObsfucationDecodePair':'{baseapi}gifting/idobfuscate/users/{id}/decodePair','hasUsedTrial':'{baseapi}supercarp/users/{userId}/hasUsedTrial','translation':'{basedata}translations/{key}.{locale}.{country}.json','ATestURL':'this is external urls prod','connectAuth':'https://accounts.ea.com/connect/auth?client_id=ORIGIN_JS_SDK&response_type=token&redirect_uri=nucleus:rest&prompt=none','anonymousToken':'https://accounts.ea.com/connect/token','userPID':'https://gateway.ea.com/proxy/identity/pids/me','userPersona':'https://gateway.ea.com/proxy/identity/pids/{userId}/personas','xmppConfig':{'wsHost':'','wsPort':'5291','redirectorUrl':'https://chat.dm.origin.com:5290?user_jid=','domain':'chat.dm.origin.com','wsScheme':'wss'},'avatarUrls':'https://api1.origin.com/avatar/user/{userIdList}/avatars?size={size}','groupList':'https://groups.gameservices.ea.com/group/instance?userId={userId}&pagesize={pagesize}','groupInvitedList':'https://groups.gameservices.ea.com/group/instance/invited?userId={userId}&pagesize={pagesize}','groupJoin':'https://groups.gameservices.ea.com/group/instance/{groupGuid}/join/{targetUserId}','groupInvited':'https://groups.gameservices.ea.com/group/instance/{groupGuid}/invited/{targetUserId}','membersList':'https://groups.gameservices.ea.com/group/members?pagesize={pagesize}','roomList':'https://chat.dm.origin.com/chat/muc/groupmuc/{groupGuid}','userSubscription':'https://gateway.ea.com/proxy/subscription/pids/{userId}/subscriptionsv2/groups/Origin%20Membership?state={state}','userSubscriptionDetails':'https://gateway.ea.com/proxy/subscription/pids/{userId}{uri}','friendRecommendation':'https://recommendations.tnt-ea.com/v1/recommendations/{userId}/friends?pagestart={pagestart}&pagesize={pagesize}','friendRecommendationIgnore':'https://recommendations.tnt-ea.com/v1/recommendations/{userId}/friends/{disableUserId}','userAchievements':'https://achievements.gameservices.ea.com/achievements/personas/{personaId}/{achievementSet}/all?lang={locale}&metadata=true&fullset=true','userAchievementSets':'https://achievements.gameservices.ea.com/achievements/personas/{personaId}/all?lang={locale}&metadata=true','userAchievementPoints':'https://achievements.gameservices.ea.com/achievements/personas/{personaId}/progression','achievementSetReleaseInfo':'https://achievements.gameservices.ea.com/achievements/products/released?lang={locale}','cartGetCart':'https://gateway.ea.com/proxy/commerce/carts2/{cartName}','cartAddOffer':'https://gateway.ea.com/proxy/commerce/carts2/{cartName}/offerEntries','cartRemoveOffer':'https://gateway.ea.com/proxy/commerce/carts2/{cartName}/offerEntries/{offerEntryId}','cartAddCoupon':'https://gateway.ea.com/proxy/commerce/carts2/{cartName}/couponEntries','cartRemoveCoupon':'https://gateway.ea.com/proxy/commerce/carts2/{cartName}/couponEntries/{couponEntryId}','cartOperation':'https://gateway.ea.com/proxy/commerce/carts2/{cartName}/operate','cartPutProperties':'https://gateway.ea.com/proxy/commerce/carts2/{cartName}/properties','checkoutDefault':'https://checkout.alpha.ci.ea.com/checkout/{partnerIdentifier}','checkoutSubs':'https://checkout.alpha.ci.ea.com/checkout/subscribe/{partnerIdentifier}','trialCheckTime':'https://gateway.ea.com/proxy/access/checktime?userId={userId}&contentId={contentId}','sendEmailVerification':'https://signin.ea.com/p/ajax/user/sendVerificationEmail','optinToOriginEmail':'https://gateway.ea.com/proxy/identity/pids/{pid}/optins/GLOBAL_COMM_OPTIN','pinemPCRecoGames':'https://pin-em.data.ea.com/em/v3/platform/pc/reco','pinemPCRecoNews':'https://pin-em.data.ea.com/em/v3/platform/pc/reco','pinemTrackClicks':'https://pin-em.data.ea.com/em/v3/tracking/clicks','pinemTrackImpressions':'https://pin-em.data.ea.com/em/v3/tracking/impressions'}};});
/*jshint strict: false */
/*jshint unused: false */

define('core/urls',[
    'core/utils',
    'core/logger',
    'generated/jssdkconfig.js'
], function(utils, logger, jssdkconfig) {
    /**
     * helper functions for managing jssdk urls
     * @module module:urls
     * @memberof module:Origin
     * @private
     */

    return /** @lends module:Origin.module:urls */ {

        init: function() {
            utils.replaceTemplatedValuesInConfig(jssdkconfig);
            utils.mix(this.endPoints, jssdkconfig.urls);
            logger.info('JSSDK URLS', jssdkconfig.urls);
        },

        /**
         * endpoints used
         */
        endPoints: jssdkconfig.urls
    };
});
(function(root) {
define("xml2json", [], function() {
  return (function() {
/*	This work is licensed under Creative Commons GNU LGPL License.

	License: http://creativecommons.org/licenses/LGPL/2.1/
   Version: 0.9
	Author:  Stefan Goessner/2006
	Web:     http://goessner.net/ 
*/
function xml2json(xml, tab) {
   var X = {
      toObj: function(xml) {
         var o = {};
         if (xml.nodeType==1) {   // element node ..
            if (xml.attributes.length)   // element with attributes  ..
               for (var i=0; i<xml.attributes.length; i++)
                  o[xml.attributes[i].nodeName] = (xml.attributes[i].nodeValue||"").toString();
            if (xml.firstChild) { // element has child nodes ..
               var textChild=0, cdataChild=0, hasElementChild=false;
               for (var n=xml.firstChild; n; n=n.nextSibling) {
                  if (n.nodeType==1) hasElementChild = true;
                  else if (n.nodeType==3 && n.nodeValue.match(/[^ \f\n\r\t\v]/)) textChild++; // non-whitespace text
                  else if (n.nodeType==4) cdataChild++; // cdata section node
               }
               if (hasElementChild) {
                  if (textChild < 2 && cdataChild < 2) { // structured element with evtl. a single text or/and cdata node ..
                     X.removeWhite(xml);
                     for (var n=xml.firstChild; n; n=n.nextSibling) {
                        if (n.nodeType == 3)  // text node
                           o["#text"] = X.escape(n.nodeValue);
                        else if (n.nodeType == 4)  // cdata node
                           o["#cdata"] = X.escape(n.nodeValue);
                        else if (o[n.nodeName]) {  // multiple occurence of element ..
                           if (o[n.nodeName] instanceof Array)
                              o[n.nodeName][o[n.nodeName].length] = X.toObj(n);
                           else
                              o[n.nodeName] = [o[n.nodeName], X.toObj(n)];
                        }
                        else  // first occurence of element..
                           o[n.nodeName] = X.toObj(n);
                     }
                  }
                  else { // mixed content
                     if (!xml.attributes.length)
                        o = X.escape(X.innerXml(xml));
                     else
                        o["#text"] = X.escape(X.innerXml(xml));
                  }
               }
               else if (textChild) { // pure text
                  if (!xml.attributes.length)
                     o = X.escape(X.innerXml(xml));
                  else
                     o["#text"] = X.escape(X.innerXml(xml));
               }
               else if (cdataChild) { // cdata
                  if (cdataChild > 1)
                     o = X.escape(X.innerXml(xml));
                  else
                     for (var n=xml.firstChild; n; n=n.nextSibling)
                        o["#cdata"] = X.escape(n.nodeValue);
               }
            }
            if (!xml.attributes.length && !xml.firstChild) o = null;
         }
         else if (xml.nodeType==9) { // document.node
            o = X.toObj(xml.documentElement);
         }
         else
            alert("unhandled node type: " + xml.nodeType);
         return o;
      },
      toJson: function(o, name, ind) {
         var json = name ? ("\""+name+"\"") : "";
         if (o instanceof Array) {
            for (var i=0,n=o.length; i<n; i++)
               o[i] = X.toJson(o[i], "", ind+"\t");
            json += (name?":[":"[") + (o.length > 1 ? ("\n"+ind+"\t"+o.join(",\n"+ind+"\t")+"\n"+ind) : o.join("")) + "]";
         }
         else if (o == null)
            json += (name&&":") + "null";
         else if (typeof(o) == "object") {
            var arr = [];
            for (var m in o)
               arr[arr.length] = X.toJson(o[m], m, ind+"\t");
            json += (name?":{":"{") + (arr.length > 1 ? ("\n"+ind+"\t"+arr.join(",\n"+ind+"\t")+"\n"+ind) : arr.join("")) + "}";
         }
         else if (typeof(o) == "string")
            json += (name&&":") + "\"" + o.toString() + "\"";
         else
            json += (name&&":") + o.toString();
         return json;
      },
      innerXml: function(node) {
         var s = ""
         if ("innerHTML" in node)
            s = node.innerHTML;
         else {
            var asXml = function(n) {
               var s = "";
               if (n.nodeType == 1) {
                  s += "<" + n.nodeName;
                  for (var i=0; i<n.attributes.length;i++)
                     s += " " + n.attributes[i].nodeName + "=\"" + (n.attributes[i].nodeValue||"").toString() + "\"";
                  if (n.firstChild) {
                     s += ">";
                     for (var c=n.firstChild; c; c=c.nextSibling)
                        s += asXml(c);
                     s += "</"+n.nodeName+">";
                  }
                  else
                     s += "/>";
               }
               else if (n.nodeType == 3)
                  s += n.nodeValue;
               else if (n.nodeType == 4)
                  s += "<![CDATA[" + n.nodeValue + "]]>";
               return s;
            };
            for (var c=node.firstChild; c; c=c.nextSibling)
               s += asXml(c);
         }
         return s;
      },
      escape: function(txt) {
         return txt.replace(/[\\]/g, "\\\\")
                   .replace(/[\"]/g, '\\"')
                   .replace(/[\n]/g, '\\n')
                   .replace(/[\r]/g, '\\r');
      },
      removeWhite: function(e) {
         e.normalize();
         for (var n = e.firstChild; n; ) {
            if (n.nodeType == 3) {  // text node
               if (!n.nodeValue.match(/[^ \f\n\r\t\v]/)) { // pure whitespace text node
                  var nxt = n.nextSibling;
                  e.removeChild(n);
                  n = nxt;
               }
               else
                  n = n.nextSibling;
            }
            else if (n.nodeType == 1) {  // element node
               X.removeWhite(n);
               n = n.nextSibling;
            }
            else                      // any other node
               n = n.nextSibling;
         }
         return e;
      }
   };
   if (xml.nodeType == 9) // document node
      xml = xml.documentElement;
   var json = X.toJson(X.toObj(X.removeWhite(xml)), xml.nodeName, "\t");
   return "{\n" + tab + (tab ? json.replace(/\t/g, tab) : json.replace(/\t|\n/g, "")) + "\n}";
}
;
return root.xml2json = xml2json;
  }).apply(root, arguments);
});
}(this));

/*jshint unused: false */
/*jshint strict: false */

define('core/defines',[], function () {
        /**
     * Contains authentication related methods
     * @module module:defines
     * @memberof module:Origin
     */
    var httpResponseCodes = {
        SUCCESS_200: 200,
        REDIRECT_302_FOUND: 302,
        ERROR_400_BAD_REQUEST: 400,
        ERROR_401_UNAUTHORIZED: 401,
        ERROR_403_FORBIDDEN: 403,
        ERROR_404_NOTFOUND: 404,
        ERROR_UNEXPECTED: -99
    };

    var loginTypes = {
        APP_INITIAL_LOGIN: 'login_app_initial', //login from the APP (via login window or auto-login), NOT retry for renewing sid
        APP_RETRY_LOGIN: 'login_app_retry', //login from the APP as part of retry (after jssdk retry due to AUTH_INVALID fails)
        AUTH_INVALID: 'login_auth_invalid', //after receiving 401/403 from http request
        POST_OFFLINE: 'login_post_offline' //after coming back from offline
    };

    var userStatus = {
        PENDING: 'PENDING',
        ACTIVE: 'ACTIVE',
        DEACTIVATED: 'DEACTIVATED',
        DISABLED: 'DISABLED',
        DELETED: 'DELETED',
        BANNED: 'BANNED'
    };

    var showPersonaCodes = {
        EVERYONE: 'EVERYONE',
        FRIENDS: 'FRIENDS',
        FRIENDS_OF_FRIENDS: 'FRIENDS_OF_FRIENDS',
        NO_ONE: 'NO_ONE'
    };

    var avatarSizes = {
        SMALL: 'AVATAR_SZ_SMALL',
        MEDIUM: 'AVATAR_SZ_MEDIUM',
        LARGE: 'AVATAR_SZ_LARGE'
    };

    return  /** @lends module:Origin.module:defines */{
        /**
         * @typedef httpResponseCodesObject
         * @type {object}
         * @property {number} SUCCESS_200 200
         * @property {number} REDIRECT_302_FOUND 302
         * @property {number} ERROR_400_BAD_REQUEST 400
         * @property {number} ERROR_401_UNAUTHORIZED 401
         * @property {number} ERROR_403_FORBIDDEN 403
         * @property {number} ERROR_404_NOTFOUND 404
         * @property {number} ERROR_UNEXPECTED -99
         */

        /**
         *  aliases for http codes
         * @type {module:Origin.module:defines~httpResponseCodesObject}
         */
        http: httpResponseCodes,

        /**
         * @typedef loginTypesObject
         * @type {object}
         * @property {string} APP_INITIAL_LOGIN default login, associated with app login
         * @property {string} APP_RETRY_LOGIN when app retries to login after failed session
         * @property {string} AUTH_INVALID login for auto-retry after INVALID_AUTH error is returned on http request
         * @property {string} POST_OFFLINE login for going back online after being offline (client)
         */
        /**
         *  enums for login types
         * @type {module:Origin.module:defines~loginTypesObject}
         */
        login: loginTypes,

        /**
         * @typedef showPersonaCodesObject
         * @type {object}
         * @property {string} EVERYONE show profile to everyone
         * @property {string} FRIENDS show profile only to friends
         * @property {string} FRIENDS_OF_FRIENDS show profile to friends and friends of friends
         * @property {string} NO_ONE don't show profile to anyone
         */
        /**
         *  enums for showPersona codes
         * @type {module:Origin.module:defines~showPersonaCodesObject}
         */
        showPersona: showPersonaCodes,

        /**
         * @typedef avatarSizesObject
         * @type {object}
         * @property {string} SMALL small avatar size
         * @property {string} MEDIUM medium avatar size
         * @property {string} LARGE large avatar size
         */
        /**
         *  enums for avatar sizes
         * @type {module:Origin.module:defines~avatarSizesObject}
         */
        avatarSizes: avatarSizes,

        /**
         * enums for user status
         */
        userStatus: userStatus
    };
});

/*jshint unused: false */
/*jshint strict: false */

define('core/errorhandler',[
    'core/utils',
    'core/logger'
], function(utils, logger) {
    /**
     * Some private errorhandler utility functions for jssdk
     * @module module:errorhandler
     * @memberof module:Origin
     * @private
     */
    return /** @lends module:Origin.module:errorhandler */ {
        /**
         * sets up an error object with some custom properties and returns the object from Promise.reject();
         * @param  {object} msg             The message used for the error
         * @param  {object} extraProperties Any extra properties we want to add to the error object
         * @return {promise}                responsename The promise returned from Promise.reject()
         */
        promiseReject: function(msg, extraProperties) {
            var error = new Error(msg);
            if (extraProperties) {
                utils.mix(error, extraProperties);
            }
            return Promise.reject(error);
        },
        /**
         * Logs an error before passing on the reject in the Promise chain
         * @param  {object} msg          A message that is prepended to the actual error message
         * @param  {function} customAction A function that is run when we hit this error
         * @return {promise}              responsename The promise returned from Promise.reject()
         */
        logAndCleanup: function(msg, customAction) {
            return function(error) {
                var output = error.message;

                //if there is a stack lets use that as output instead
                if (error.stack) {
                    output = error.stack;
                }

                if (customAction) {
                    customAction(error);
                }
                msg = msg;
                //logger.error('[' + msg + ']', output);
                return Promise.reject(error);
            };
        },
        /**
         * Logs the message from the error object to console in standard style
         * @param  {Error} error Error object
         */
        logErrorMessage: function(error) {
            error = error;
            //logger.error(error.message);
        }
    };
});
(function(root) {
define("QWebChannel", [], function() {
  return (function() {
/****************************************************************************
**
** Copyright (C) 2015 The Qt Company Ltd.
** Copyright (C) 2014 Klarälvdalens Datakonsult AB, a KDAB Group company, info@kdab.com, author Milian Wolff <milian.wolff@kdab.com>
** Contact: http://www.qt.io/licensing/
**
** This file is part of the QtWebChannel module of the Qt Toolkit.
**
** $QT_BEGIN_LICENSE:LGPL21$
** Commercial License Usage
** Licensees holding valid commercial Qt licenses may use this file in
** accordance with the commercial license agreement provided with the
** Software or, alternatively, in accordance with the terms contained in
** a written agreement between you and The Qt Company. For licensing terms
** and conditions see http://www.qt.io/terms-conditions. For further
** information use the contact form at http://www.qt.io/contact-us.
**
** GNU Lesser General Public License Usage
** Alternatively, this file may be used under the terms of the GNU Lesser
** General Public License version 2.1 or version 3 as published by the Free
** Software Foundation and appearing in the file LICENSE.LGPLv21 and
** LICENSE.LGPLv3 included in the packaging of this file. Please review the
** following information to ensure the GNU Lesser General Public License
** requirements will be met: https://www.gnu.org/licenses/lgpl.html and
** http://www.gnu.org/licenses/old-licenses/lgpl-2.1.html.
**
** As a special exception, The Qt Company gives you certain additional
** rights. These rights are described in The Qt Company LGPL Exception
** version 1.1, included in the file LGPL_EXCEPTION.txt in this package.
**
** $QT_END_LICENSE$
**
****************************************************************************/

"use strict";

var QWebChannelMessageTypes = {
    signal: 1,
    propertyUpdate: 2,
    init: 3,
    idle: 4,
    debug: 5,
    invokeMethod: 6,
    connectToSignal: 7,
    disconnectFromSignal: 8,
    setProperty: 9,
    response: 10,
};

var QWebChannel = function(transport, initCallback)
{
    if (typeof transport !== "object" || typeof transport.send !== "function") {
        console.error("The QWebChannel expects a transport object with a send function and onmessage callback property." +
                      " Given is: transport: " + typeof(transport) + ", transport.send: " + typeof(transport.send));
        return;
    }

    var channel = this;
    this.transport = transport;

    this.send = function(data)
    {
        if (typeof(data) !== "string") {
            data = JSON.stringify(data);
        }
        channel.transport.send(data);
    }

    this.transport.onmessage = function(message)
    {
        var data = message.data;
        if (typeof data === "string") {
            data = JSON.parse(data);
        }
        switch (data.type) {
            case QWebChannelMessageTypes.signal:
                channel.handleSignal(data);
                break;
            case QWebChannelMessageTypes.response:
                channel.handleResponse(data);
                break;
            case QWebChannelMessageTypes.propertyUpdate:
                channel.handlePropertyUpdate(data);
                break;
            default:
                console.error("invalid message received:", message.data);
                break;
        }
    }

    this.execCallbacks = {};
    this.execId = 0;
    this.exec = function(data, callback)
    {
        if (!callback) {
            // if no callback is given, send directly
            channel.send(data);
            return;
        }
        if (channel.execId === Number.MAX_VALUE) {
            // wrap
            channel.execId = Number.MIN_VALUE;
        }
        if (data.hasOwnProperty("id")) {
            console.error("Cannot exec message with property id: " + JSON.stringify(data));
            return;
        }
        data.id = channel.execId++;
        channel.execCallbacks[data.id] = callback;
        channel.send(data);
    };

    this.objects = {};

    this.handleSignal = function(message)
    {
        var object = channel.objects[message.object];
        if (object) {
            object.signalEmitted(message.signal, message.args);
        } else {
            console.warn("Unhandled signal: " + message.object + "::" + message.signal);
        }
    }

    this.handleResponse = function(message)
    {
        if (!message.hasOwnProperty("id")) {
            console.error("Invalid response message received: ", JSON.stringify(message));
            return;
        }
        channel.execCallbacks[message.id](message.data);
        delete channel.execCallbacks[message.id];
    }

    this.handlePropertyUpdate = function(message)
    {
        for (var i in message.data) {
            var data = message.data[i];
            var object = channel.objects[data.object];
            if (object) {
                object.propertyUpdate(data.signals, data.properties);
            } else {
                console.warn("Unhandled property update: " + data.object + "::" + data.signal);
            }
        }
        channel.exec({type: QWebChannelMessageTypes.idle});
    }

    this.debug = function(message)
    {
        channel.send({type: QWebChannelMessageTypes.debug, data: message});
    };

    channel.exec({type: QWebChannelMessageTypes.init}, function(data) {
        for (var objectName in data) {
            var object = new QObject(objectName, data[objectName], channel);
        }
        // now unwrap properties, which might reference other registered objects
        for (var objectName in channel.objects) {
            channel.objects[objectName].unwrapProperties();
        }
        if (initCallback) {
            initCallback(channel);
        }
        channel.exec({type: QWebChannelMessageTypes.idle});
    });
};

function QObject(name, data, webChannel)
{
    this.__id__ = name;
    webChannel.objects[name] = this;

    // List of callbacks that get invoked upon signal emission
    this.__objectSignals__ = {};

    // Cache of all properties, updated when a notify signal is emitted
    this.__propertyCache__ = {};

    var object = this;

    // ----------------------------------------------------------------------

    this.unwrapQObject = function(response)
    {
        if (response instanceof Array) {
            // support list of objects
            var ret = new Array(response.length);
            for (var i = 0; i < response.length; ++i) {
                ret[i] = object.unwrapQObject(response[i]);
            }
            return ret;
        }
        if (!response
            || !response["__QObject*__"]
            || response.id === undefined) {
            return response;
        }

        var objectId = response.id;
        if (webChannel.objects[objectId])
            return webChannel.objects[objectId];

        if (!response.data) {
            console.error("Cannot unwrap unknown QObject " + objectId + " without data.");
            return;
        }

        var qObject = new QObject( objectId, response.data, webChannel );
        qObject.destroyed.connect(function() {
            if (webChannel.objects[objectId] === qObject) {
                delete webChannel.objects[objectId];
                // reset the now deleted QObject to an empty {} object
                // just assigning {} though would not have the desired effect, but the
                // below also ensures all external references will see the empty map
                // NOTE: this detour is necessary to workaround QTBUG-40021
                var propertyNames = [];
                for (var propertyName in qObject) {
                    propertyNames.push(propertyName);
                }
                for (var idx in propertyNames) {
                    delete qObject[propertyNames[idx]];
                }
            }
        });
        // here we are already initialized, and thus must directly unwrap the properties
        qObject.unwrapProperties();
        return qObject;
    }

    this.unwrapProperties = function()
    {
        for (var propertyIdx in object.__propertyCache__) {
            object.__propertyCache__[propertyIdx] = object.unwrapQObject(object.__propertyCache__[propertyIdx]);
        }
    }

    function addSignal(signalData, isPropertyNotifySignal)
    {
        var signalName = signalData[0];
        var signalIndex = signalData[1];
        object[signalName] = {
            connect: function(callback) {
                if (typeof(callback) !== "function") {
                    console.error("Bad callback given to connect to signal " + signalName);
                    return;
                }

                object.__objectSignals__[signalIndex] = object.__objectSignals__[signalIndex] || [];
                object.__objectSignals__[signalIndex].push(callback);

                if (!isPropertyNotifySignal && signalName !== "destroyed") {
                    // only required for "pure" signals, handled separately for properties in propertyUpdate
                    // also note that we always get notified about the destroyed signal
                    webChannel.exec({
                        type: QWebChannelMessageTypes.connectToSignal,
                        object: object.__id__,
                        signal: signalIndex
                    });
                }
            },
            disconnect: function(callback) {
                if (typeof(callback) !== "function") {
                    console.error("Bad callback given to disconnect from signal " + signalName);
                    return;
                }
                object.__objectSignals__[signalIndex] = object.__objectSignals__[signalIndex] || [];
                var idx = object.__objectSignals__[signalIndex].indexOf(callback);
                if (idx === -1) {
                    console.error("Cannot find connection of signal " + signalName + " to " + callback.name);
                    return;
                }
                object.__objectSignals__[signalIndex].splice(idx, 1);
                if (!isPropertyNotifySignal && object.__objectSignals__[signalIndex].length === 0) {
                    // only required for "pure" signals, handled separately for properties in propertyUpdate
                    webChannel.exec({
                        type: QWebChannelMessageTypes.disconnectFromSignal,
                        object: object.__id__,
                        signal: signalIndex
                    });
                }
            }
        };
    }

    /**
     * Invokes all callbacks for the given signalname. Also works for property notify callbacks.
     */
    function invokeSignalCallbacks(signalName, signalArgs)
    {
        var connections = object.__objectSignals__[signalName];
        if (connections) {
            connections.forEach(function(callback) {
                callback.apply(callback, signalArgs);
            });
        }
    }

    this.propertyUpdate = function(signals, propertyMap)
    {
        // update property cache
        for (var propertyIndex in propertyMap) {
            var propertyValue = propertyMap[propertyIndex];
            object.__propertyCache__[propertyIndex] = propertyValue;
        }

        for (var signalName in signals) {
            // Invoke all callbacks, as signalEmitted() does not. This ensures the
            // property cache is updated before the callbacks are invoked.
            invokeSignalCallbacks(signalName, signals[signalName]);
        }
    }

    this.signalEmitted = function(signalName, signalArgs)
    {
        invokeSignalCallbacks(signalName, signalArgs);
    }

    function addMethod(methodData)
    {
        var methodName = methodData[0];
        var methodIdx = methodData[1];
        object[methodName] = function() {
            var args = [];
            var callback;
            for (var i = 0; i < arguments.length; ++i) {
                if (typeof arguments[i] === "function")
                    callback = arguments[i];
                else
                    args.push(arguments[i]);
            }

            webChannel.exec({
                "type": QWebChannelMessageTypes.invokeMethod,
                "object": object.__id__,
                "method": methodIdx,
                "args": args
            }, function(response) {
                if (response !== undefined) {
                    var result = object.unwrapQObject(response);
                    if (callback) {
                        (callback)(result);
                    }
                }
            });
        };
    }

    function bindGetterSetter(propertyInfo)
    {
        var propertyIndex = propertyInfo[0];
        var propertyName = propertyInfo[1];
        var notifySignalData = propertyInfo[2];
        // initialize property cache with current value
        // NOTE: if this is an object, it is not directly unwrapped as it might
        // reference other QObject that we do not know yet
        object.__propertyCache__[propertyIndex] = propertyInfo[3];

        if (notifySignalData) {
            if (notifySignalData[0] === 1) {
                // signal name is optimized away, reconstruct the actual name
                notifySignalData[0] = propertyName + "Changed";
            }
            addSignal(notifySignalData, true);
        }

        Object.defineProperty(object, propertyName, {
            configurable: true,
            get: function () {
                var propertyValue = object.__propertyCache__[propertyIndex];
                if (propertyValue === undefined) {
                    // This shouldn't happen
                    console.warn("Undefined value in property cache for property \"" + propertyName + "\" in object " + object.__id__);
                }

                return propertyValue;
            },
            set: function(value) {
                if (value === undefined) {
                    console.warn("Property setter for " + propertyName + " called with undefined value!");
                    return;
                }
                object.__propertyCache__[propertyIndex] = value;
                webChannel.exec({
                    "type": QWebChannelMessageTypes.setProperty,
                    "object": object.__id__,
                    "property": propertyIndex,
                    "value": value
                });
            }
        });

    }

    // ----------------------------------------------------------------------

    data.methods.forEach(addMethod);

    data.properties.forEach(bindGetterSetter);

    data.signals.forEach(function(signal) { addSignal(signal, false); });

    for (var name in data.enums) {
        object[name] = data.enums[name];
    }
}

//required for use with nodejs
if (typeof module === 'object') {
    module.exports = {
        QWebChannel: QWebChannel
    };
}
;
return root.QWebChannel = QWebChannel;
  }).apply(root, arguments);
});
}(this));

/*jshint unused: false */
/*jshint strict: false */
define('modules/client/communication',[
    'QWebChannel',
    'core/logger'
], function(QWebChannel, logger) {
    var channel = null,
        connectionPromise = null,
        CONNECTION_TIMEOUT = 40000,
        connectAttemptCompleted = false,
        defaultBridgeObject = 'OriginGamesManager',
        typeEnum = {
            BRIDGE: 'BRIDGE',
            NOTCONNECTED: 'NOTCONNECTED',
            WEBCHANNEL: 'WEBCHANNEL',
            CONNECTIONERROR: 'CONNECTIONERROR'
        },
        connectionType = typeEnum.NOTCONNECTED;

    function remoteTransportStub() {
        //this is what we would use to communicate remotely in the future
        logger.log('[WEBCHANNEL] Stub Transport for remote selected');
        return null;
    }

    function embeddedTransportAvailable() {
        //the qt object exists only in the embedded browser for web channel
        //
        //window.OriginOIGBrowser is injected by the C++ client, we add this check for the OIGBrowser instead of check for a specific ClientViewController
        //param to be true, because in case the injection of the window.OriginOIGBrowser fails the worst that can happen is the user has to wait for the 
        //webchannel connection attempt to time out.
        return (typeof qt !== 'undefined') && (typeof qt.webChannelTransport !== 'undefined') && (!window.OriginOIGBrowser);
    }

    function bridgeAvailable() {
        //we just check here if one of the bridge objects exist
        return (typeof window[defaultBridgeObject] !== 'undefined');
    }

    function isEmbeddedBrowser() {
        //if we have a connection error, do not consider this an embedded browser
        return (embeddedTransportAvailable() || bridgeAvailable()) && (connectionType !== typeEnum.CONNECTIONERROR) ;
    }

    function createConnectionPromise() {
        return new Promise(function(resolve) {
            var timeoutHandle,
                transport = embeddedTransportAvailable() ? qt.webChannelTransport : remoteTransportStub();
            //if we have a transport available, then we can use webchannel
            if (transport) {
                timeoutHandle = setTimeout(timeoutCallback(resolve), CONNECTION_TIMEOUT);
                //attempt a web channel connection
                channel = new QWebChannel(transport, function() {
                    clearTimeout(timeoutHandle);
                    connectAttemptCompleted = true;
                    connectionType = typeEnum.WEBCHANNEL;
                    resolve();
                });
            } else {
                //if not webchannel then lets try bridge
                if (bridgeAvailable()) {
                    connectionType = typeEnum.BRIDGE;
                }

                // we always resolve here so anythign waiting (like the initialization flow) can continue on
                resolve();
            }
        });
    }

    function connectionError() {
        connectionType = typeEnum.CONNECTIONERROR;
        resetConnectionPromise();
        logger.error('[CLIENTCONNECT] unable to connect');
    }

    function timeoutCallback(resolve) {
        return function() {
            logger.error('[CLIENTCONNECT] timedout');
            connectionError();
            resolve();
        };
    }

    function resetConnectionPromise() {
        connectionPromise = null;
    }

    function waitForConnectionEstablished() {
        //if we've attempted the connection the webchannel is ready
        if (!isEmbeddedBrowser() || connectAttemptCompleted) {
            return Promise.resolve();
        }

        //if we are not in the middle of a promise, instantiate a new one, else return the existing one
        if (!connectionPromise) {
            connectionPromise = createConnectionPromise().then(resetConnectionPromise).catch(connectionError);
        }

        return connectionPromise;
    }



    function getClientObject(objectName) {

        var clientObject = null;
        if (channel && channel.objects[objectName]) {
            //webchannel
            clientObject = channel.objects[objectName];
        } else if (typeof window[objectName] !== 'undefined') {
            //bridge
            clientObject = window[objectName];
        } 
        
        return clientObject;
    }

    return {
        /**
         * get the current connecton type
         * @return {CommunicationTypeEnum} returns either BRIDGE WEBCHANNEL NOTCONNECTED
         */
        getConnectionType: function() {
            return connectionType;
        },
        /**
         * are we in an embedded browser
         * @method
         * @returns {boolean} true if we are in an embedded browser, false otherwise
         */
        isEmbeddedBrowser: isEmbeddedBrowser,
        /**
         * retrieves the client object based on the communication type. If we have a webchannel connection, we will return the client objects
         * that live in the channel. If we are using the bridge it will return the global bridge object
         * @method
         * @returns {clientObject} The actual C++ object over the bridge or webchannel
         */
        getClientObject: getClientObject,
        /**
         * This function returns a promise once a connection with the client has been established or determined that we are in a remote browser
         * @returns {Promise}
         * @method
         */
        waitForConnectionEstablished: waitForConnectionEstablished,
        /**
         * public enums so that other modules can check the connection type
         */
        typeEnum: typeEnum
    };

});
/*jshint strict: false */
/*jshint unused: false */

define('modules/client/ClientObjectWrapper',[
    'core/logger',
    'modules/client/communication',
    'core/events'
], function(logger, communication, events) {

    /**
     * @class Communicator
     */

    function clientObjectHasError(self, property) {
        try {
            if (!self.clientObject) {
                return new Error('ERROR: client object is null -- trying to use ' + self.clientObjectName + ':' + property);
            } else if (typeof self.clientObject[property] === 'undefined') {
                return new Error('ERROR: client property/signal/function not found:' + self.clientObjectName + ':' + property);
            }
        } catch (err) {
            return new Error('ERROR: uncaught exception in client object -- trying to use ' + self.clientObjectName + ':' + property + ':' + err);
        }

        return null;
    }

    function ClientObjectWrapper(clientObjectName) {
        this.clientObjectName = clientObjectName;
        this.clientObject = communication.getClientObject(clientObjectName);
    }

    /**
     * Subscribe to an event so when the event is fired, the callback
     * is executed in the context passed
     * @param {string} eventName - the event name
     * @param {Function} fn - the callback
     * @param {object} context - the context (what this refers to)
     * @return {void}
     * @method on
     */
    ClientObjectWrapper.prototype.sendToOriginClient = function(clientFnName, params) {
        var paramArray = [],
            self = this,
            error = clientObjectHasError(self, clientFnName);

        if (error) {
            return Promise.reject(error);
        }

        return new Promise(function(resolve, reject) {
            var connectionType = communication.getConnectionType(),
                result = null;
            if (params) {
                paramArray = Array.prototype.slice.call(params);
            }

            //if its webchannel, it expects we pass the callback function as the last param
            if (connectionType === communication.typeEnum.WEBCHANNEL) {
                paramArray.push(resolve);
            }

            result = self.clientObject[clientFnName].apply(self, paramArray);

            //if its bridge, we resolve the result immediately after we get it (since function calls are synchronous)
            if (connectionType === communication.typeEnum.BRIDGE) {
                resolve(result);
            }
        });
    };

    ClientObjectWrapper.prototype.connectClientSignalToJSSDKEvent = function(signalName, jssdkSignalName) {
        var self = this,
            error = clientObjectHasError(self, signalName);
        //check if we have an event by that name
        if (typeof events[jssdkSignalName] === 'undefined') {
            logger.error('ERROR: jssdk event not found:', jssdkSignalName);
            return;
        }

        //check if our client object is in order
        if (error) {
            logger.error(error.message);
            return;
        }

        self.clientObject[signalName].connect(function() {
            var args = Array.prototype.slice.call(arguments);
            args.unshift(events[jssdkSignalName]);
            //here we intercept the signal from the C++ and wait till the next event loop
            //before relaying the signal
            //
            //We've seen strange we behavior with out of focus client and promises that are called as a part
            //of the callstack from a C++ signal. Promises seem to hang until the user clicks focus again
            //
            //Putting the signal on the next event loop fixes this
            setTimeout(function() {
                events.fire.apply(events, args);
            }, 0);
        });

    };

    ClientObjectWrapper.prototype.propertyFromOriginClient = function(propertyName) {
        var self = this,
            error = clientObjectHasError(self, propertyName);

        if (error) {
            logger.error(error.message);
            return null;
        }

        return self.clientObject[propertyName];
    };

    return ClientObjectWrapper;

});
/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication with the C++ client
 */
define('modules/client/clientobjectregistry',[
    'core/logger',
    'modules/client/ClientObjectWrapper',
    'modules/client/communication'
], function(logger, ClientObjectWrapper, communication) {

    var registryResolves = {};


    function createClientObject(objectName) {
        return new ClientObjectWrapper(objectName);
    }

    function createClientObjects() {
        for (var r in registryResolves) {
            if (registryResolves.hasOwnProperty(r)) {
                registryResolves[r](createClientObject(r));
            }
        }
        registryResolves = {};
    }    

    function registerClientObject(cppObjectName) {
        var promise = null;
        if (communication.getConnectionType() === communication.typeEnum.NOTCONNECTED) {                        
           //if we are not connected yet, store off the register request so that we can resolve it when we are connected
            promise = new Promise(function(resolve) {
                registryResolves[cppObjectName] = resolve;
            });
        } else {
            //if we are already connected just create the client object and resolve immediately
            promise = Promise.resolve(createClientObject(cppObjectName));
        }

        return promise;
    }

    function init() {
        return communication.waitForConnectionEstablished()
            .then(createClientObjects);
    }

    return /** @lends module:Origin.module:client */ {
        registerClientObject: registerClientObject,
        init: init
    };
});
/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to online status with the C++ client
 */


define('modules/client/onlinestatus',[
    'modules/client/clientobjectregistry',
    'modules/client/communication'
], function(clientobjectregistry, communication) {
    var clientOnlineStatusWrapper = null,
        clientObjectName = 'OriginOnlineStatus';

    /**
     * Contains client onlineStatus communication methods
     * @module module:onlineStatus
     * @memberof module:Origin.module:client
     *
     */
    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientOnlineStatusWrapper = clientObjectWrapper;
        if (clientOnlineStatusWrapper.clientObject) {
            clientOnlineStatusWrapper.connectClientSignalToJSSDKEvent('onlineStateChanged', 'CLIENT_ONLINESTATECHANGED');
            clientOnlineStatusWrapper.connectClientSignalToJSSDKEvent('offlineModeBtnClicked', 'CLIENT_CLICKEDOFFLINEMODEBUTTON');
        }
    }

    clientobjectregistry.registerClientObject(clientObjectName).then(executeWhenClientObjectInitialized);

    return /** @lends module:Origin.module:client.module:onlineStatus */ {
        /**
         * returns true if Origin client is online
         * @returns {boolean} true/false
         * @static
         * @method
         */
        isOnline: function() {
            if (communication.isEmbeddedBrowser()) {
                return clientOnlineStatusWrapper.propertyFromOriginClient('onlineState');
            } else {
                return true;
            }
        },

        /**
         * requests online mode
         * @static
         * @method
         */
        goOnline: function() {
            return clientOnlineStatusWrapper.sendToOriginClient('requestOnlineMode', arguments);
        }
    };
});

/*jshint unused: false */
/*jshint strict: false */
define('core/dataManager',[
    'promise',
    'xml2json',
    'core/logger',
    'core/events',
    'core/user',
    'core/defines',
    'core/errorhandler',
    'core/utils',
    'modules/client/onlinestatus'
], function(Promise, xml2json, logger, events, user, defines, errorhandler, utils, onlinestatus) {
    /**
     * Contains authentication related methods
     * @module module:dataManager
     * @memberof module:Origin
     * @private
     */
    var queue = [];
    var HTTP_REQUEST_TIMEOUT = 30000; //milliseconds

    function djb2Code(str) {
        var chr,
            hash = 5381,
            len = str.length / 2;

        for (var i = str.length-1; i >= len; i--) {
            chr = str.charCodeAt(i);
            hash = hash + chr;
        }
        return hash;
    }

    function computeHashIndex(urlpath) {
        var hashVal = djb2Code(urlpath);

        hashVal = hashVal % 4;
        return hashVal;
    }

    function httpRequest(endPoint, config) {
        var exp;
        //swap out the parameters in the URL
        config.parameters = config.parameters || [];
        for (var i = 0, j = config.parameters.length; i < j; i++) {
            exp = new RegExp('{' + config.parameters[i].label + '}', 'g');
            endPoint = endPoint.replace(exp, config.parameters[i].val);
        }

        //append params
        if (typeof config.appendparams !== 'undefined') {
            for (i = 0, j = config.appendparams.length; i < j; i++) {
                if (i === 0) {
                    endPoint += '?';
                } else {
                    endPoint += '&';
                }

                endPoint += config.appendparams[i].label + '=' + config.appendparams[i].val;
            }
        }

        //now take the path portion of the endpoint and hash it
        if ((endPoint.indexOf('api{num}') > 0) || (endPoint.indexOf('data{num}') > 0)) {
            var origincom = endPoint.indexOf('origin.com/'),
                portion2beHashed;

            portion2beHashed = endPoint.substr(origincom+11);
            var hashIndex = computeHashIndex(portion2beHashed) + 1;

            endPoint = endPoint.replace('{num}', hashIndex);
        }

        //endPoint = encodeURI(endPoint);
        return new Promise(function(resolve, reject) {
            var req,
                data,
                responseHeaders ='';

            function requestSuccess(data, parseJSON, responseHeaders) {
                var result = '';
                if (data.length) {

                    if (parseJSON) {
                        try {
                            result = JSON.parse(data);
                        } catch (error) {
                            logger.error('ERROR:dataManager could not parse JSON', endPoint);
                            result = {};
                            // its not json
                        }
                    } else {
                        result = data;
                    }
                }

                if (config.responseHeader) {
                    resolve({headers:responseHeaders,
                             data: result});

                } else {
                    resolve(result);
                }
            }

            function requestError(status, textStatus, response) {
                var msg = 'httpRequest ERROR: ' + endPoint + ' ' + status + ' (' + textStatus + ')',
                    error = new Error(msg),
                    errResponse = {};

                error.status = status;
                error.endPoint = endPoint;

                if (response && response.length > 0) {
                    try {
                        errResponse = JSON.parse(response);
                    } catch (error) {
                        logger.error('ERROR:dataManager requestError could not parse response JSON', response);
                        errResponse = {};
                        // its not json
                    }
                }
                error.response = errResponse;
                reject(error);
            }

            function parseXml(xml) {
                var dom = null;
                if (window.DOMParser) {
                    try {
                        dom = (new DOMParser()).parseFromString(xml, 'text/xml');
                    } catch (e) {
                        dom = null;
                    }
                }
                //TODO: Need to handle IE
                /*else if (window.ActiveXObject) {
                    try {
                        dom = new ActiveXObject('Microsoft.XMLDOM');
                        dom.async = false;
                        if (!dom.loadXML(xml)) // parse error ..

                            window.alert(dom.parseError.reason + dom.parseError.srcText);
                    } catch (e) {
                        dom = null;
                    }
                } */
                else {
                    logger.error('cannot parse xml string!', endPoint);
                }
                return dom;
            }

            function isJSON(str) {
                try {
                    JSON.parse(str);
                } catch (e) {
                    return false;
                }
                return true;
            }

            if (endPoint === '') {
                requestError(-1, 'empty endPoint', '');
            } else {
                req = new XMLHttpRequest();
                data = config.body || '';

                req.open(config.atype, endPoint, true /*async*/ );
                req.timeout = HTTP_REQUEST_TIMEOUT;
                //add request headers
                for (var i = 0, j = config.headers.length; i < j; i++) {
                    req.setRequestHeader(config.headers[i].label, config.headers[i].val);
                }
                if (config.withCredentials) {
                    req.withCredentials = true;
                }

                req.onload = function() {
                    var contentType,
                        parsedXml,
                        jsonresp;

                    // initialize to raw response (assumed to be JSON)
                    jsonresp = req.response;

                    // do convert
                    if (!config.noconvert) {
                        contentType = req.getResponseHeader('content-type');

                        // no 'content-type' specified
                        if (contentType === null) {
                            // try to convert if it is not JSON
                            if( !isJSON(req.response) ) {
                                // see if it is XML
                                parsedXml = parseXml(req.response);
                                if (parsedXml !== null) {
                                    jsonresp = xml2json(parsedXml, '');
                                }
                            }
                        }
                        //if the response is in xml, we need to convert it to JSON
                        else
                        if (contentType.indexOf('xml') > -1) {
                            parsedXml = parseXml(req.response);
                            jsonresp = xml2json(parsedXml, '');
                        }
                    }
                    //202 is success, but pending (response we get from client local host)
                    if (req.status === 200 || req.status === 202) {
                        if (config.responseHeader) {
                            responseHeaders = req.getAllResponseHeaders();
                        }

                        requestSuccess(jsonresp, !config.noconvert, responseHeaders);
                    } else {
                        requestError(req.status, req.statusText, jsonresp);
                    }
                };

                // Handle network errors
                req.onerror = function() {
                    requestError('-1', 'XHR_Network_Error', '');
                };

                req.ontimeout = function() {
                    requestError('-2', 'XHR_Timed_Out', '');
                };

                req.send(data);
            }
        });
    }

    function objKeyMatches(obj1, obj2, key, blockStr) {
        if (obj1[key] === obj2[key]) {
            return true;
        }
        return false;
    }

    /**
     * Compare two configs for xhr requests to see if they match
     * @method
     * @param {Object} config1
     * @param {Object} config2
     * @return {Boolean}
     * @private
     */
    function configMatches(config1, config2) {
        var matches = false,
            k;

        if (objKeyMatches(config1, config2, 'atype', 'root') &&
            objKeyMatches(config1, config2, 'reqauth', 'root') &&
            objKeyMatches(config1, config2, 'requser', 'root') &&
            (config1.headers.length === config2.headers.length)) {
            for (k = 0; k < config1.headers.length; k++) {
                if (!objKeyMatches(config1.headers[k], config2.headers[k], 'label', 'headers') ||
                    !objKeyMatches(config1.headers[k], config2.headers[k], 'val', 'headers')) {
                    break;
                }
                matches = true;
            }
        }

        //still matches
        if (matches) {
            if (config1.parameters.length !== config2.parameters.length) {
                //logger.log ('config params lengths differ');
                matches = false;
            } else {
                for (k = 0; k < config1.parameters.length; k++) {
                    if (!objKeyMatches(config1.parameters[k], config2.parameters[k], 'label', 'params') ||
                        !objKeyMatches(config1.parameters[k], config2.parameters[k], 'val', 'params')) {
                        matches = false;
                        break;
                    }
                }
            }
        }

        if (matches) {
            //if the body is different consider different requests
            if(config1.body !== config2.body) {
                matches = false;
            } else if (typeof config1.appendparams !== typeof config2.appendparams) {
                matches = false;
                //logger.log('appendparams def/undef mismatch');
            } else if (typeof config1.appendparams !== 'undefined' && typeof config2.appendparams !== 'undefined') {
                if (config1.appendparams.length !== config2.appendparams.length) {
                    //logger.log ('config append param lengths differ');
                    matches = false;
                } else {
                    for (k = 0; k < config1.appendparams.length; k++) {
                        if (!objKeyMatches(config1.appendparams[k], config2.appendparams[k], 'label', 'appendparams') ||
                            !objKeyMatches(config1.appendparams[k], config2.appendparams[k], 'val', 'appendparams')) {
                            matches = false;
                            break;
                        }
                    }
                }

            }
        }
        return matches;
    }



    function deQueue(promise) {
        var dequeued = false,
            i = 0;

        if (queue.length > 0) {
            i = 0;
            for (i = 0; i < queue.length; i++) {
                if (queue[i].promise === promise) {
                    queue.splice(i, 1);
                    dequeued = true;
                    break;
                }
            }
        }
        if (dequeued === false) {
            logger.error('dequeue failed', promise);
        }
    }
    /**
     * dequeues the promise and passes on object
     * @param  {object} promise the promise to dequeue
     * @return {function} a function that returns the response
     */
    function deQueueAndPassResponse(promise) {
        return function(response) {
            deQueue(promise);
            return response;
        };
    }

    /**
     * dequeues the promise and passes on the error message
     * @param  {object} promise the promise to dequeue
     * @return {function} a function that returns the error
     */
    function deQueueAndPassFailure(promise) {
        return function(error) {
            deQueue(promise);
            return Promise.reject(error);
        };
    }

    function enQueue(baseUrl, config, outstanding) {
        var promise,
            endpoint = baseUrl,
            autoDequeue = true,
            configmatch = false,
            q = {};

        if (typeof config.autoDequeue !== 'undefined') {
            autoDequeue = config.autoDequeue;
        }

        config.parameters = config.parameters || [];
        for (var i = 0, j = config.parameters.length; i < j; i++) {
            endpoint = endpoint.replace(
                '{' + config.parameters[i].label + '}',
                encodeURIComponent(config.parameters[i].val)
            );
        }

        //look for it in the queue
        if (queue.length > 0) {
            for (i = 0; i < queue.length; i++) {
                if (queue[i].baseUrl === endpoint) { //check endpoint first
                    configmatch = configMatches(queue[i].config, config);
                    if (configmatch &&
                        queue[i].outstanding === outstanding) {
                        promise = queue[i].promise;
                        break;
                    }
                }
            }
        }

        if (typeof promise === 'undefined') {
            if (config.reqauth === true || config.requser === true) {
                promise = dataRESTauth(baseUrl, config);
            } else {
                promise = dataREST(baseUrl, config);
            }

            q = {};
            q.baseUrl = endpoint;
            q.config = config;
            q.outstanding = outstanding;
            q.promise = promise;
            queue.push(q);
            //we automatically dequeue the promise here unless we explicitly turn it off
            if (autoDequeue) {
                promise = promise.then(deQueueAndPassResponse(promise), deQueueAndPassFailure(promise));
            }

        }

        return promise;
    }

    function handleDataRestAuthError(endPoint, config) {
        return function(error) {
            //if this was an auth/user request then send back response to retry later
            //and then initiate a relogin
            var triggerRelogin = false,
                errorObj,
                cause,
                field;

            // if we are not currently logged in, then don't trigger a relogin
            var loggedIn = (user.publicObjs.accessToken().length !== 0 && user.publicObjs.userPid().length !== 0);
            if (!loggedIn) {
                return Promise.reject(error);
            }

            /*
             * Helpers
             */
            function getCauseAndField(response) {
                var cause, field;

                // unowned DLC
                cause = utils.getProperty(response, ['failure', 'cause']);
                field = utils.getProperty(response, ['failure', 'field']);



                /*
                 * Origin services should return the following error structure, e.g.,
                 *
                 * XML:
                 * <error code="10062" seq="13467605732696">
                 *     <failure value="" field="authToken" cause="MISSING_VALUE"/>
                 * </error>
                 *
                 * JSON:
                 * {error: {"code":"10062","seq":"13436458303827","failure":{"value":"","field":"authToken","cause":"MISSING_VALUE"}}}
                 *
                 *
                 * IMPORTANT: If you find an Origin service that returns an error structure other than the above, please log a bug to
                 *            the Origin Server Team.
                 *
                 *
                 *  The following case should handle error responses for all Origin services:
                 *  atom
                 *  avatars
                 *  ec2
                 *  ec2 proxy (supercarp)
                 *  xsearch
                 *  gifting
                 */
                if (cause === null && field === null) {
                    cause = utils.getProperty(response, ['error', 'failure', 'cause']);
                    field = utils.getProperty(response, ['error', 'failure', 'field']);
                }

                /*
                 * Non-Origin services
                 */

                // achievements, chat, friends, groups
                if (cause === null && field === null) {
                    cause = utils.getProperty(response, ['error', 'name']);
                }

                // gateway
                if (cause === null && field === null) {
                    cause = utils.getProperty(response, ['error']);
                }

                //EADP social (friend recommendation)
                if (cause === null && field === null) {
                  cause = utils.getProperty(response, ['message']);
                  field = utils.getProperty(response, ['code']);
                }

                return {
                    cause: cause,
                    field: field
                };
            }

            function shouldTriggerReloginAchievements(cause) {
                // modified, missing and expired access_token (401)
                if (cause && cause === 'AUTHORIZATION_REQUIRED') {
                    return true;
                }

                return false;
            }

            function shouldTriggerReloginFriendRecommendation(cause, field) {
                return field && field === 10000  && cause && cause === 'Authentication failed. Check your auth token.';
            }

            function shouldTriggerReloginAtom(cause, field) {
                if (cause && field) {
                    // missing access_token (403)
                    if (cause === 'TOKEN_USERID_INCONSISTENT' && field === 'authToken') {
                        return true;
                    }
                    else if (cause === 'MISSING_AUTHTOKEN' && field === 'authToken') { // atomUsers
                        return true;
                    }
                    // expired access_token (403)
                    else if (cause === 'invalid_token' && field === 'authToken') {
                        return true;
                    }
                    // modified access_token (403)
                    else if (cause === '500 Internal Server Error' && field === 'authToken') {
                        return true;
                    }
                }

                return false;
            }

            function shouldTriggerReloginAvatars(cause, field) {
                if (cause && field) {
                    // modified or expired access_token (401)
                    if (cause === 'INVALID_VALUE' && field === 'AuthToken') {
                        return true;
                    }
                    // missing access_token (401)
                    else if (cause === 'MISSING_VALUE' && field === 'token') {
                        return true;
                    }
                }

                return false;
            }

            function shouldTriggerReloginChat(cause) {
                if (cause) {
                    // modified, missing and expired access_token (401)
                    if (cause === 'AUTHTOKEN_INVALID') {
                        return true;
                    }
                }

                return false;
            }

            function shouldTriggerReloginEC2(cause, field) {
                if (cause && field) {
                    // missing access_token (401)
                    if (cause === 'MISSING_VALUE' && field === 'authToken') {
                        return true;
                    }
                    // modified or expired access_token (403)
                    else if (cause === 'INVALID_AUTHTOKEN' && field === 'authToken') {
                        return true;
                    }
                }

                return false;
            }

            function shouldTriggerReloginEC2Proxy(cause, field) {
                if (cause && field) {
                    // missing access_token (401)
                    if (cause === 'MISS_VALUE' && field === 'AuthToken') {
                        return true;
                    }
                    // modified or expired access_token (401)
                    else if (cause === 'AUTHTOKEN_USERID_UN_CONSISTENT' && field === 'AuthToken') {
                        return true;
                    }
                }

                return false;
            }

            function shouldTriggerReloginEC2ConsolidatedEntitlements(cause, field) {
                if (cause && field) {
                    // missing access_token (401)
                    if (cause === 'MISSING_VALUE' && field === 'authToken') {
                        return true;
                    }
                    // modified or expired access_token (403)
                    else if (cause === 'AUTHTOKEN_USERID_INCONSISTENT' && field === 'authToken') {
                        return true;
                    }
                }

                return false;
            }

            function shouldTriggerReloginFriends(cause) {
                // modified, missing and expired access_token (400)
                if (cause && cause === 'AUTHTOKEN_INVALID') {
                    return true;
                }

                return false;
            }

            function shouldTriggerReloginGateway(cause) {
                if (cause) {
                    // missing access_token (400)
                    if (cause === 'invalid_oauth_info') {
                        return true;
                    }
                    // modified and expired access_token (403)
                    else if (cause === 'invalid_access_token') {
                        return true;
                    }
                }

                return false;
            }

            function shouldTriggerReloginGifting(cause, field) {
                if (cause && field) {
                    // missing access_token (403)
                    if (cause === 'TOKEN_USERID_INCONSISTENT' && field === 'authToken') {
                        return true;
                    }
                    // expired and modified access_token (403)
                    else if (cause === 'invalid_token' && field === 'authToken') {
                        return true;
                    }
                }

                return false;
            }

            function shouldTriggerReloginGroups(cause) {
                if (cause) {
                    // modified, missing and expired access_token (401)
                    if (cause === 'AUTHTOKEN_INVALID') {
                        return true;
                    }
                }

                return false;
            }

            function shouldTriggerReloginXSearch(cause, field) {
                if (cause && field) {
                    // missing access_token (401)
                    if (cause === 'MISSING_AUTHTOKEN' && field === 'authToken') {
                        return true;
                    }
                    // modified access_token (403)
                    else if (cause === '500 Internal Server Error' && field === 'authToken') {
                        return true;
                    }
                    // expired access_token (403)
                    else if (cause === 'invalid_token' && field === 'authToken') {
                        return true;
                    }
                }

                return false;
            }

            /*
             * Determine whether to relogin
             */
            errorObj = getCauseAndField(error.response);
            cause = errorObj.cause;
            field = errorObj.field;

            if (error.status === defines.http.ERROR_400_BAD_REQUEST) {

                triggerRelogin = shouldTriggerReloginGateway(cause, field) ||
                                 shouldTriggerReloginFriends(cause, field);
            }
            else if (error.status === defines.http.ERROR_401_UNAUTHORIZED) {
                //a temporary hack to get around the issue that EC2 isn't allowing /public endpoints
                //we'll get back a 401 if we don't own the offer but we don't want to re-initiate
                //a login in the case.  so just allow it to fail
                if (!config.dontRelogin) {
                    //for unowned DLC, we can get back a 401 from a private offer request and the parent offerId isn't 1102/1103
                    //in that case, we don't want to trigger a relogin
                    //when access_token is invalid, we get back in the response:
                    //{"code":10053,"seq":"10074974195346","failure":{"cause":"INVALID_VALUE","field":"AuthToken","value":"QVQwOjEuMDozLjA6NjA6UEtPSnV1bW9CVzQ3UE41eWxUVFl1NzFjRzdnQ204ODczUHo6OTAwMDQ6bXE3bDZ"}}"
                    if (cause && cause === 'INVALID_VALUE' && field && field === 'AuthToken') {
                        triggerRelogin = true;
                    }

                    triggerRelogin = triggerRelogin ||
                                     shouldTriggerReloginEC2(cause, field) ||
                                     shouldTriggerReloginEC2Proxy(cause, field) ||
                                     shouldTriggerReloginEC2ConsolidatedEntitlements(cause, field) ||
                                     shouldTriggerReloginXSearch(cause, field) ||
                                     shouldTriggerReloginAvatars(cause, field) ||
                                     shouldTriggerReloginAchievements(cause, field) ||
                                     shouldTriggerReloginGroups(cause, field) ||
                                     shouldTriggerReloginChat(cause, field) ||
                                     shouldTriggerReloginFriendRecommendation(cause, field);
                }
            } else if (error.status === defines.http.ERROR_403_FORBIDDEN && !config.dontRelogin) {

                // check for empty response
                if (error.response.length === 0) {
                    triggerRelogin = true;
                }
                else {
                    triggerRelogin = shouldTriggerReloginAtom(cause, field) ||
                                     shouldTriggerReloginEC2(cause, field) ||
                                     shouldTriggerReloginEC2ConsolidatedEntitlements(cause, field) ||
                                     shouldTriggerReloginGateway(cause, field) ||
                                     shouldTriggerReloginXSearch(cause, field) ||
                                     shouldTriggerReloginGifting(cause, field) ||
                                     shouldTriggerReloginFriendRecommendation(cause, field);
                }
            }
            // The following will not execute due to the early exit above when not logged in
            /* else if (error.status === defines.http.ERROR_404_NOTFOUND) {
                if (config.reqauth && user.publicObjs.accessToken().length === 0) {
                    triggerRelogin = true;
                } else if (config.requser && user.publicObjs.userPid().length === 0) {
                    triggerRelogin = true;
                }
            }*/

            if (triggerRelogin) {
                return new Promise(function(resolve, reject) {
                    var loginSucceeded, loginFailed;
                    loginSucceeded = function() {
                        events.off(events.priv.AUTH_FAILED_POST_AUTHINVALID, loginFailed);
                        //AUTH_SUCCESS_POST_AUTHINVALID.off already because of events.once
                        //Login was successful, replace access token in headers
                        for (var i = 0; i < config.headers.length; i++) {
                            // if authHint is available, use that thing
                            if (config.hasOwnProperty('authHint')) {
                                if (config.headers[i].label === config.authHint.property) {
                                    config.headers[i].val = config.authHint.format.replace('{token}', user.publicObjs.accessToken());
                                    break;
                                }
                            } else if (config.headers[i].label === 'Authorization') {
                                config.headers[i].val = 'Bearer ' + user.publicObjs.accessToken();
                                break;
                            } else if (config.headers[i].label === 'AuthToken') {
                                config.headers[i].val = user.publicObjs.accessToken();
                                break;
                            }
                        }
                        //Retry the original request with the new auth token
                        httpRequest(endPoint, config).then(function(response) {
                            logger.log('dataRESTauth: reauth and sucess');
                            resolve(response);
                        }, function(error) {
                            logger.log('dataRESTauth: reauth and failure');
                            reject(error);
                        });
                    };
                    loginFailed = function() {
                        events.off(events.priv.AUTH_SUCCESS_POST_AUTHINVALID, loginSucceeded);
                        //AUTH_FAILED_POST_AUTHINVALID.off already because of events.once
                        error.message = 'OJSSDK_ERR_AUTH_RETRY_WHEN_READY';
                        reject(error);
                    };
                    //Trigger a login. As a result one of the above two functions will be called,
                    //closing out this promise
                    events.once(events.priv.AUTH_SUCCESS_POST_AUTHINVALID, loginSucceeded);
                    events.once(events.priv.AUTH_FAILED_POST_AUTHINVALID, loginFailed);
                    events.fire(events.priv.AUTH_TRIGGERLOGIN, defines.login.AUTH_INVALID);
                });
            } else {
                return Promise.reject(error);
            }
        };
    }

    /* declared in constants.js */
    function dataRESTauth(endPoint, config) {
        return httpRequest(endPoint, config).catch(handleDataRestAuthError(endPoint, config));
    }

    /**
     * @method
     */
    function dataREST(endPoint, config) {
        return httpRequest(endPoint, config);
    }

    /**
     * @method
     */
    function validateDataObject(objectContract, object) {
        var required = objectContract.required || [],
            optional = objectContract.optional || [],
            validDataSet = required.concat(optional),
            objectKeys = Object.keys(object),
            validatedObject = {},
            prop = '';

        // remove properties not defined in object contract
        for (prop in object) {
            if (validDataSet.indexOf(prop) !== -1) {
                validatedObject[prop] = object[prop];
            }
        }

        // ensure required properties are present in data object
        for (prop in required) {
            if (!validatedObject.hasOwnProperty(required[prop])) // and is not null
            {
                return false;
            }
        }

        return validatedObject;
    }


    return /** @lends module:Origin.module:dataManager */ {

        /**
         * @method
         */
        dataRESTauth: dataRESTauth,

        /**
         * @method
         */
        dataREST: dataREST,

        /**
         * Check and see if request already exists, if so return promise, otherwise, generate request, add to the queue, and return the associated promise
         * @method
         * @param {String} baseUrl
         * @param {Object} config
         * @param {String} outstanding outstanding request identifier (e.g. Last-Modified-Date)
         * @return {promise} promise to an xhr response
         * @private
         */
        enQueue: enQueue,

        /**
         * Remove the request(promise) from the queue
         * @method
         * @param {Object} promise
         * @private
         */
        deQueue: deQueue,

        /**
         * for online requests, add the additional header
         * @method
         * @param {string} label label to use
         * @param {string} val value of the label
         */
        addHeader: function(config, label, val) {
            config = config || {};
            config.headers = config.headers || [];
            //use onlinestatus instead of bringing in all of client to avoid circular dependency
            if (onlinestatus.isOnline()) {
                config.headers.push({
                    'label': label,
                    'val': val
                });
            }
        },

        /**
         * Put a body on a request
         * @param {Object} config     the config object
         * @param {Object} bodyObject the data that you want in the body. This will replace what is currently in the body.
         */
        addBody: function(config, bodyObject) {
            config = config || {};
            config.body = bodyObject;
        },
        /**
         * Replacements for parameters within endpoint
         * @method
         * @param {Object} config config object
         * @param {String} label label to use
         * @param {String} val value of the label
         */
        addParameter: function(config, label, val) {
            config = config || {};
            config.parameters = config.parameters || [];
            config.parameters.push({
                'label': label,
                'val': val
            });
        },

        /**
         * Query parameters appended to endpoint
         * @method
         * @param {Object} config config object
         * @param {String} label label to use
         * @param {String} val value of the label
         */
        appendParameter: function(config, label, val) {
            config = config || {};
            config.appendparams = config.appendparams || [];
            config.appendparams.push({
                'label': label,
                'val': val
            });
        },

        /**
         * Adds hinting for auth token header, to allow retry replacement
         * @param {Object} config config object
         * @param {String} property authentication token name
         * @param {String} format authentication token string (use {token} as placeholder)
         */
        addAuthHint: function(config, property, format) {
            config.authHint = {property: property, format: format};
        },

        validateDataObject: validateDataObject

    };

});

/*jshint strict: false */
define('core/dirtybits',[
    'core/user',
    'core/urls',
    'core/logger',
    'core/events',
    'core/utils'
], function(user, urls, logger, events, utils) {

    var myEvents = new utils.Communicator(),
        dirtyBitsConnection = null,
        keepAliveData = new Uint8Array(),
        KEEP_CONNECTION_ALIVE_TIMEOUT = 55000,
        logPrefix = '[DIRTYBITS-WWW]',
        contextToJSSDKEventMap = {
            'ach': events.DIRTYBITS_ACHIEVEMENTS,
            'group': events.DIRTYBITS_GROUP,
            'email': events.DIRTYBITS_EMAIL,
            'password': events.DIRTYBITS_PASSWORD,
            'originid': events.DIRTYBITS_ORIGINID,
            'gamelib': events.DIRTYBITS_GAMELIB,
            'privacy': events.DIRTYBITS_PRIVACY,
            'avatar': events.DIRTYBITS_AVATAR,
            'entitlement': events.DIRTYBITS_ENTITLEMENT,
            'catalog': events.DIRTYBITS_CATALOG,
            'subscription': events.DIRTYBITS_SUBSCRIPTION
        };

    /**
     * sends a dummy piece of data to keep the connection alive
     */
    function sendPong() {
        if (dirtyBitsConnection) {
            dirtyBitsConnection.send(keepAliveData);
        }
    }

    /**
     * instantiates a new websocket object and connects to the websocket server
     * @param  {function} completedCallback callback triggered when successfully connects
     * @param  {function} errorCallback     callback triggered when hits and error
     */
    function createNewWebSocketConnection() {
        var serverUrl = urls.endPoints.dirtyBitsServer.replace('{userPid}', user.publicObjs.userPid()).replace('{accessToken}', user.publicObjs.accessToken()),
            intervalID = null,
            connectionTimeoutHandle = null,
            CONNECTION_TIMEOUT=10000;


        function clearConnectionTimeout() {
            if(connectionTimeoutHandle) {
                clearTimeout(connectionTimeoutHandle);
                connectionTimeoutHandle = null;
            }
        }

        function abortConnectionAttempt() {
            dirtyBitsConnection.close();
        }
                    
        dirtyBitsConnection = new WebSocket(serverUrl);

        dirtyBitsConnection.onmessage = function(dirtyBitEvent) {
            var dirtyBitObject = JSON.parse(dirtyBitEvent.data);

            var jssdkEvent = contextToJSSDKEventMap[dirtyBitObject.ctx];
            if (jssdkEvent) {
                events.fire(jssdkEvent, dirtyBitObject.data);
                logger.log(logPrefix, '[UPDATE]:', dirtyBitObject.ctx, ':', dirtyBitObject.data);
            }
        };

        dirtyBitsConnection.onerror = function(dirtyBitEvent) {
            clearConnectionTimeout();
            logger.error(logPrefix, dirtyBitEvent);
            myEvents.fire('dirtybits:connectionchanged');
        };

        dirtyBitsConnection.onopen = function() {
            clearConnectionTimeout();
            logger.log(logPrefix, 'connection established.');
            intervalID = setInterval(sendPong, KEEP_CONNECTION_ALIVE_TIMEOUT);
            myEvents.fire('dirtybits:connectionchanged');
        };

        dirtyBitsConnection.onclose = function() {
            clearInterval(intervalID);
            clearConnectionTimeout();

            //we null out our connection, if we reconnect we need to reinstantiate the socket object anyways
            dirtyBitsConnection = null;


            logger.log(logPrefix, 'connection closed.');
            myEvents.fire('dirtybits:connectionchanged');
        };

        //the default time out is almost 60 seconds, so we set our own
        connectionTimeoutHandle = setTimeout(abortConnectionAttempt, CONNECTION_TIMEOUT);
    }

    function handleConnectionPromiseError(error) {
        logger.error(error.message);
    }

    function setupConnectionListener(callback) {
        myEvents.once('dirtybits:connectionchanged', callback);
    }

    /**
     * connect to dirty bits server
     */
    function connect() {
        return new Promise(function(resolve) {
            //if we are already connected lets just resolve and not try again
            //1 means connection established           
            if (dirtyBitsConnection && dirtyBitsConnection.readyState === 1) {
                resolve();
            } else {
                //listen for connection change so we can resolve
                setupConnectionListener(resolve);

                //we always want to resolve the websocket connection even for failure so that we continue
                createNewWebSocketConnection();
            }
        }).catch(handleConnectionPromiseError); //catch the promise here to handle any errors so that auth will always continue
    }

    /**
     * disconnect from dirty bits server
     */
    function disconnect() {
        return new Promise(function(resolve) {
            if (dirtyBitsConnection) {
                setupConnectionListener(resolve);
                dirtyBitsConnection.close();
            } else {
                //if there's no connection (cause we timed out or something) lets just resolve;
                resolve();
            }
        }).catch(handleConnectionPromiseError);
    }

    return {
        /**
         * Connect to the dirty bits server
         * @static
         * @method
         */
        connect: connect,
        /**
         * Disconnect from the dirty bits server
         * @static
         * @method
         */
        disconnect: disconnect,
        /**
         * Context to JSSDK map
         */
        contextToJSSDKEventMap: contextToJSSDKEventMap,
    };
});
/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to origin operation (download/install/update/repair) queue
 */


define('modules/client/contentOperationQueue',[
    'modules/client/clientobjectregistry',
    'modules/client/communication'
], function(clientobjectregistry, communication) {
    var clientContentOperationQueueWrapper = null,
        clientObjectName = 'OriginContentOperationQueueController';

    /**
     * Contains client content operation queue communication methods
     * @module module:origincontentoperationqueue
     * @memberof module:Origin.module:client
     *
     */
    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientContentOperationQueueWrapper = clientObjectWrapper;
        if (clientContentOperationQueueWrapper.clientObject) {
            clientContentOperationQueueWrapper.connectClientSignalToJSSDKEvent('enqueued', 'CLIENT_OPERATIONQUEUE_ENQUEUED');
            clientContentOperationQueueWrapper.connectClientSignalToJSSDKEvent('removed', 'CLIENT_OPERATIONQUEUE_REMOVED');
            clientContentOperationQueueWrapper.connectClientSignalToJSSDKEvent('addedToComplete', 'CLIENT_OPERATIONQUEUE_ADDEDTOCOMPLETE');
            clientContentOperationQueueWrapper.connectClientSignalToJSSDKEvent('completeListCleared', 'CLIENT_OPERATIONQUEUE_COMPLETELISTCLEARED');
            clientContentOperationQueueWrapper.connectClientSignalToJSSDKEvent('headBusy', 'CLIENT_OPERATIONQUEUE_HEADBUSY');
            clientContentOperationQueueWrapper.connectClientSignalToJSSDKEvent('headChanged', 'CLIENT_OPERATIONQUEUE_HEADCHANGED');
        }
    }

    clientobjectregistry.registerClientObject(clientObjectName).then(executeWhenClientObjectInitialized);

    return /** @lends module:Origin.module:client.module:origincontentoperationqueue */ {
        /**
         * Removes entitlement with passed in offer id from queue.
         * @param {offerId} offerId of the entitlement we are removing
         * @static
         * @method
         */
        remove: function(offerId) {
            clientContentOperationQueueWrapper.sendToOriginClient('remove', arguments);
        },

        /**
         * Pushes entitlement with passed in offer id to the top of the queue.
         * @param {offerId} offerId of the entitlement we are pushing to the top of the queue.
         * @static
         * @method
         */
        pushToTop: function(offerId) {
            clientContentOperationQueueWrapper.sendToOriginClient('pushToTop', arguments);
        },

        /**
         * Returns index of offer id in the queue. Returns -1 if it isn't there.
         * @param {offerId} offerId of the entitlement.
         * @returns {int} index/position of entitlement in queue
         * @static
         * @method
         */
        index: function(offerId) {
            return clientContentOperationQueueWrapper.sendToOriginClient('index', arguments);
        },

        /**
         * Returns true/false if entitlement is in the queue.
         * @param {offerId} offerId of the entitlement.
         * @returns {Boolean} if entitlement is in queue.
         * @static
         * @method
         */
        isInQueue: function(offerId) {
            return clientContentOperationQueueWrapper.sendToOriginClient('isInQueue', arguments);
        },

        /**
         * Returns true/false if entitlement is in the queue or in completed list.
         * @param {offerId} offerId of the entitlement.
         * @returns {Boolean} if entitlement is in queue or in the completed list.
         * @static
         * @method
         */
        isInQueueOrCompleted: function(offerId) {
            return clientContentOperationQueueWrapper.sendToOriginClient('isInQueueOrCompleted', arguments);
        },

        /**
         * Returns true/false if entitlement the entitlement can move to the front of the queue.
         * @param {offerId} offerId of the entitlement.
         * @returns {Boolean} if entitlement if entitlement can move to the front of the queue.
         * @static
         * @method
         */
        isQueueSkippingEnabled: function(offerId) {
            return clientContentOperationQueueWrapper.sendToOriginClient('queueSkippingEnabled', arguments);
        },

        /**
         * Returns true/false if the head entitlement of the queue is busy.
         * @returns {Boolean} true/false if the head of the queue is busy.
         * @static
         * @method
         */
        isHeadBusy: function() {
            return clientContentOperationQueueWrapper.sendToOriginClient('isHeadBusy');
        },

        /**
         * Clears the completed list.
         * @static
         * @method
         */
        clearCompleteList: function() {
            clientContentOperationQueueWrapper.sendToOriginClient('clearCompleteList');
        },

        /**
         * Returns true/false if entitlement's parent is in the list.
         * @param {offerId} offerId of the child entitlement.
         * @returns {Boolean} Returns true/false if entitlement's parent is in the list.
         * @static
         * @method
         */
        isParentInQueue: function(childOfferId) {
            return clientContentOperationQueueWrapper.sendToOriginClient('isParentInQueue', arguments);
        },

        /**
         * Returns offer id/product id of the head item in queue
         * @returns {Object} Returns offer id/product id of the head item in queue
         * @static
         * @method
         */
        headOfferId: function() {
            return clientContentOperationQueueWrapper.sendToOriginClient('headOfferId', arguments);
        },

        /**
         * Returns array of state objects for items in the queue
         * @returns {Array} array of state objects for items in the queue
         * @static
         * @method
         */
        entitlementsQueued: function() {
            return clientContentOperationQueueWrapper.sendToOriginClient('entitlementsQueued', arguments);
        },

        /**
         * Returns list of offer ids/prodct ids in the completed list
         * @returns {StringList} Returns list of offer ids/prodct ids in the complete list
         * @static
         * @method
         */
        entitlementsCompletedOfferIdList: function() {
            return clientContentOperationQueueWrapper.sendToOriginClient('entitlementsCompletedOfferIdList', arguments);
        }
    };
});
/*jshint strict: false */


define('core/beacon',[
    'core/dataManager',
    'core/urls',
    'generated/jssdkconfig.js'
], function(dataManager, urls, jssdkconfig) {

    /**
     * Contains methods to query the Origin client for installation and version
     * @module module:beacon
     * @memberof module:Origin
     */

    /**
     * The property in which the beacon response value is stored in the JSON beacon response.
     * @constant
     * @default
     * @type {string}
     */
    var BEACON_RESPONSE_PROPERTY = 'resp';

    /**
     * The beacon response pong string
     * @constant
     * @default
     * @type {string}
     */
    var BEACON_PONG = 'pong';

    /**
     * The configuration used for dataManager to query the Origin beacon service.
     */
    var beaconQueryConfig = {
        atype: 'GET',
        headers: [],
        parameters: [],
        reqauth: false,
        requser: false
    };

    /**
     * Installed clients will expose a version number.
     *
     * @param  {Object} response the response from data manager
     * @return {string} the version number or undefined if the property is empty
     */
    function handleVersionResponse(response) {
        if (response.hasOwnProperty(BEACON_RESPONSE_PROPERTY)) {
            return response[BEACON_RESPONSE_PROPERTY];
        }

        return undefined;
    }

    /**
     * In the case of an HTTP error, resolve to an undefined client version value
     *
     * @return {Promise.<undefined, Error>}
     */
    function handleVersionError() {
        return Promise.resolve(undefined);
    }

    /**
     * Determine if the client is actively running
     *
     * @param  {Object} response the response from data manager
     * @return {Boolean} true if running
     */
    function handleRunningResponse(response) {
        if (response.hasOwnProperty(BEACON_RESPONSE_PROPERTY) && response[BEACON_RESPONSE_PROPERTY] === BEACON_PONG) {
            return true;
        }

        return false;
    }

    /**
     * In the case of an HTTP error, resolve to false for running status
     *
     * @return {Promise.<Boolean, Error>}
     */
    function handleRunningError() {
        return Promise.resolve(false);
    }

    /**
     * use the provided user agent string override or fallback to window navigator
     *
     * @param  {string} userAgent the user agent string override
     * @return {string} the user agent string
     */
    function getUserAgent(userAgent) {
        return userAgent || window.navigator.userAgent;
    }

    /**
     * Check if the user agent matches the minimum Operating system requirments for Origin to run correctly on Windows
     *
     * @param {string} userAgent the user agent string to use
     * @return {Boolean}
     * @see https://msdn.microsoft.com/en-us/library/windows/desktop/ms724832%28v=vs.85%29.aspx - list of NT Versions
     */
    function isInstallableOnWindows(userAgent) {
        var windowsCheck = new RegExp('\\bWindows NT ([\\d\\.]+)').exec(userAgent);
        if (windowsCheck instanceof Array && windowsCheck.length === 2) {
            var versionNumber = parseFloat(windowsCheck[1], 10); //Windows NT
            return (versionNumber >= jssdkconfig.osminversion.windowsnt) ? true : false; //6.1 is Windows 7
        }

        return false;
    }

    /**
     * Check if the user agent matches the minimum Operating system requirments for Origin to run correctly on Mac OS
     *
     * @param {string} userAgent the user agent string to use
     * @return {Boolean}
     * @see http://www.useragentstring.com/pages/Safari
     */
    function isInstallableOnMac(userAgent) {
        var macCheck = new RegExp('\\bMacintosh; Intel Mac OS X 10[\\._]([\\d_\\.]+)').exec(userAgent);
        if (macCheck instanceof Array && macCheck.length === 2) {
            var versionNumber = parseFloat(macCheck[1].replace('_','.'), 10); //Macintosh; Intel Mac OS X 10_11_2 (trim off the 10_ and use remaining number)
            return (versionNumber >= jssdkconfig.osminversion.macosx) ? true : false; //10.7 or higher
        }

        return false;
    }

    /**
     * Check both platforms
     *
     * @param {string} userAgent the user agent string to use
     * @return {Boolean}
     */
    function isInstallableOnMacOrPc(userAgent) {
        return (isInstallableOnWindows(userAgent) || isInstallableOnMac(userAgent));
    }

    function installed() {
        var endpoint = urls.endPoints.localOriginClientBeaconVersion;

        return dataManager.dataREST(endpoint, beaconQueryConfig)
            .then(handleVersionResponse)
            .catch(handleVersionError);
    }

    function installable(userAgent) {
        userAgent = getUserAgent(userAgent);

        return new Promise(function(resolve) {
            if (isInstallableOnMacOrPc(userAgent)) {
                resolve(true);
            } else {
                resolve(false);
            }
        });
    }

    function installableOnPlatform(platform, userAgent) {
        var catalogPlatforms = {
                'PCWIN': isInstallableOnWindows,
                'MAC': isInstallableOnMac
            };

        userAgent = getUserAgent(userAgent);

        return new Promise(function(resolve) {
            if (catalogPlatforms[platform] && catalogPlatforms[platform].apply(undefined, [userAgent])) {
                resolve(true);
            } else {
                resolve(false);
            }
        });
    }

    function running() {
        var endpoint = urls.endPoints.localOriginClientPing;

        return dataManager.dataREST(endpoint, beaconQueryConfig)
            .then(handleRunningResponse)
            .catch(handleRunningError);
    }

    return  {
        /**
         *
         * Returns a promise that resolves if Origin client is installed, rejects otherwise
         *
         * @method
         * @static
         * @returns {Promise.<String, Error>} resolves to a boolean
         */
        installed: installed,

        /**
         *
         * Returns whether Origin can be installed on the current OS
         *
         * @method
         * @static
         * @param {string} userAgent optional user agent override
         * @returns {Promise.<Boolean, Error>} resolves to a boolean
         */
        installable: installable,

        /**
         *
         * Returns whether the client is installable for a specific platform
         *
         * @method
         * @static
         * @param {string} platform the catalog platform to query eg. PCWIN/MAC
         * @param {string} userAgent optional useragent override
         * @returns {Promise.<Boolean, Error>} resolves to a boolean
         */
        installableOnPlatform: installableOnPlatform,

        /**
         *
         * Returns whether Origin is running on the current machine
         *
         * @method
         * @static
         * @returns {Promise.<Boolean, Error>} resolves to a boolean
         */
        running: running
    };
});

/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to online status with the C++ client
 */


define('modules/client/remote',[
    'core/urls',
    'core/logger',
    'core/beacon',
    'core/dataManager'
], function(urls, logger, beacon, dataManager) {
    /**
     * Contains client remote communication methods
     * @module module:remote
     * @memberof module:Origin.module:client
     * @private
     *
     */

    /**
     * the local host version of the command
     * @param  {object} config   configuration information for the command
     * @param  {string} endpoint endpoint for the command
     */
    function localHostCommand(config, endpoint) {
        return function() {
            return dataManager.dataREST(endpoint, config);
        };
    }

    /**
     * the origin2 version of the command
     * @param  {object} config   configuration information for the command
     * @param  {string} endpoint endpoint for the command
     */

    function origin2Command(config, endpoint) {
        return function() {
            config.parameters.forEach(function(param) {
                endpoint = endpoint.replace('{' + param.label + '}', param.val);
            });

            window.location.href = endpoint;

            //return a promise to keep consistent with local host call
            return Promise.resolve();
        };
    }

    /**
     * checks to see if origin client is running if it is then issue local host command
     * otherwise use origin2
     * @param  {object} config   configuration information for the command
     * @param  {string} origin2url the origin2:// endpoint for the command
     * @param  {string} localHostUrl the localhost endpoint for the command
     */
    function remoteCommand(config, localHostUrl, origin2Url) {
        return beacon.running()
            .then(localHostCommand(config, localHostUrl))
            .catch(origin2Command(config, origin2Url));
    }

    /**
     * launches a game remotely, initiates a download if the game is not installed and the autodownload flag is set to 1
     * @param {string} offerIds a comma delimited list of offers to look for
     * @param {boolean} autoDownload true if you want to download if not installed
     */
    function gameLaunch(offerIds, autoDownload) {
        var autoDownloadVal = autoDownload ? 1 : 0,
            config = {
                atype: 'POST',
                headers: [],
                parameters: [{
                    'label': 'offerIds',
                    'val': offerIds
                }, {
                    'label': 'autoDownload',
                    'val': autoDownloadVal
                }],
                reqauth: false,
                requser: false,
                body: ''
            };

        return remoteCommand(config, urls.endPoints.localHostClientGameLaunch, urls.endPoints.origin2ClientGameLaunch);
    }


    return /** @lends module:Origin.module:client.module:remote */ {
        /**
         * launches a game remotely, initiates a download if the game is not installed and the autodownload flag is set to 1
         * @param {string} offerIds a comma delimited list of offers to look for
         * @param {boolean} autoDownload true if you want to download if not installed
         * @static
         * @method
         */
        gameLaunch: gameLaunch
    };
});
/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to games with the C++ client
 */

define('modules/client/games',[
    'modules/client/clientobjectregistry',
    'modules/client/communication',
    'modules/client/remote',
    'core/telemetry',
    'core/events'
], function(clientobjectregistry, communication, remote, telemetry, events) {
    /**
     * Contains client games communication methods
     * @module module:games
     * @memberof module:Origin.module:client
     *
     */

    var clientGameWrapper = null,
        clientObjectName = 'OriginGamesManager',
        retrieveSignalName = 'consolidatedEntitlementsFinished',
        retrieveConsolidatedEntitlementsPromise = null;

    /**
     * This function takes in an action name and returns a function with a product id
     * @param  {string} actionName the name that corresponds with the C++ function
     */
    function createSendGameActionToClientFunction(actionName) {
        return function(prodId) {
            telemetry.sendClientAction(actionName, prodId);
            return clientGameWrapper.sendToOriginClient('onRemoteGameAction', [prodId, actionName, {}]);
        };
    }

    /**
    * This method wraps game action calls in an RTP layer which will either
    * execute the action if we are in the client or will trigger an RTP call
    * @param {String} action - the game action to send to the client
    */
    function rtpGameLaunchWrapper(action) {
        if (communication.isEmbeddedBrowser()) {
            return createSendGameActionToClientFunction(action);
        } else {
            //this triggers the RTP call to the client with autoDownload set to true. This call handles the
            //case where the user doesn't have the entitlement
            return function(productId) {
                telemetry.sendClientAction(action, productId);
                return remote.gameLaunch(productId, true);
            };
        }
    }

    function handleConsolidatedGamesResponseFromClient(results) {
        events.fire('consolidated-response', results);
    }


    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientGameWrapper = clientObjectWrapper;
        if (clientGameWrapper.clientObject) {
            clientGameWrapper.connectClientSignalToJSSDKEvent('changed', 'CLIENT_GAMES_CHANGED');
            clientGameWrapper.connectClientSignalToJSSDKEvent('cloudUsageChanged', 'CLIENT_GAMES_CLOUD_USAGE_CHANGED');
            clientGameWrapper.connectClientSignalToJSSDKEvent('progressChanged', 'CLIENT_GAMES_PROGRESSCHANGED');
            clientGameWrapper.connectClientSignalToJSSDKEvent('operationFailed', 'CLIENT_GAMES_OPERATIONFAILED');
            clientGameWrapper.connectClientSignalToJSSDKEvent('playTimeChanged', 'CLIENT_GAMES_PLAYTIMECHANGED');
            clientGameWrapper.connectClientSignalToJSSDKEvent('basegamesupdated', 'CLIENT_GAMES_BASEGAMESUPDATED');
            clientGameWrapper.connectClientSignalToJSSDKEvent('downloadQueueChanged', 'CLIENT_GAMES_DOWNLOADQUEUECHANGED');
            clientGameWrapper.connectClientSignalToJSSDKEvent('nogUpdated', 'CLIENT_GAMES_NOGUPDATED');
            clientGameWrapper.connectClientSignalToJSSDKEvent('trialTimeUpdated', 'CLIENT_GAMES_TRIALTIMEUPDATED');
            clientGameWrapper.clientObject[retrieveSignalName].connect(handleConsolidatedGamesResponseFromClient);
        }
    }

    clientobjectregistry.registerClientObject(clientObjectName).then(executeWhenClientObjectInitialized);


    return /** @lends module:Origin.module:client.module:games */ {
        /**
         * retrieves the current state of the games of the client
         * @return {promise<GameStateInfo>}
         * @static
         */
        requestGamesStatus: function() {
            return clientGameWrapper.sendToOriginClient('requestGamesStatus', arguments);
        },

        retrieveConsolidatedEntitlements: function(endPoint, forceRetrieve) {
            if (!retrieveConsolidatedEntitlementsPromise) {
                retrieveConsolidatedEntitlementsPromise = new Promise(function(resolve, reject) {
                    events.once('consolidated-response', function(results) {
                        retrieveConsolidatedEntitlementsPromise = null;
                        if ((Object.keys(results).length === 2) && (results.constructor === Array)) {
                            var data = JSON.parse(results[0]),
                                headers = results[1];
                            resolve({
                                headers: headers,
                                data: data
                            });
                        } else {
                            reject(new Error());
                        }
                    });
                    // fire off request to client
                    clientGameWrapper.sendToOriginClient('retrieveConsolidatedEntitlements', [endPoint, forceRetrieve || 'false']);
                });

            }

            return retrieveConsolidatedEntitlementsPromise;
        },
        /**
         * The data structure used by the Origin enbedded client to represent custom box art.
         *
         * @typedef {Object} CustomBoxArtInfo
         * @type {Object}
         *
         * @property {URL} customizedBoxart - The custom box art, encoded as a URL.
         * @property {number} cropCenterX - The horizontal center of the cropped box art.
         * @property {number} cropCenterY - The vertical center of the cropped box art.
         * @property {boolean} croppedBoxart - Indicates whether or not the box art is cropped.
         * @property {number} cropWidth - The cropped width of the custom box art.
         * @property {number} cropHeight - The cropped height of the custom box art.
         * @property {number} cropLeft - The left offset of the cropped custom box art.
         * @property {number} cropTop - The top offset of the cropped custom box art.
         */

        /**
         * Returns custom box art, if any.
         *
         * @param {string} productId - The Product ID of the game.
         * @returns {Promise<CustomBoxArtInfo>} The {@link CustomBoxArtInfo} configured in the embedded client.
         * @static
         * @method
         */
        getCustomBoxArtInfo: createSendGameActionToClientFunction('getCustomBoxArtInfo'),

        ///////////////////////////////////
        /// Downloading
        //////////////////////////////////

        /**
         * start a download of a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        startDownload: rtpGameLaunchWrapper('startDownload'),

        /**
         * cancel the download of a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        cancelDownload: createSendGameActionToClientFunction('cancelDownload'),
        /**
         * pause the download of a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        pauseDownload: createSendGameActionToClientFunction('pauseDownload'),
        /**
         * resume the download of a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        resumeDownload: createSendGameActionToClientFunction('resumeDownload'),

        ///////////////////////////////////
        /// Updating
        //////////////////////////////////
        /**
         * force check if there is an update available
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        checkForUpdateAndInstall: createSendGameActionToClientFunction('checkForUpdateAndInstall'),
        /**
         * install the update
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        installUpdate: createSendGameActionToClientFunction('installUpdate'),
        /**
         * pause the update operation
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        pauseUpdate: createSendGameActionToClientFunction('pauseUpdate'),
        /**
         * resume the update operation
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        resumeUpdate: createSendGameActionToClientFunction('resumeUpdate'),
        /**
         * cancel the update operation
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        cancelUpdate: createSendGameActionToClientFunction('cancelUpdate'),

        ///////////////////////////////////
        /// Repairing
        //////////////////////////////////
        /**
         * repair a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        repair: createSendGameActionToClientFunction('repair'),
        /**
         * cancel the repair of a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        cancelRepair: createSendGameActionToClientFunction('cancelRepair'),
        /**
         * pause the repair a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        pauseRepair: createSendGameActionToClientFunction('pauseRepair'),
        /**
         * resume the repair a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        resumeRepair: createSendGameActionToClientFunction('resumeRepair'),


        ///////////////////////////////////
        /// Cloud syncing
        //////////////////////////////////
        /**
         * cancel the cloud save sync operation
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        cancelCloudSync: createSendGameActionToClientFunction('cancelCloudSync'),
        /**
         * fetches the size of the data currently stored on the cloud
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        pollCurrentCloudUsage: createSendGameActionToClientFunction('pollCurrentCloudUsage'),
        /**
         * if user downloaded a cloud save accidentally, this operation will rollback to the most recent on-disk save
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        restoreLastCloudBackup: createSendGameActionToClientFunction('restoreLastCloudBackup'),

        ///////////////////////////////////
        /// Non Origin Game
        //////////////////////////////////
        /**
         * remove the non-Origin game from the library
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        removeFromLibrary: createSendGameActionToClientFunction('removeFromLibrary'),

        /**
         * retrieves all non-Origin games from the client, as a single JSON array.
         * @returns {Promise<NOGInfo>}
         * @static
         * @method
         */
        getNonOriginGames: function() {
          return clientGameWrapper.sendToOriginClient('getNonOriginGames', arguments);
        },

        ///////////////////////////////////
        /// Playing
        //////////////////////////////////
        /**
         * play a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        play: rtpGameLaunchWrapper('play'),

        /**
         * is a game playing
         * @param
         * @static
         * @method
         */
        isGamePlaying: function() {
            if (communication.isEmbeddedBrowser()) {
                return clientGameWrapper.sendToOriginClient('isGamePlaying', arguments);
            } else {
                return Promise.resolve(false);
            }
        },
        ///////////////////////////////////
        /// Installing
        //////////////////////////////////
        /**
         * install a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        install: createSendGameActionToClientFunction('install'),
        /**
         * cancel the install of a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        cancelInstall: createSendGameActionToClientFunction('cancelInstall'),
        /**
         * pause the install of a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        pauseInstall: createSendGameActionToClientFunction('pauseInstall'),
        /**
         * resume the install of a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        resumeInstall: createSendGameActionToClientFunction('resumeInstall'),
        /**
         * customize box art of the game, calling this function will bring up a dialog to start the process
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        customizeBoxArt: createSendGameActionToClientFunction('customizeBoxArt'),
        /**
         * uninstall a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        uninstall: function(prodId, silent) {
            return clientGameWrapper.sendToOriginClient('onRemoteGameAction', [prodId, 'uninstall', {silent: silent ? silent : false}]);
        },
        /**
         * restore a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        restore: createSendGameActionToClientFunction('restore'),
        /**
         * move the game to the top of the download queue
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        moveToTopOfQueue: createSendGameActionToClientFunction('moveToTopOfQueue'),
        /**
         * install the parent offer for a DLC
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        installParent: createSendGameActionToClientFunction('installParent'),
        /**
         * retrieve the multi-launch options for a game
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        getMultiLaunchOptions: createSendGameActionToClientFunction('getMultiLaunchOptions'),

        /**
         * update the multi-launch options for a game to settings
         * @param  {string} productId the product id of the game
         * @param  {string} launcher title user selected
         * @static
         * @method
         */
        updateMultiLaunchOptions: function(prodId, launcher) {
            return clientGameWrapper.sendToOriginClient('onRemoteGameAction', [prodId, 'updateMultiLaunchOptions', {launcher: launcher}]);
        },

        /**
         * retrieve the available locales for a game
         * @param  {string} productId the product id of the game
         * @static
         * @method getAvailableLocales
         */
        getAvailableLocales: createSendGameActionToClientFunction('getAvailableLocales'),
        /**
         * retrieve the executable path for a non-origin game
         * @param  {string} productId the product id of the game
         * @static
         * @method getAvailableLocales
         */
        getNOGExecutablePath: createSendGameActionToClientFunction('getNOGExecutablePath'),
        /**
         * Launch the game in ODT
         * @param  {string} productId the product id of the game
         * @static
         * @method
         */
        openInODT: createSendGameActionToClientFunction('openInODT'),
        /**
         * update the installed locale for a game
         * @param  {string} productId the product id of the game
         * @param  {string} newLocale the new locale of the game installation
         * @static
         * @method updateInstalledLocale
         */
        updateInstalledLocale: function(prodId, newLocale) {
            return clientGameWrapper.sendToOriginClient('onRemoteGameAction', [prodId, 'updateInstalledLocale', {newLocale: newLocale}]);
        },

        /**
         * update the installed locale for a game
         * @param  {string} productId the product id of the game
         * @param  {string} newLocale the new locale of the game installation
         * @static
         * @method updateInstalledLocale
         */
        updateNOGGameTitle: function(prodId, gameTitle) {
            return clientGameWrapper.sendToOriginClient('onRemoteGameAction', [prodId, 'updateNOGGameTitle', {gameTitle: gameTitle}]);
        },

        /**
         * show dialog to bring up product code redemption
         * @static
         * @method redeemProductCode
         */
        redeemProductCode: function() {
            return clientGameWrapper.sendToOriginClient('redeemProductCode', arguments);
        },

        /**
         * bring up file folder navigation to select non-origin game to add
         * @static
         * @method addNonOriginGame
         */
        addNonOriginGame: function() {
            return clientGameWrapper.sendToOriginClient('addNonOriginGame', arguments);
        }
    };
});

/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to dialogs with the C++ client
 */


define('modules/client/dialog',[
    'modules/client/clientobjectregistry',
    'core/errorhandler',
    'core/logger'
], function(clientobjectregistry, errorhandler, logger) {

    /**
     * Contains client dialog communication methods
     * @module module:dialog
     * @memberof module:Origin.module:client
     *
     */

    var clientDialogWrapper = null,
        clientObjectName = 'OriginDialogs';

    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientDialogWrapper = clientObjectWrapper;
        if(clientDialogWrapper.clientObject){
            clientDialogWrapper.connectClientSignalToJSSDKEvent('dialogOpen', 'CLIENT_DIALOGOPEN');
            clientDialogWrapper.connectClientSignalToJSSDKEvent('dialogClosed', 'CLIENT_DIALOGCLOSED');
            clientDialogWrapper.connectClientSignalToJSSDKEvent('dialogChanged', 'CLIENT_DIALOGCHANGED');
        }
    }

    clientobjectregistry.registerClientObject(clientObjectName)
        .then(executeWhenClientObjectInitialized)
        .catch(errorhandler.logErrorMessage);



    return /** @lends module:Origin.module:client.module:dialog */ {

        /**
         * show Object
         * @typedef showObject
         * @type {object}
         * @property {string} context Where is this dialog coming from?
         */

        /**
         * show first dialog in queue
         * @param  {module:Origin.module:client.module:dialog~showObject} showObject object to be passed to client
         */
        show: function(retObj) {
            return clientDialogWrapper.sendToOriginClient('show', arguments)
                .catch(logger.log);
        },

        /**
         * finished Object
         * @typedef finishedObject
         * @type {object}
         * @property {string} id a unique id for the dialog
         * @property {boolean} accepted was the dialog accepted
         * @property {object} content info C++ needs
         */

        /**
         * closes dialog in queue with match id. Passes info to client.
         * @param  {module:Origin.module:client.module:dialog~finishedObject} finishedObject object to be passed to client
         */
        finished: function(retObj) {
            return clientDialogWrapper.sendToOriginClient('finished', arguments)
                .catch(logger.log);
        },

        /**
         * showingDialog Object
         * @typedef showingDialogObject
         * @type {object}
         * @property {string} id a unique id for the dialog
         */

        /**
         * Tells C++ queue that a dialog from the javascript is showing. Since dialogs
         * don't solely come from C++.
         * @param  {module:Origin.module:client.module:dialog~showingDialogObject} showingDialogObject object to be passed to client
         */
        showingDialog: function(retObj) {
            return clientDialogWrapper.sendToOriginClient('showingDialog', arguments)
                .catch(logger.log);

        },

        /**
         * linkReact Object
         * @typedef linkReactObject
         * @type {object}
         * @property {string} href The link that the client needs to react to. Think of it as an id.
         */
        /**
         * Tells C++ that a link was just clicked inside of the dialog. The C++ needs to handle it.
         * @param  {module:Origin.module:client.module:dialog~linkReactObject} linkReactObject object to be passed to client
         */
        linkReact: function(retObj) {
            return clientDialogWrapper.sendToOriginClient('linkReact', arguments)
                .catch(logger.log);
        }
    };
});
/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to social with the C++ client
 */


define('modules/client/social',[
    'modules/client/clientobjectregistry'
], function(clientobjectregistry) {

    /**
     * Contains client social communication methods
     * @module module:social
     * @memberof module:Origin.module:client
     *
     */

    var clientSocialWrapper = null,
        clientObjectName = 'OriginSocialManager';

    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientSocialWrapper = clientObjectWrapper;
        if (clientSocialWrapper.clientObject) {
            clientSocialWrapper.connectClientSignalToJSSDKEvent('connectionChanged', 'CLIENT_SOCIAL_CONNECTIONCHANGED');
            clientSocialWrapper.connectClientSignalToJSSDKEvent('messageReceived', 'CLIENT_SOCIAL_MESSAGERECEIVED');
            clientSocialWrapper.connectClientSignalToJSSDKEvent('chatStateReceived', 'CLIENT_SOCIAL_CHATSTATERECEIVED');
            clientSocialWrapper.connectClientSignalToJSSDKEvent('presenceChanged', 'CLIENT_SOCIAL_PRESENCECHANGED');
            clientSocialWrapper.connectClientSignalToJSSDKEvent('blockListChanged', 'CLIENT_SOCIAL_BLOCKLISTCHANGED');
            clientSocialWrapper.connectClientSignalToJSSDKEvent('rosterChanged', 'CLIENT_SOCIAL_ROSTERCHANGED');
            clientSocialWrapper.connectClientSignalToJSSDKEvent('rosterLoaded', 'CLIENT_SOCIAL_ROSTERLOADED');
            clientSocialWrapper.connectClientSignalToJSSDKEvent('gameInviteReceived', 'CLIENT_SOCIAL_GAMEINVITERECEIVED');
            clientSocialWrapper.connectClientSignalToJSSDKEvent('gameInviteFlowStarted', 'CLIENT_SOCIAL_GAMEINVITEFLOWSTARTED');
            clientSocialWrapper.connectClientSignalToJSSDKEvent('gameInviteFlowSuccess', 'CLIENT_SOCIAL_GAMEINVITEFLOWSUCCESS');
            clientSocialWrapper.connectClientSignalToJSSDKEvent('gameInviteFlowFailed', 'CLIENT_SOCIAL_GAMEINVITEFLOWFAILED');
            clientSocialWrapper.connectClientSignalToJSSDKEvent('leavingParty', 'CLIENT_SOCIAL_LEAVINGPARTY');
        }
    }

    clientobjectregistry.registerClientObject(clientObjectName).then(executeWhenClientObjectInitialized);

    return /** @lends module:Origin.module:client.module:social */ {

        /**
         * is the social connection established
         * @returns {promise} returns a promise the resolves a boolean (true if connected/ false if not)
         * @static
         * @method
         */
        isConnectionEstablished: function() {
            return clientSocialWrapper.sendToOriginClient('isConnectionEstablished');
        },
        /**
         * is the roster loaded
         * @returns {promise} returns a promise the resolves a boolean (true if roster is loaded/ false if not)
         * @static
         * @method
         */
        isRosterLoaded: function() {
            return clientSocialWrapper.sendToOriginClient('isRosterLoaded');
        },
        /**
         * returns the current roster
         * @returns {promise} returns the current client roster
         * @static
         * @method
         */
        roster: function() {
            return clientSocialWrapper.sendToOriginClient('roster');
        },
        /**
         * send a chat message
         * @param  {string} id      [description]
         * @param  {string} msgBody [description]
         * @param  {string} type    [description]
         * @return {promise}         [description]
         */
        sendMessage: function(id, msgBody, type) {
            return clientSocialWrapper.sendToOriginClient('sendMessage', arguments);
        },
        /**
         * [setTypingState description]
         * @param {promise} state  [description]
         * @param {promise} userId [description]
         */
        setTypingState: function(state, userId) {
            return clientSocialWrapper.sendToOriginClient('setTypingState', arguments);
        },
        /**
         * [approveSubscriptionRequest description]
         * @param  {string} jid [description]
         * @return {promise}     [description]
         */
        approveSubscriptionRequest: function(jid) {
            return clientSocialWrapper.sendToOriginClient('approveSubscriptionRequest', arguments);
        },
        /**
         * [denySubscriptionRequest description]
         * @param  {string} jid [description]
         * @return {promise}     [description]
         */
        denySubscriptionRequest: function(jid) {
            return clientSocialWrapper.sendToOriginClient('denySubscriptionRequest', arguments);
        },
        /**
         * [subscriptionRequest description]
         * @param  {string} jid [description]
         * @return {promise}     [description]
         */
        subscriptionRequest: function (jid) {
            return clientSocialWrapper.sendToOriginClient('subscriptionRequest', arguments);
        },
        /**
         * [cancelSubscriptionRequest description]
         * @param  {string} jid [description]
         * @return {promise}     [description]
         */
        cancelSubscriptionRequest: function(jid) {
            return clientSocialWrapper.sendToOriginClient('cancelSubscriptionRequest', arguments);
        },
        /**
         * [removeFriend description]
         * @param  {string} jid [description]
         * @return {promise}     [description]
         */
        removeFriend: function(jid) {
            return clientSocialWrapper.sendToOriginClient('removeFriend', arguments);
        },
        /**
         * [setInitialPresence description]
         * @param {promise} presence [description]
         */
        setInitialPresence: function(presence) {
            return clientSocialWrapper.sendToOriginClient('setInitialPresence', arguments);
        },
        /**
         * [requestInitialPresenceForUserAndFriends description]
         * @return {promise} [description]
         */
        requestInitialPresenceForUserAndFriends: function() {
            return clientSocialWrapper.sendToOriginClient('requestInitialPresenceForUserAndFriends');
        },
        /**
         * [requestPresenceChange description]
         * @param  {string} presence [description]
         * @return {promise}          [description]
         */
        requestPresenceChange: function(presence) {
            return clientSocialWrapper.sendToOriginClient('requestPresenceChange', arguments);
        },
        /**
         * [joinRoom description]
         * @param  {string} jid      [description]
         * @param  {string} originId [description]
         * @return {promise}          [description]
         */
        joinRoom: function(jid, originId) {
            return clientSocialWrapper.sendToOriginClient('joinRoom', arguments);
        },
        /**
         * [leaveRoom description]
         * @param  {string} jid      [description]
         * @param  {string} originId [description]
         * @return {promise}          [description]
         */
        leaveRoom: function(jid, originId) {
            return clientSocialWrapper.sendToOriginClient('leaveRoom', arguments);
        },
        /**
         * [blockUser description]
         * @param  {string} jid [description]
         * @return {promise}     [description]
         */
        blockUser: function(jid) {
            return clientSocialWrapper.sendToOriginClient('blockUser', arguments);
        },
        /**
         * [unblockUser description]
         * @param  {string} jid [description]
         * @return {promise}     [description]
         */
        unblockUser: function (jid) {
            return clientSocialWrapper.sendToOriginClient('unblockUser', arguments);
        },
        /**
         * [joinGame description]
         * @param  {string} jid [description]
         * @return {promise}     [description]
         */
        joinGame: function (jid) {
            return clientSocialWrapper.sendToOriginClient('joinGame', arguments);
        },
        /**
         * [inviteToGame description]
         * @param  {string} jid [description]
         * @return {promise}     [description]
         */
        inviteToGame: function (jid) {
            return clientSocialWrapper.sendToOriginClient('inviteToGame', arguments);
        },
        /**
         * [isBlocked description]
         * @param  {string} jid [description]
         * @return {promise}     [description]
         */
        isBlocked: function (jid) {
            return clientSocialWrapper.sendToOriginClient('isBlocked', arguments);
        },
        /**
         * getUserPartyGuid
         * @returns {promise} returns a promise the resolves a string that contains the guid of the party the user is in or "" if none
         * @static
         * @method
         */
        getUserPartyGuid: function () {
            return clientSocialWrapper.sendToOriginClient('getUserPartyGuid');
        },
        /**
         * Show chat toast
         * @param  {string} id JabberId for the user that sent the msg
         * @param  {string} msgBody message text
         * @return {promise}     [description]
         */
        showChatToast: function () {
            return clientSocialWrapper.sendToOriginClient('showChatToast', arguments);
        }

};
});

/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to social ui with the C++ client
 */


define('modules/client/socialui',[
    'modules/client/clientobjectregistry'
], function(clientobjectregistry) {

    /**
     * Contains client socialui communication methods
     * @module module:socialui
     * @memberof module:Origin.module:client
     *
     */

    var clientSocialUIWrapper = null,
        clientObjectName = 'OriginSocialUIManager';

    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientSocialUIWrapper = clientObjectWrapper;
        if (clientSocialUIWrapper.clientObject) {
            clientSocialUIWrapper.connectClientSignalToJSSDKEvent('showChatWindowForFriend', 'CLIENT_SOCIAL_SHOWCHATWINDOWFORFRIEND');
            clientSocialUIWrapper.connectClientSignalToJSSDKEvent('focusOnFriendsList', 'CLIENT_SOCIAL_FOCUSONFRIENDSLIST');
            clientSocialUIWrapper.connectClientSignalToJSSDKEvent('focusOnActiveChatWindow', 'CLIENT_SOCIAL_FOCUSONACTIVECHATWINDOW');
        }
    }

    clientobjectregistry.registerClientObject(clientObjectName).then(executeWhenClientObjectInitialized);

    return /** @lends module:Origin.module:client.module:socialui */ {
    };
});

/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to settings with the C++ client
 */


define('modules/client/settings',[
    'modules/client/clientobjectregistry',
    'modules/client/communication'
], function(clientobjectregistry,communication) {

    /**
     * Contains client settings communication methods
     * @module module:settings
     * @memberof module:Origin.module:client
     *
     */
    var clientSettingsWrapper = null,
        clientObjectName = 'OriginClientSettings',
        isEmbeddedBrowser = communication.isEmbeddedBrowser;

    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientSettingsWrapper = clientObjectWrapper;
        if (clientSettingsWrapper.clientObject) {
            clientSettingsWrapper.connectClientSignalToJSSDKEvent('updateSettings', 'CLIENT_SETTINGS_UPDATESETTINGS');
            clientSettingsWrapper.connectClientSignalToJSSDKEvent('returnFromSettingsDialog', 'CLIENT_SETTINGS_RETURN_FROM_DIALOG');
            clientSettingsWrapper.connectClientSignalToJSSDKEvent('settingsError', 'CLIENT_SETTINGS_ERROR');
        }
    }

    clientobjectregistry.registerClientObject(clientObjectName).then(executeWhenClientObjectInitialized);

    return /** @lends module:Origin.module:client.module:settings */ {
        /**
         * writes a setting in the client
         * @param {string} settingName the name of the setting
         * @param {string} payload the payload to write for the setting
         * @static
         * @method
         */
        writeSetting: function(settingName, payload) {
            return clientSettingsWrapper.sendToOriginClient('writeSetting', arguments);
        },

        /**
         * reads a setting from the client
         * @param {string} settingName the name of the setting
         * @static
         * @method
         */
        readSetting: function(settingName) {
            return clientSettingsWrapper.sendToOriginClient('readSetting', arguments);
        },
        /**
         * returns the client supported languages
         * @returns {languageObject} returnValue the client supported languages
         * @static
         * @method
         */
        supportedLanguagesData: function() {
            return clientSettingsWrapper.propertyFromOriginClient('supportedLanguagesData');
        },
        /**
         * returns whether the Origin Developer Tool is available
         * @returns {languageObject} returnValue if odt is available
         * @static
         * @method
         */
        developerToolAvailable: function() {
            if (!isEmbeddedBrowser()) {
                return false;
            } else {
                return clientSettingsWrapper.propertyFromOriginClient('developerToolAvailable');                
            }
        },
        /**
         * [startLocalHostResponder description]
         * @return {promise} retName TBD
         */
        startLocalHostResponder: function() {
            return clientSettingsWrapper.sendToOriginClient('startLocalHostResponder');
        },
        /**
         * [stopLocalHostResponder description]
         * @return {promise} retName TBD
         */
        stopLocalHostResponder: function() {
            return clientSettingsWrapper.sendToOriginClient('stopLocalHostResponder');
        },
        /**
         * [startLocalHostResponderFromOptOut description]
         * @return {promise} retName TBD
         */
        startLocalHostResponderFromOptOut: function() {
            return clientSettingsWrapper.sendToOriginClient('startLocalHostResponderFromOptOut');
        },
        /**
         * returns the setting that was swapped when a hotkey conflict occurred
         * @returns {object} returnValue the setting that was swapped and hot key string
         * @static
         * @method
         */
        hotkeyConflictSwap: function() {
            return clientSettingsWrapper.sendToOriginClient('hotkeyConflictSwap', arguments);
        },
        /**
         * tell the client to set the hotkey input state to either true or false
         * @param {bool} hasFocus the focus state of the hotkey
         */
        hotkeyInputHasFocus: function(hasFocus) {
            return clientSettingsWrapper.sendToOriginClient('hotkeyInputHasFocus', arguments);
        },
        /**
         * tell the client to set the window pinning hotkey input state to either true or false
         * @param {bool} hasFocus the focus state of the window pinning hotkey
         */
        pinHotkeyInputHasFocus: function(hasFocus) {
            return clientSettingsWrapper.sendToOriginClient('pinHotkeyInputHasFocus', arguments);
        },
        /**
         * tell the client to set the Push-To-Talk hotkey input state to either true or false
         * @param {bool} hasFocus the focus state of the Push-To-Talk hotkey
         */
        pushToTalkHotkeyInputHasFocus: function(hasFocus) {
            return clientSettingsWrapper.sendToOriginClient('pushToTalkHotKeyInputHasFocus', arguments);
        },
        /**
         * tell the client to set the Push-To-Talk hotkey to a mouse button
         * 0 = left, 1 = middle, 2 = right, 3 = browser back, 4 = browser forward
         * @param {int} button the mouse button that was clicked
         */
        handlePushToTalkMouseInput: function(button) {
            return clientSettingsWrapper.sendToOriginClient('handlePushToTalkMouseInput', arguments);
        },
        /**
         * tell the client whether SPA is considered offline capable based on whether all the files listed in index.html have been loaded or not
         * @param {bool} capable can load SPA in offline mode
         */
        setSPAofflineCapable: function(capable) {
            return clientSettingsWrapper.sendToOriginClient('setSPAofflineCapable', arguments);
        }
    };
});

/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to user with the C++ client
 */


define('modules/client/user',[
    'modules/client/clientobjectregistry'
], function(clientobjectregistry) {

    /**
     * Contains client user communication methods
     * @module module:user
     * @memberof module:Origin.module:client
     *
     */

    var clientUserWrapper = null,
        clientObjectName = 'OriginUser';

    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientUserWrapper = clientObjectWrapper;
        if(clientUserWrapper.clientObject){
            clientUserWrapper.connectClientSignalToJSSDKEvent('sidRenewalResponseProxy', 'CLIENT_SIDRENEWAL');
        }
    }

    clientobjectregistry.registerClientObject(clientObjectName).then(executeWhenClientObjectInitialized);

    return /** @lends module:Origin.module:client.module:user */ {
        /**
         * [requestLogout description]
         * @return {promise} [description]
         */
        requestLogout: function() {
            return clientUserWrapper.sendToOriginClient('requestLogout');
        },
        /**
         * [requestRestart description]
         * @return {promise} [description]
         */
        requestRestart: function() {
            return clientUserWrapper.sendToOriginClient('requestRestart');
        },
        /**
         * [offlineUserInfo description]
         * @return {promise} [description]
         */
        offlineUserInfo: function() {
            return clientUserWrapper.sendToOriginClient('offlineUserInfo');
        },
        /**
         * request client to refresh sid cookie value
         * @return {promise} resolves when the sid refresh request is made
         */
        requestSidRefresh: function() {
            return clientUserWrapper.sendToOriginClient('requestSidRefresh');
        },
        /**
         * [canLogout description]
         * @return {promise} returns the results of the client function LogoutExitFlow::canLogout()
         */
        canLogout: function() {
            if(Origin.client.isEmbeddedBrowser()) {
                return clientUserWrapper.sendToOriginClient('canLogout');
            } else {
                //Default - We have code on the C++ to catch and prevent this if we can't actually log out. 
                //Defaulting to true prevents the edge case of the SPA being incorrectly unable to logout.
                return Promise.resolve(true);
            }
        }
    };
});
/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to desktopservices with the C++ client
 */


define('modules/client/desktopservices',[
    'modules/client/clientobjectregistry',
    'core/errorhandler'
], function(clientobjectregistry, errorhandler) {

    /**
     * Contains client desktopServices communication methods
     * @module module:desktopServices
     * @memberof module:Origin.module:client
     *
     */
    
    var clientDesktopServicesWrapper = null,
        clientObjectName = 'DesktopServices';

    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientDesktopServicesWrapper = clientObjectWrapper;
        if(clientDesktopServicesWrapper.clientObject){
            clientDesktopServicesWrapper.connectClientSignalToJSSDKEvent('dockIconClicked', 'CLIENT_DESKTOP_DOCKICONCLICKED');
            clientDesktopServicesWrapper.connectClientSignalToJSSDKEvent('appVisibilityChanged', 'CLIENT_VISIBILITY_CHANGED');
        }
    }

    clientobjectregistry.registerClientObject(clientObjectName)
        .then(executeWhenClientObjectInitialized)
        .catch(errorhandler.logErrorMessage);
    
    return /** @lends module:Origin.module:client.module:desktopServices */ {
        /**
         * opens a url in a external browser
         * @static
         * @method
         */
        asyncOpenUrl: function(url) {
            return clientDesktopServicesWrapper.sendToOriginClient('asyncOpenUrl', arguments);
        },

        /**
         * flashes the dock icon (Windows) or badges the dock icon with unread message count (Mac)
         * @static
         * @method
         */
        flashIcon: function(int) {
            return clientDesktopServicesWrapper.sendToOriginClient('flashIcon', arguments);
        },

        /**
         * sets the next UUID to be used by a created js window
         * @static
         * @method
         */
        setNextWindowUUID: function(uuid) {
            return clientDesktopServicesWrapper.sendToOriginClient('setNextWindowUUID', arguments);
        },

       
        /**
         * miniaturizes the window associated with the given uuid to the dock
         * @static
         * @method
         */
        miniaturize: function(uuid) {
            return clientDesktopServicesWrapper.sendToOriginClient('miniaturize', arguments);
        },

        /**
         * deminiaturizes the window associated with the given uuid to the dock
         * @static
         * @method
         */
        deminiaturize: function(uuid) {
            return clientDesktopServicesWrapper.sendToOriginClient('deminiaturize', arguments);
        },

        /**
         * enquires whether the window associated with the given uuid is miniaturized
         * @static
         * @method
         */
        isMiniaturized: function(uuid) {
            return clientDesktopServicesWrapper.sendToOriginClient('isMiniaturized', arguments);
        },

        /**
         * unminized if minimized and show if hidden
         * @static
         * @method
         */
        showWindow: function(uuid) {
            return clientDesktopServicesWrapper.sendToOriginClient('showWindow', arguments);
        },

        /**
         * moves the window associated with the given UUID to the front
         * @static
         * @method
         */
        moveWindowToForeground: function(uuid) {
            return clientDesktopServicesWrapper.sendToOriginClient('moveWindowToForeground', arguments);
        },

        /**
         * opens a url in a external browser with EADP SSO
         * @static
         * @method
         */        
        asyncOpenUrlWithEADPSSO: function(url) {
            return clientDesktopServicesWrapper.sendToOriginClient('launchExternalBrowserWithEADPSSO', arguments);
        }
    };
});

/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to voice with the C++ client
 */


define('modules/client/voice',[
    'modules/client/clientobjectregistry'
], function(clientobjectregistry) {

    /**
     * Contains client voice communication methods
     * @module module:voice
     * @memberof module:Origin.module:client
     *
     */

    var clientVoiceWrapper = null,
        clientObjectName = 'OriginVoice';

    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientVoiceWrapper = clientObjectWrapper;
        if (clientVoiceWrapper.clientObject && clientVoiceWrapper.propertyFromOriginClient('supported')) {
            clientVoiceWrapper.connectClientSignalToJSSDKEvent('deviceAdded', 'CLIENT_VOICE_DEVICEADDED');
            clientVoiceWrapper.connectClientSignalToJSSDKEvent('deviceRemoved', 'CLIENT_VOICE_DEVICEREMOVED');
            clientVoiceWrapper.connectClientSignalToJSSDKEvent('defaultDeviceChanged', 'CLIENT_VOICE_DEFAULTDEVICECHANGED');
            clientVoiceWrapper.connectClientSignalToJSSDKEvent('deviceChanged', 'CLIENT_VOICE_DEVICECHANGED');
            clientVoiceWrapper.connectClientSignalToJSSDKEvent('voiceLevel', 'CLIENT_VOICE_VOICELEVEL');
            clientVoiceWrapper.connectClientSignalToJSSDKEvent('underThreshold', 'CLIENT_VOICE_UNDERTHRESHOLD');
            clientVoiceWrapper.connectClientSignalToJSSDKEvent('overThreshold', 'CLIENT_VOICE_OVERTHRESHOLD');
            clientVoiceWrapper.connectClientSignalToJSSDKEvent('voiceConnected', 'CLIENT_VOICE_VOICECONNECTED');
            clientVoiceWrapper.connectClientSignalToJSSDKEvent('voiceDisconnected', 'CLIENT_VOICE_VOICEDISCONNECTED');
            clientVoiceWrapper.connectClientSignalToJSSDKEvent('enableTestMicrophone', 'CLIENT_VOICE_ENABLETESTMICROPHONE');
            clientVoiceWrapper.connectClientSignalToJSSDKEvent('disableTestMicrophone', 'CLIENT_VOICE_DISABLETESTMICROPHONE');
            clientVoiceWrapper.connectClientSignalToJSSDKEvent('clearLevelIndicator', 'CLIENT_VOICE_CLEARLEVELINDICATOR');
            clientVoiceWrapper.connectClientSignalToJSSDKEvent('voiceCallEvent', 'CLIENT_VOICE_VOICECALLEVENT');
        }
    }

    clientobjectregistry.registerClientObject(clientObjectName).then(executeWhenClientObjectInitialized);

    return /** @lends module:Origin.module:client.module:voice */ {
        /**
         * [supported description]
         * @return {promise} [description]
         */
        supported: function() {
            return clientVoiceWrapper.propertyFromOriginClient('supported');
        },
        /**
         * [isSupportedBy description]
         * @param {promise} friendNucleusId nucleus id of friend to check voice support for
         * @return {promise} [description]
         */
        isSupportedBy: function(friendNucleusId) {
            if (typeof friendNucleusId === 'undefined') {
                return false;
            }
            return clientVoiceWrapper.sendToOriginClient('isSupportedBy', arguments);
        },
        /**
         * [setInVoiceSettings description]
         * @param {promise} inVoiceSettings [description]
         */
        setInVoiceSettings: function(inVoiceSettings) {
            return clientVoiceWrapper.sendToOriginClient('setInVoiceSettings', arguments);
        },
        /**
         * [startVoiceChannel description]
         * @return {promise} [description]
         */
        startVoiceChannel: function() {
            return clientVoiceWrapper.sendToOriginClient('startVoiceChannel');
        },
        /**
         * [stopVoiceChannel description]
         * @return {promise} [description]
         */
        stopVoiceChannel: function() {
            return clientVoiceWrapper.sendToOriginClient('stopVoiceChannel');
        },
        /**
         * [testMicrophoneStart description]
         * @return {promise} [description]
         */
        testMicrophoneStart: function() {
            return clientVoiceWrapper.sendToOriginClient('testMicrophoneStart');
        },
        /**
         * [testMicrophoneStop description]
         * @return {promise} [description]
         */
        testMicrophoneStop: function() {
            return clientVoiceWrapper.sendToOriginClient('testMicrophoneStop');
        },
        /**
         * [changeInputDevice description]
         * @param  {string} device [description]
         * @return {promise}        [description]
         */
        changeInputDevice: function(device) {
            return clientVoiceWrapper.sendToOriginClient('changeInputDevice', arguments);
        },
        /**
         * [changeOutputDevice description]
         * @param  {string} device [description]
         * @return {promise}        [description]
         */
        changeOutputDevice: function(device) {
            return clientVoiceWrapper.sendToOriginClient('changeOutputDevice', arguments);
        },
        /**
         * [playIncomingRing description]
         * @return {promise} [description]
         */
        playIncomingRing: function() {
            return clientVoiceWrapper.sendToOriginClient('playIncomingRing');
        },
        /**
         * [playOutgoingRing description]
         * @return {promise} [description]
         */
        playOutgoingRing: function() {
            return clientVoiceWrapper.sendToOriginClient('playOutgoingRing');
        },
        /**
         * [stopIncomingRing description]
         * @return {promise} [description]
         */
        stopIncomingRing: function() {
            return clientVoiceWrapper.sendToOriginClient('stopIncomingRing');
        },
        /**
         * [stopOutgoingRing description]
         * @return {promise} [description]
         */
        stopOutgoingRing: function() {
            return clientVoiceWrapper.sendToOriginClient('stopOutgoingRing');
        },
        /**
         * [joinVoice description]
         * @param  {string}     id           identifier for the conversation (for 1:1, it is the nucleus id of the other participant)
         * @param  {stringList} participants the list of participants in the conversation
         * @return {promise}              [description]
         */
        joinVoice: function(id, participants) {
            return clientVoiceWrapper.sendToOriginClient('joinVoice', arguments);
        },
        /**
         * [leaveVoice description]
         # @param  {string}  id identifier for the conversation (for 1:1, it is the nucleus id of the other participant)
         * @return {promise} [description]
         */
        leaveVoice: function(id) {
            return clientVoiceWrapper.sendToOriginClient('leaveVoice', arguments);
        },
        /**
         * [muteSelf description]
         * @return {promise} [description]
         */
        muteSelf: function() {
            return clientVoiceWrapper.sendToOriginClient('muteSelf');
        },
        /**
         * [unmuteSelf description]
         * @return {promise} [description]
         */
        unmuteSelf: function() {
            return clientVoiceWrapper.sendToOriginClient('unmuteSelf');
        },
        /**
         * [showToast description]
         * @param  {string} event          [description]
         * @param  {string} originId       [description]
         * @param  {string} conversationId [description]
         * @return {promise}                [description]
         */
        showToast: function(event, originId, conversationId) {
            return clientVoiceWrapper.sendToOriginClient('showToast', arguments);
        },

        /**
         * show survey description
         * @param  {number} channelId the channel id
         * @return {void}
         */
        showSurvey: function(channelId) {
            return clientVoiceWrapper.sendToOriginClient('showSurvey', arguments);
        },        
        /**
         * [audioInputDevices description]
         * @return {promise} [description]
         */
        audioInputDevices: function() {
            return clientVoiceWrapper.sendToOriginClient('audioInputDevices');
        },
        /**
         * [audioOutputDevices description]
         * @return {promise} [description]
         */
        audioOutputDevices: function() {
            return clientVoiceWrapper.sendToOriginClient('audioOutputDevices');
        },
        /**
         * [selectedAudioInputDevice description]
         * @return {promise} [description]
         */
        selectedAudioInputDevice: function() {
            return clientVoiceWrapper.sendToOriginClient('selectedAudioInputDevice');
        },
        /**
         * [selectedAudioOutputDevice description]
         * @return {promise} [description]
         */
        selectedAudioOutputDevice: function() {
            return clientVoiceWrapper.sendToOriginClient('selectedAudioOutputDevice');
        },
        /**
         * [networkQuality description]
         * @return {promise} [description]
         */
        networkQuality: function() {
            return clientVoiceWrapper.sendToOriginClient('networkQuality');
        },
        /**
         * [isInVoice description]
         * @return {Boolean} [description]
         */
        isInVoice: function() {
            return clientVoiceWrapper.sendToOriginClient('isInVoice');
        }
    };
});
/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to OIG with the C++ client
 */


define('modules/client/oig',[
    'modules/client/clientobjectregistry',
    'core/errorhandler'
], function(clientobjectregistry, errorhandler) {

    /**
     * Contains client oig communication methods
     * @module module:oig
     * @memberof module:Origin.module:client
     *
     */


    var clientOIGWrapper = null,
        clientObjectName = 'OriginIGO';

    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientOIGWrapper = clientObjectWrapper;
        if(clientOIGWrapper.clientObject){
            clientOIGWrapper.connectClientSignalToJSSDKEvent('reportUser', 'CLIENT_GAME_REQUESTREPORTUSER');
            clientOIGWrapper.connectClientSignalToJSSDKEvent('inviteFriendsToGame', 'CLIENT_GAME_INVITEFRIENDSTOGAME');
            clientOIGWrapper.connectClientSignalToJSSDKEvent('startConversation', 'CLIENT_GAME_STARTCONVERSATION');
        }
    }

    clientobjectregistry.registerClientObject(clientObjectName)
        .then(executeWhenClientObjectInitialized)
        .catch(errorhandler.logErrorMessage);


    return /** @lends module:Origin.module:client.module:oig */ {
        /**
         * set the create window request with url
         * @param {string} requestUrl the url we want to open
         */
        setCreateWindowRequest: function(requestUrl) {
            return clientOIGWrapper.sendToOriginClient('setCreateWindowRequest', arguments);
        },

        moveWindowToFront: function() {
            return clientOIGWrapper.sendToOriginClient('moveWindowToFront', arguments);
        },

        openIGOConversation: function() {
            return clientOIGWrapper.sendToOriginClient('openIGOConversation', arguments);
        },

        closeIGOConversation: function() {
            return clientOIGWrapper.sendToOriginClient('closeIGOConversation', arguments);
        },

        openIGOProfile: function() {
            return clientOIGWrapper.sendToOriginClient('openIGOProfile', arguments);
        },

        openIGOSPA: function(location, sublocation) {
            //give some defaults to location and sublocation in cases where nothing is passed in
            //other wise the C++ call won't trigger because the signature doesn't match
            return clientOIGWrapper.sendToOriginClient('openIGOSPA', [location || 'HOME', sublocation || '']);
        },
        closeIGOSPA: function() {
            return clientOIGWrapper.sendToOriginClient('closeIGOSPA', arguments);
        },
        getNonCachedIGOActiveValue: function() {
            return clientOIGWrapper.sendToOriginClient('getNonCachedIGOActiveValue', arguments);
        },
        closeIGO: function() {
            return clientOIGWrapper.sendToOriginClient('closeIGO', arguments);
        },
        IGOIsActive: function() {
            // We can never be in the IGO context if this is not an embedded browser
            var value = false;
            if (Origin.client.isEmbeddedBrowser()) {
                value = clientOIGWrapper.propertyFromOriginClient('IGOActive');
            }
            return value;
        },

		IGOIsAvailable: function() {
            // We can never be in the IGO context if this is not an embedded browser
            var value = false;
            if (Origin.client.isEmbeddedBrowser()) {
                value = clientOIGWrapper.propertyFromOriginClient('IGOAvailable');
            }
            return value;
        },
        purchaseComplete: function() {
            return clientOIGWrapper.sendToOriginClient('purchaseComplete', arguments);
        }
    };
});

/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to install directory management with the C++ client
 */


define('modules/client/installDirectory',[
    'modules/client/clientobjectregistry'
], function(clientobjectregistry) {

    /**
     * Contains client settings communication methods
     * @module module:installDirectory
     * @memberof module:Origin.module:client
     *
     */
    var clientInstallDirectoryWrapper = null,
        clientObjectName = 'InstallDirectoryManager';

    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientInstallDirectoryWrapper = clientObjectWrapper;
    }

    clientobjectregistry.registerClientObject(clientObjectName).then(executeWhenClientObjectInitialized);

    return /** @lends module:Origin.module:client.module:installDirectory */ {

        /**
         * [chooseDownloadInPlaceLocation description]
         * @return {promise} retName TBD
         */
        chooseDownloadInPlaceLocation: function() {
            return clientInstallDirectoryWrapper.sendToOriginClient('chooseDownloadInPlaceLocation');
        },
        /**
         * [resetDownloadInPlaceLocation description]
         * @return {promise} retName TBD
         */
        resetDownloadInPlaceLocation: function() {
            return clientInstallDirectoryWrapper.sendToOriginClient('resetDownloadInPlaceLocation');
        },
        /**
         * [chooseInstallerCacheLocation description]
         * @return {promise} retName TBD
         */
        chooseInstallerCacheLocation: function() {
            return clientInstallDirectoryWrapper.sendToOriginClient('chooseInstallerCacheLocation');
        },
        /**
         * [resetInstallerCacheLocation description]
         * @return {promise} retName TBD
         */
        resetInstallerCacheLocation: function() {
            return clientInstallDirectoryWrapper.sendToOriginClient('resetInstallerCacheLocation');
        },
        /**
         * [browseInstallerCache description]
         * @return {promise} retName TBD
         */
        browseInstallerCache: function() {
            return clientInstallDirectoryWrapper.sendToOriginClient('browseInstallerCache');
        },
        /**
         * [deleteInstallers description]
         * @return {promise} retName TBD
         */
        deleteInstallers: function() {
            return clientInstallDirectoryWrapper.sendToOriginClient('deleteInstallers');
        }
    };
});
/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to OriginInfo with the C++ client
 */


define('modules/client/info',[
    'modules/client/clientobjectregistry',
    'modules/client/communication',
    'modules/client/settings'
], function(clientobjectregistry, communication, settings) {

    /**
     * Contains client origin info communication methods
     * @module module:info
     * @memberof module:Origin.module:client
     *
     */


    var clientInfoWrapper = null,
        clientObjectName = 'OriginInfo',
        isEmbeddedBrowser = communication.isEmbeddedBrowser;

    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientInfoWrapper = clientObjectWrapper;
    }

    clientobjectregistry.registerClientObject(clientObjectName)
        .then(executeWhenClientObjectInitialized);


    return /** @lends module:Origin.module:client.module:info */ {
        /**
         * Get the installed Origin client version
         * @returns {String} returns the installed Origin client version as a string
         */
        version: function() {
            return clientInfoWrapper.propertyFromOriginClient('version');
        },

        /**
         * Get the installed Origin client version
         * @returns {Number} returns the installed Origin client version as a number
         */
        versionNumber: function() {
            return clientInfoWrapper.propertyFromOriginClient('versionNumber');
        },

        /**
         * Get if the Origin client is a beta version
         * @returns {Boolean} returns if the Origin client is a beta version
         */
        isBeta: function() {
            return clientInfoWrapper.propertyFromOriginClient('isBeta');
        },

        /**
         * Check if wishlist is enabled
         * @returns {Boolean} returns if wishlist is enabled for current country
         */
        isWishlistEnabled: function() {
            return clientInfoWrapper.propertyFromOriginClient('isWishlistEnabled');
        },

        /**
         * Check if gifting is enabled
         * @returns {Boolean} returns if gifting is enabled for current country
         */
        isGiftingEnabled: function() {
            return clientInfoWrapper.propertyFromOriginClient('isGiftingEnabled');
        },

        /**
         * retrieves the current state of the update availability in the client
         * @return {promise<ClientUpdateStatusInfo>}
         * @static
         */
        requestClientUpdateStatus: function() {
            return clientInfoWrapper.sendToOriginClient('requestClientUpdateStatus', arguments);
        },
        
        /**
         * lets the client know that the product navigation is ready for events
         * @static
         */
        sendProductNavigationInitialized: function() {
            return clientInfoWrapper.sendToOriginClient('sendProductNavigationInitialized', arguments);
		},
        /**
         * Check if the client is running with a non-empty EACore.ini
         * @return {Boolean} true if the client is running with a non-empty EACore.ini
         */
        hasEACoreIni: function() {
            if (!isEmbeddedBrowser()) {
                return false;
            } else {
                return settings.readSetting('OverridesEnabled');
            }
        }
    };
});

/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to OriginPopout with the C++ client
 */


define('modules/client/popout',[
    'modules/client/clientobjectregistry'
], function(clientobjectregistry) {

    /**
     * Contains client origin popout communication methods
     * @module module:popout
     * @memberof module:Origin.module:client
     *
     */


    var clientPopoutWrapper = null,
        clientObjectName = 'OriginPopout';

    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientPopoutWrapper = clientObjectWrapper;
        if(clientPopoutWrapper.clientObject) {
            clientPopoutWrapper.connectClientSignalToJSSDKEvent('popOutClosed', 'CLIENT_POP_OUT_CLOSED');
        }
    }

    clientobjectregistry.registerClientObject(clientObjectName)
        .then(executeWhenClientObjectInitialized);


    return /** @lends module:Origin.module:client.module:popout */ {
        /**
         * Pops the window back in
         */
        popInWindow: function() {
            return clientPopoutWrapper.sendToOriginClient('popInWindow', arguments);
        }
    };
});

/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication related to navigation with the C++ client
 */


define('modules/client/navigation',[
    'modules/client/clientobjectregistry',
    'core/errorhandler'
], function(clientobjectregistry, errorhandler) {

    /**
     * Contains client navigation communication methods
     * @module module:navigation
     * @memberof module:Origin.module:client
     *
     */
    var clientObjectName = 'OriginClientRouting',
        clientNavWrapper = null;

    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        clientNavWrapper = clientObjectWrapper;
        if (clientNavWrapper.clientObject) {
            clientNavWrapper.connectClientSignalToJSSDKEvent('routeChange', 'CLIENT_NAV_ROUTECHANGE');
            clientNavWrapper.connectClientSignalToJSSDKEvent('navigateToStoreByProductId', 'CLIENT_NAV_STOREBYPRODUCTID');
            clientNavWrapper.connectClientSignalToJSSDKEvent('navigateToStoreByMasterTitleId', 'CLIENT_NAV_STOREBYMASTERTITLEID');
            clientNavWrapper.connectClientSignalToJSSDKEvent('openModalFindFriends', 'CLIENT_NAV_OPENMODAL_FINDFRIENDS');
            clientNavWrapper.connectClientSignalToJSSDKEvent('openDownloadQueue', 'CLIENT_NAV_OPEN_DOWNLOADQUEUE');
            clientNavWrapper.connectClientSignalToJSSDKEvent('focusOnSearch', 'CLIENT_NAV_FOCUSONSEARCH');
            clientNavWrapper.connectClientSignalToJSSDKEvent('showPendingUpdateSitestripe', 'CLIENT_NAV_SHOW_PENDING_UPDATE_STRIPE');
            clientNavWrapper.connectClientSignalToJSSDKEvent('showPendingUpdateCountdownSitestripe', 'CLIENT_NAV_SHOW_PENDING_UPDATE_COUNTDOWN_STRIPE');
            clientNavWrapper.connectClientSignalToJSSDKEvent('showPendingUpdateKickedOfflineSitestripe', 'CLIENT_NAV_SHOW_PENDING_UPDATE_KICKED_OFFLINE_STRIPE');
            clientNavWrapper.connectClientSignalToJSSDKEvent('openGameDetails', 'CLIENT_NAV_OPEN_GAME_DETAILS');
            clientNavWrapper.connectClientSignalToJSSDKEvent('renewSubscription', 'CLIENT_NAV_RENEW_SUBSCRIPTION');
            clientNavWrapper.connectClientSignalToJSSDKEvent('redrawVideoPlayer', 'CLIENT_NAV_REDRAW_VIDEO_PLAYER');            
        }
    }

    clientobjectregistry.registerClientObject(clientObjectName)
        .then(executeWhenClientObjectInitialized)
        .catch(errorhandler.logErrorMessage);

    return /** @lends module:Origin.module:client.module:client */ {
        showOriginHelp: function() {
            return clientNavWrapper.sendToOriginClient('showOriginHelp', arguments);
        }
    };

});

/*jshint strict: false */
/**
 * this module handles all the communication related to dirtybits with the C++ client
 */
define('modules/client/dirtybits',[
    'modules/client/clientobjectregistry',
    'core/errorhandler',
    'core/events',
    'core/logger',
    'core/dirtybits'
], function(clientobjectregistry, errorhandler, events, logger, dirtybits) {

    /**
     * Contains connection to dirtybits on client
     * @module module:dirtybits
     * @memberof module:Origin.module:client
     *
     */
    var clientObjectName = 'OriginDirtyBits',
        logPrefix = '[DIRTYBITS-CLIENT]',
        signalName = 'dirtyBitEvent';

    function onMessage(info) {
        var jssdkEvent = dirtybits.contextToJSSDKEventMap[info.ctx];
        if (jssdkEvent) {
            //here we intercept the signal from the C++ and wait till the next event loop
            //before relaying the signal
            //
            //We've seen strange we behavior with out of focus client and promises that are called as a part
            //of the callstack from a C++ signal. Promises seem to hang until the user clicks focus again
            //
            //Putting the signal on the next event loop fixes this
            setTimeout(function() {
                events.fire(jssdkEvent, info.data);
                logger.log(logPrefix, '[UPDATE]:', jssdkEvent, ':', info);
            }, 0);
        }
    }

    function executeWhenClientObjectInitialized(clientObjectWrapper) {
        var clientSettingsWrapper = clientObjectWrapper;
        clientSettingsWrapper.clientObject[signalName].connect(onMessage);
    }

    clientobjectregistry.registerClientObject(clientObjectName)
        .then(executeWhenClientObjectInitialized)
        .catch(errorhandler.logErrorMessage);
});

/*jshint unused: false */
/*jshint undef:false */
/*jshint strict: false */

/**
 * this module handles all the communication with the C++ client
 */
define('modules/client/client',[
    'core/events',
    'modules/client/communication',
    'modules/client/contentOperationQueue',
    'modules/client/games',
    'modules/client/dialog',
    'modules/client/social',
    'modules/client/socialui',
    'modules/client/onlinestatus',
    'modules/client/settings',
    'modules/client/user',
    'modules/client/desktopservices',
    'modules/client/voice',
    'modules/client/oig',
    'modules/client/installDirectory',
    'modules/client/info',
    'modules/client/popout',
    /** These modules don't need to be exposed but they need to be included somewhere so requirejs loads them.
        They simply wait for the client object to become available and hook up events if it is**/
    'modules/client/navigation',
    'modules/client/dirtybits'
], function(events, communication, clientContentOperationQueue, clientGames, clientDialogs, clientSocial, clientSocialUI, clientOnlineStatus, 
    clientSettings, clientUser, clientDesktopServices, clientVoice, clientOIG, clientInstallDirectory, clientInfo, clientPopout, clientNav /* navigation, dirtybits */) {

    return /** @lends module:Origin.module:client */ {
        games: clientGames,

        dialogs: clientDialogs,

        social: clientSocial,

        socialui: clientSocialUI,

        onlineStatus: clientOnlineStatus,

        settings: clientSettings,

        user: clientUser,

        desktopServices: clientDesktopServices,

        voice: clientVoice,

        oig: clientOIG,

        navigation: clientNav,

        contentOperationQueue: clientContentOperationQueue,

        installDirectory: clientInstallDirectory,

        info: clientInfo,

        popout: clientPopout,

        isEmbeddedBrowser: communication.isEmbeddedBrowser
    };
});
/*jshint strict: false */
/*jshint unused: false */
define('core/auth',[
    'core/events',
    'core/utils',
    'core/logger',
    'core/urls',
    'core/dataManager',
    'core/errorhandler',
    'core/user',
    'core/defines',
    'core/dirtybits',
    'modules/client/client'
], function(events, utils, logger, urls, dataManager, errorhandler, user, defines, dirtybits, client) {
    /**
     * Contains authentication related methods
     * @module module:auth
     * @memberof module:Origin
     */
    var VALUE_CLEARED = '',
        REST_ERROR_SUCCESS = 0;


    function triggerEventAuthSuccess(loginType) {
        logger.log('triggered AuthSuccess', loginType);

        if (!loginType || loginType === defines.login.APP_INITIAL_LOGIN) {
            events.fire(events.AUTH_SUCCESS_LOGIN);
        } else if (loginType === defines.login.AUTH_INVALID) {
            events.fire(events.priv.AUTH_SUCCESS_POST_AUTHINVALID);
        } else if (loginType === defines.login.POST_OFFLINE) {
            events.fire(events.AUTH_SUCCESS_POST_OFFLINE);
        } else if (loginType === defines.login.APP_RETRY_LOGIN) {
            events.fire(events.AUTH_SUCCESS_RETRY);
        } else {
            //fallback
            events.fire(events.AUTH_SUCCESS_LOGIN);
        }
    }

    function triggerEventAuthFailed(loginType) {
        logger.log('triggered AuthFailed', loginType);

        //notify the APP that APP relogin is needeed
        events.fire(events.AUTH_FAILED_CREDENTIAL);

        //also notify specific type of failure
        if (loginType) {
            if (loginType === defines.login.AUTH_INVALID) {
                events.fire(events.priv.AUTH_FAILED_POST_AUTHINVALID); //this is to notify dataManager that refresh failed
            } else if (loginType === defines.login.POST_OFFLINE) {
                events.fire(events.AUTH_FAILED_POST_OFFLINE);
            } else if (loginType === defines.login.APP_RETRY_LOGIN) {
                events.fire(events.AUTH_FAILED_RETRY);
            }
        }
    }

    function triggerEventAuthLoggedOut() {
        events.fire(events.AUTH_LOGGEDOUT);
    }

    function triggerEventAuthUserPidRetrieved() {
        events.fire(events.AUTH_USERPIDRETRIEVED);
    }

    function setUserInfo(response) {
        if (utils.isChainDefined(response, ['personas', 'persona', 0, 'personaId'])) {
            //this assumes that we retrieve the information from the first persona we find
            user.setPersonaId(response.personas.persona[0].personaId);
            logger.log('personaId:', user.publicObjs.personaId());

            if (utils.isChainDefined(response, ['personas', 'persona', 0, 'displayName'])) {
                user.setOriginId(response.personas.persona[0].displayName);
                logger.log('originId:', user.publicObjs.originId());
            } else {
                logger.warn('part of originId not defined');
                user.clearOriginId();
            }

            if (utils.isChainDefined(response, ['personas', 'persona', 0, 'status'])) {
                user.setUserStatus(response.personas.persona[0].status);
                logger.log('userStatus:', user.publicObjs.userStatus());
            } else {
                logger.warn('part of originId not defined');
                user.clearUserStatus();
            }

            if (utils.isChainDefined(response, ['personas', 'persona', 0, 'showPersona'])) {
                user.setShowPersona(response.personas.persona[0].showPersona);
                logger.log('showPersona:', user.publicObjs.showPersona());
            } else {
                logger.warn('showPersona not defined');
                user.clearShowPersona();
            }
        } else {
            logger.warn('part of persona not defined');
            user.clearPersonaId();
        }
    }

    function processLoginError(msg) {
        user.clearAccessToken();
        user.clearAccessTokenExpireDate();
        return errorhandler.promiseReject(msg);
    }

    function processLoginResponse(data) {
        /* jshint camelcase: false */
        if (data) {
            if (data.access_token) {
                logger.log('aT: ' + data.access_token);
                user.setAccessToken(data.access_token);
                user.setAccessTokenExpireDate(Date.now() + (Number(data.expires_in) * 1000 * 5 / 6) ); //we want to set the expiration a early (5/6 of the expiration time)
                return data.access_token;
            } else if (data.error) {
                var msg = '';
                if (data.error === 'login_required') {
                    //need to emit signal to integrator that login is needed
                    msg = 'login error: login_required';
                } else {
                    msg = 'login error: ' + data.error;
                }

                return processLoginError(msg);
            } else {
                return processLoginError('login error: unknown data received:' + data);


            }
        } else {
            //need to emit signal to integrator to RE-LOGIN
            // no user has logged in
            return processLoginError('login error: response is empty');
        }
        /* jshint camelcase: true */
    }

    function onClientOnlineStateChanged(online) {
        logger.log('jssdK: onClientOnlineStateChanged:', online);
        //if going online, then need to trigger logging into jssdk
        if (online && user.publicObjs.accessToken() === VALUE_CLEARED) {
            //if we aren't already logged in, then...
            login(defines.login.POST_OFFLINE);
        } else {
            user.clearAccessToken();
            user.clearAccessTokenExpireDate();
            dirtybits.disconnect();
        }
    }


    function retrieveUserPersonaFromServer() {
        var endPoint = urls.endPoints.userPersona;
        var auth = 'Bearer ' + user.publicObjs.accessToken();
        var config = {
            atype: 'GET',
            headers: [{
                'label': 'Accept',
                'val': 'application/json'
            }],
            parameters: [{
                'label': 'userId',
                'val': user.publicObjs.userPid()
            }],
            reqauth: false, //set these to false so that dataREST doesn't automatically trigger a relogin
            requser: false
        };

        //in the offline case we don't want anything extra in the header, otherwise, it will force an OPTIONS call which will fail if offline
        dataManager.addHeader(config, 'Authorization', auth);
        dataManager.addHeader(config, 'X-Expand-Results', true);

        return dataManager.dataREST(endPoint, config);
    }

    function processUserPersonaResponse(loginType) {
        return function(response) {
            setUserInfo(response);

            //should it be ok that personaId and/or originId would be empty?
            triggerEventAuthSuccess(loginType);
        };
    }

    function retrieveUserPidFromServer() {
        var endPoint = urls.endPoints.userPID;
        var auth = 'Bearer ' + user.publicObjs.accessToken();
        var config = {
            atype: 'GET',
            headers: [],
            parameters: [],
            reqauth: false, //set these to false so that dataREST doesn't automatically trigger a relogin
            requser: false
        };

        dataManager.addHeader(config, 'Authorization', auth);
        dataManager.addHeader(config, 'X-Include-UnderAge', true);
        dataManager.addHeader(config, 'X-Extended-Pids', true);

        return dataManager.dataREST(endPoint, config);
    }

    function processUserHelper(response, param, callback) {
        if (utils.isChainDefined(response, ['pid', param])) {
            callback(response.pid[param]);
        } else {
            logger.warn('user '+param+' not defined');
        }
    }

    function processUserPidResponse(response) {
        if (utils.isChainDefined(response, ['pid', 'pidId'])) {

            user.setUnderAge(JSON.parse(response.pid.underagePid) || JSON.parse(response.pid.anonymousPid));

            logger.log('userPid:', response.pid.pidId);
            user.setUserPid(response.pid.pidId);

            processUserHelper(response, 'dob', user.setDob);
            processUserHelper(response, 'email', user.setUserEmail);
            processUserHelper(response, 'emailStatus', user.setUserEmailVerifyStatus);
            processUserHelper(response, 'globalOptin', user.setUserGlobalEmailStatus);
            processUserHelper(response, 'tfaEnabled', user.setTFAStatus);
            processUserHelper(response, 'dateCreated', user.setRegistrationDate);

            triggerEventAuthUserPidRetrieved();
        } else {
            return errorhandler.promiseReject('part of userPid not defined');
        }
    }

    function logoutEmbedded() {
        if (client.isEmbeddedBrowser()) {
            client.user.requestLogout();
        }
    }

    function authFailed(loginType) {
        return function() {
            user.clearOriginId();
            user.clearPersonaId();
            user.clearUserPid();
            user.clearShowPersona();
            user.clearUserStatus();
            //we don't want to call this if this flow was part of the initial login
            //in that case, the promise should just fail
            //we don't want to initiate a relogin
            if (loginType) {
                triggerEventAuthFailed(loginType);
            }
        };
    }

    function getPersonaInfo(loginType) {
        return retrieveUserPersonaFromServer()
            .then(processUserPersonaResponse(loginType));
    }

    function retrieveAppSettingsFromServer() {
        var endPoint = urls.endPoints.appSettings,
            config = {
                atype: 'GET',
                headers: [],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }],
                reqauth: false, //set these to false so that dataREST doesn't automatically trigger a relogin
                requser: false
            };

        //in the offline case we don't want anything extra in the header, otherwise, it will force an OPTIONS call which will fail if offline
        dataManager.addHeader(config, 'AuthToken', user.publicObjs.accessToken());

        return dataManager.dataREST(endPoint, config);
    }

    function handleAppSettingsError(error) {
        //we don't want to block login even if this gets an error so resolve
        return;
    }

    // need to retrieve AppSettings not necessarily because we need the info, but it triggers populating the friends DB
    function getAppSettings() {
        return retrieveAppSettingsFromServer()
            .catch(handleAppSettingsError);
    }

    //connect to dirtybits only if not in embedded
    //If in embedded dirtybits is connected to the client connection and is not handled by auth
    //returns a promise
    function connectDirtyBits() {
        if (client.isEmbeddedBrowser()) {
            //Embedded browser connects to client, is not dependent on auth
            return Promise.resolve();
        } else {
            return dirtybits.connect();
        }
    }

    function getPersonaAppSettingsAndConnectDirtyBits(loginType) {
        return function() {
            //run these three in parallel for performance since there is no dependencies
            return Promise.all([getPersonaInfo(loginType), connectDirtyBits(), getAppSettings()]);
        };
    }

    /**
     * login the user to the Origin JSSDK
     * @method
     */
    function login(loginType) {

        //if offline, retrieve user information across the bridge
        if (client.isEmbeddedBrowser() && !client.onlineStatus.isOnline()) {
            return client.user.offlineUserInfo()
                .then(function(userInfo) {

                    user.setUserPid(userInfo.nucleusId);
                    triggerEventAuthUserPidRetrieved();

                    user.setPersonaId(userInfo.personaId);
                    user.setShowPersona(userInfo.showPersona);
                    user.setOriginId(userInfo.originId);
                    user.setUserStatus('');
                    user.setDob(userInfo.dob);
                    user.setUnderAge(userInfo.underAge);
                    user.setRegistrationDate(userInfo.dateCreated);
                    triggerEventAuthSuccess(loginType);
                });
        } else {

            logger.log('LOGIN: online');
            var endPoint = urls.endPoints.connectAuth;
            var config = {
                atype: 'GET',
                headers: [],
                parameters: [],
                reqauth: false, //set these to false so that dataREST doesn't automatically trigger a relogin
                requser: false,
                withCredentials: true
            };

            return dataManager.dataREST(endPoint, config)
                .then(processLoginResponse)
                .then(retrieveUserPidFromServer)
                .then(processUserPidResponse)
                .then(getPersonaAppSettingsAndConnectDirtyBits(loginType))
                .catch(errorhandler.logAndCleanup('AUTH:login FAILED', authFailed(loginType)));
        }
    }

    /**
     * Returns a promise that resolves if the client SID cookie renewal was successful.
     * Requests a session ID (SID) cookie refresh from the embedded client.
     * accounts.ea.com uses the SID for authentication for several requests. Note that
     * a successful renewal request extends the expiration of the current SID value
     * and doesn't necessarily return a new value.
     */
    function requestSidRefresh() {
        return new Promise(function(resolve, reject) {
            // Define our response handler. HTTP 200 indicates success,
            // otherwise it's a failure.
            var onSidRenewalResponse = function(restError, httpStatus) {

                var response = {
                    rest: restError,
                    http: httpStatus
                };

                // We must wrap our Qt::disconnect attempt in a try-catch. If
                // the disconnect fails, an exception is thrown!
                try {
                    events.off(events.CLIENT_SIDRENEWAL, onSidRenewalResponse);

                    if (REST_ERROR_SUCCESS === restError) {
                        resolve(response);
                    } else {
                        reject(Error(response));
                    }
                } catch (e) {
                    reject(Error('bridge disconnect failure'));
                }
            };

            // We must wrap our Qt::connect attempt in a try-catch. If
            // the connect fails, an exception is thrown!
            try {
                // Check that the embedded client is present and that we
                // can actually make the SID renewal request. Note that
                // the Origin embedded client exposes the OriginUser object.
                if (client.isEmbeddedBrowser()) {
                    // Connect to the response before we issue the request
                    events.on(events.CLIENT_SIDRENEWAL, onSidRenewalResponse);

                    // Call the embedded client to perform the sid refresh
                    client.user.requestSidRefresh();
                } else {
                    reject(Error('bridge connect failure'));
                }
            } catch (e) {
                reject(Error('bridge connect failure'));
            }
        });
    }

    //triggering  login (event is private within jssdk)
    function onTriggerLogin(loginType) {
        login(loginType);
    }

    function reloginAccessTokenExpired() {
        return login(defines.login.AUTH_INVALID);
    }

    events.on(events.CLIENT_ONLINESTATECHANGED, onClientOnlineStateChanged);
    events.on(events.priv.AUTH_TRIGGERLOGIN, onTriggerLogin);

    return /** @lends module:Origin.module:auth */ {
        /**
         * is a user logged in the Origin JSSDK
         * @method
         * @return {boolean} responsename true if the user is logged in, false if the user is not
         */
        isLoggedIn: function() {
            var loggedIn = false;
            if (client.isEmbeddedBrowser() && !client.onlineStatus.isOnline()) {
                loggedIn = user.publicObjs.userPid().length !== 0;
            } else {
                loggedIn = (user.publicObjs.accessToken().length !== 0 && user.publicObjs.userPid().length !== 0);
            }
            return loggedIn;
        },

        /**
         * is a user online or offline in the Origin JSSDK
         * @method
         * @return {boolean} responsename true if the user is online, false if the user is not
         */
        isOnline: function() {
            if (client.isEmbeddedBrowser()) {
                return client.onlineStatus.isOnline();
            }
            return true;
        },
        /**
         * relogin if the authtoken has expired
         * @method
         */
        reloginAccessTokenExpired: reloginAccessTokenExpired,
        /**
         * login the user to the Origin JSSDK
         * @method
         */
        login: login,

        /**
         * logout the user from the Origin JSSDK
         * @method
         */
        //for now just clear out the accessToken and userPid
        logout: function() {
            //IF embedded, send logout across the bridge and block logout through SPA
            if (client.isEmbeddedBrowser()) {
                return client.user.requestLogout();
            } else {
                user.clearUserAuthInfo();
                return dirtybits.disconnect().then(triggerEventAuthLoggedOut);
            }
        },

        /**
         * Returns a promise that resolves if the client SID cookie renewal was successful.
         * @method
         * @return {promise} responsename The promise resolves when the SID Cookie renewal attempt is completed
         */
        requestSidRefresh: requestSidRefresh
    };
});

/*jshint strict: false */
/*jshint unused: false */
/*jshint undef: false */
define('core/windows',['core/windows'], function(windows) {

    /**
     * Handle external links
     * @param {string} url the url to visit in the new window
     */
    function externalUrl(url) {
        if (Origin.client.isEmbeddedBrowser() && url && url.indexOf('http') !== -1) {
            Origin.client.desktopServices.asyncOpenUrl(url);
        } else if (Origin.client.isEmbeddedBrowser() && url) {
            var sanitizedUrl = window.location.protocol + '//' + window.document.domain + url;
            Origin.client.desktopServices.asyncOpenUrl(sanitizedUrl);
        } else {
            window.open(url);
        }
    }

    return /** @lends Origin.module:windows */ {
        /**
         * Handle external links
         * @method
         * @static
         * @param {string} url the url to visit in the new window
         */
        externalUrl: externalUrl
    };
});

/*jshint strict: false */
define('core/datetime',[], function() {
    /**
     * Contains date/time related methods
     * @module module:datetime
     * @memberof module:Origin
     */
    var trustedClock = Date.now(),
        trustedClockInitialized = false;

    function initializeTrustedClock(serverTime) {
        trustedClockInitialized = true;
        trustedClock = new Date(serverTime);
    }

    function secondsToDHMS(secs) {
        var timeObject = {};

        timeObject.days = Math.floor(secs / 86400);
        secs -= timeObject.days * 86400;
        timeObject.hours = Math.floor(secs / 3600) % 24;
        secs -= timeObject.hours * 3600;
        timeObject.minutes = Math.floor(secs/ 60) % 60;
        secs -= timeObject.minutes * 60;
        timeObject.seconds = secs % 60;
        return timeObject;
    }

    function getTrustedClock() {
        //until we can actually get a trusted clock, just return local time
        return Date.now();
    }

    return /** @lends module:Origin.module:datetime */ {
        /**
         * [initializeTrustedClock description]
         * @method
         * @static
         * @param {string} serverTime - sets the trusted clock based on servertime passed in
         */
        initializeTrustedClock: initializeTrustedClock,

        /**
         * [isInitialized description]
         * @method
         * @static
         * @return {boolean} returns true/false on whether the trusted clock was initialized to some server time
         */
        isInitialized: function () {
            return trustedClockInitialized;
        },

        /**
         * [getTrustedClock description]
         * @method
         * @static
         * @return {Date} returns the trust clock in Date
         */
        getTrustedClock: getTrustedClock,

        /**
         * @typedef timeObject
         * @type {object}
         * @property {number} days
         * @property {number} hours
         * @property {number} minutes
         * @property {number} seconds
         */

        /**
         * [secondsToDHMS description]
         * @method
         * @static
         * @param {number} secs  seconds
         * @return {timeObject} the seconds broken down into days, hours, minutes, seconds
         */
        secondsToDHMS: secondsToDHMS
    };
});
/*eslint-env browser,amd,node*/
//
// usertiming.js
//
// A polyfill for UserTiming (http://www.w3.org/TR/user-timing/)
//
// Copyright 2013 Nic Jansma
// http://nicj.net
//
// https://github.com/nicjansma/usertiming.js
//
// Licensed under the MIT license
//
(function(window) {
    "use strict";

    // allow running in Node.js environment
    if (typeof window === "undefined") {
        window = {};
    }

    // prepare base perf object
    if (typeof window.performance === "undefined") {
        window.performance = {};
    }

    // We need to keep a global reference to the window.performance object to
    // prevent any added properties from being garbage-collected in Safari 8.
    // https://bugs.webkit.org/show_bug.cgi?id=137407
    window._perfRefForUserTimingPolyfill = window.performance;

    //
    // Note what we shimmed
    //
    window.performance.userTimingJsNow = false;
    window.performance.userTimingJsNowPrefixed = false;
    window.performance.userTimingJsUserTiming = false;
    window.performance.userTimingJsUserTimingPrefixed = false;
    window.performance.userTimingJsPerformanceTimeline = false;
    window.performance.userTimingJsPerformanceTimelinePrefixed = false;

    // for prefixed support
    var prefixes = [];
    var methods = [];
    var methodTest = null;
    var i, j;

    //
    // window.performance.now() shim
    //  http://www.w3.org/TR/hr-time/
    //
    if (typeof window.performance.now !== "function") {
        window.performance.userTimingJsNow = true;

        // copy prefixed version over if it exists
        methods = ["webkitNow", "msNow", "mozNow"];

        for (i = 0; i < methods.length; i++) {
            if (typeof window.performance[methods[i]] === "function") {
                window.performance.now = window.performance[methods[i]];

                window.performance.userTimingJsNowPrefixed = true;

                break;
            }
        }

        //
        // now() should be a DOMHighResTimeStamp, which is defined as being a time relative
        // to navigationStart of the PerformanceTiming (PT) interface.  If this browser supports
        // PT, use that as our relative start.  Otherwise, use "now" as the start and all other
        // now() calls will be relative to our initialization.
        //

        var nowOffset = +(new Date());
        if (window.performance.timing && window.performance.timing.navigationStart) {
            nowOffset = window.performance.timing.navigationStart;
        }

        if (typeof window.performance.now !== "function") {
            // No browser support, fall back to Date.now
            if (Date.now) {
                window.performance.now = function() {
                    return Date.now() - nowOffset;
                };
            } else {
                // no Date.now support, get the time from new Date()
                window.performance.now = function() {
                    return +(new Date()) - nowOffset;
                };
            }
        }
    }

    //
    // PerformanceTimeline (PT) shims
    //  http://www.w3.org/TR/performance-timeline/
    //

    /**
     * Adds an object to our internal Performance Timeline array.
     *
     * Will be blank if the environment supports PT.
     */
    var addToPerformanceTimeline = function() {
    };

    /**
     * Clears the specified entry types from our timeline array.
     *
     * Will be blank if the environment supports PT.
     */
    var clearEntriesFromPerformanceTimeline = function() {
    };

    // performance timeline array
    var performanceTimeline = [];

    // whether or not the timeline will require sort on getEntries()
    var performanceTimelineRequiresSort = false;

    // whether or not ResourceTiming is natively supported but UserTiming is
    // not (eg Firefox 35)
    var hasNativeGetEntriesButNotUserTiming = false;

    //
    // If getEntries() and mark() aren't defined, we'll assume
    // we have to shim at least some PT functions.
    //
    if (typeof window.performance.getEntries !== "function" ||
        typeof window.performance.mark !== "function") {

        if (typeof window.performance.getEntries === "function" &&
            typeof window.performance.mark !== "function") {
            hasNativeGetEntriesButNotUserTiming = true;
        }

        window.performance.userTimingJsPerformanceTimeline = true;

        // copy prefixed version over if it exists
        prefixes = ["webkit", "moz"];
        methods = ["getEntries", "getEntriesByName", "getEntriesByType"];

        for (i = 0; i < methods.length; i++) {
            for (j = 0; j < prefixes.length; j++) {
                // prefixed method will likely have an upper-case first letter
                methodTest = prefixes[j] + methods[i].substr(0, 1).toUpperCase() + methods[i].substr(1);

                if (typeof window.performance[methodTest] === "function") {
                    window.performance[methods[i]] = window.performance[methodTest];

                    window.performance.userTimingJsPerformanceTimelinePrefixed = true;
                }
            }
        }

        /**
         * Adds an object to our internal Performance Timeline array.
         *
         * @param {Object} obj PerformanceEntry
         */
        addToPerformanceTimeline = function(obj) {
            performanceTimeline.push(obj);

            //
            // If we insert a measure, its startTime may be out of order
            // from the rest of the entries because the use can use any
            // mark as the start time.  If so, note we have to sort it before
            // returning getEntries();
            //
            if (obj.entryType === "measure") {
                performanceTimelineRequiresSort = true;
            }
        };

        /**
         * Ensures our PT array is in the correct sorted order (by startTime)
         */
        var ensurePerformanceTimelineOrder = function() {
            if (!performanceTimelineRequiresSort) {
                return;
            }

            //
            // Measures, which may be in this list, may enter the list in
            // an unsorted order. For example:
            //
            //  1. measure("a")
            //  2. mark("start_mark")
            //  3. measure("b", "start_mark")
            //  4. measure("c")
            //  5. getEntries()
            //
            // When calling #5, we should return [a,c,b] because technically the start time
            // of c is "0" (navigationStart), which will occur before b's start time due to the mark.
            //
            performanceTimeline.sort(function(a, b) {
                return a.startTime - b.startTime;
            });

            performanceTimelineRequiresSort = false;
        };

        /**
         * Clears the specified entry types from our timeline array.
         *
         * @param {string} entryType Entry type (eg "mark" or "measure")
         * @param {string} [name] Entry name (optional)
         */
        clearEntriesFromPerformanceTimeline = function(entryType, name) {
            // clear all entries from the perf timeline
            i = 0;
            while (i < performanceTimeline.length) {
                if (performanceTimeline[i].entryType !== entryType) {
                    // unmatched entry type
                    i++;
                    continue;
                }

                if (typeof name !== "undefined" && performanceTimeline[i].name !== name) {
                    // unmatched name
                    i++;
                    continue;
                }

                // this entry matches our criteria, remove just it
                performanceTimeline.splice(i, 1);
            }
        };

        if (typeof window.performance.getEntries !== "function" || hasNativeGetEntriesButNotUserTiming) {
            var origGetEntries = window.performance.getEntries;

            /**
             * Gets all entries from the Performance Timeline.
             * http://www.w3.org/TR/performance-timeline/#dom-performance-getentries
             *
             * NOTE: This will only ever return marks and measures.
             *
             * @returns {PerformanceEntry[]} Array of PerformanceEntrys
             */
            window.performance.getEntries = function() {
                ensurePerformanceTimelineOrder();

                // get a copy of all of our entries
                var entries = performanceTimeline.slice(0);

                // if there was a native version of getEntries, add that
                if (hasNativeGetEntriesButNotUserTiming && origGetEntries) {
                    // merge in native
                    Array.prototype.push.apply(entries, origGetEntries.call(window.performance));

                    // sort by startTime
                    entries.sort(function(a, b) {
                        return a.startTime - b.startTime;
                    });
                }

                return entries;
            };
        }

        if (typeof window.performance.getEntriesByType !== "function" || hasNativeGetEntriesButNotUserTiming) {
            var origGetEntriesByType = window.performance.getEntriesByType;

            /**
             * Gets all entries from the Performance Timeline of the specified type.
             * http://www.w3.org/TR/performance-timeline/#dom-performance-getentriesbytype
             *
             * NOTE: This will only work for marks and measures.
             *
             * @param {string} entryType Entry type (eg "mark" or "measure")
             *
             * @returns {PerformanceEntry[]} Array of PerformanceEntrys
             */
            window.performance.getEntriesByType = function(entryType) {
                // we only support marks/measures
                if (typeof entryType === "undefined" ||
                    (entryType !== "mark" && entryType !== "measure")) {

                    if (hasNativeGetEntriesButNotUserTiming && origGetEntriesByType) {
                        // native version exists, forward
                        return origGetEntriesByType.call(window.performance, entryType);
                    }

                    return [];
                }

                // see note in ensurePerformanceTimelineOrder() on why this is required
                if (entryType === "measure") {
                    ensurePerformanceTimelineOrder();
                }

                // find all entries of entryType
                var entries = [];
                for (i = 0; i < performanceTimeline.length; i++) {
                    if (performanceTimeline[i].entryType === entryType) {
                        entries.push(performanceTimeline[i]);
                    }
                }

                return entries;
            };
        }

        if (typeof window.performance.getEntriesByName !== "function" || hasNativeGetEntriesButNotUserTiming) {
            var origGetEntriesByName = window.performance.getEntriesByName;

            /**
             * Gets all entries from the Performance Timeline of the specified
             * name, and optionally, type.
             * http://www.w3.org/TR/performance-timeline/#dom-performance-getentriesbyname
             *
             * NOTE: This will only work for marks and measures.
             *
             * @param {string} name Entry name
             * @param {string} [entryType] Entry type (eg "mark" or "measure")
             *
             * @returns {PerformanceEntry[]} Array of PerformanceEntrys
             */
            window.performance.getEntriesByName = function(name, entryType) {
                if (entryType && entryType !== "mark" && entryType !== "measure") {
                    if (hasNativeGetEntriesButNotUserTiming && origGetEntriesByName) {
                        // native version exists, forward
                        return origGetEntriesByName.call(window.performance, name, entryType);
                    }

                    return [];
                }

                // see note in ensurePerformanceTimelineOrder() on why this is required
                if (typeof entryType !== "undefined" && entryType === "measure") {
                    ensurePerformanceTimelineOrder();
                }

                // find all entries of the name and (optionally) type
                var entries = [];
                for (i = 0; i < performanceTimeline.length; i++) {
                    if (typeof entryType !== "undefined" &&
                        performanceTimeline[i].entryType !== entryType) {
                        continue;
                    }

                    if (performanceTimeline[i].name === name) {
                        entries.push(performanceTimeline[i]);
                    }
                }

                if (hasNativeGetEntriesButNotUserTiming && origGetEntriesByName) {
                    // merge in native
                    Array.prototype.push.apply(entries, origGetEntriesByName.call(window.performance, name, entryType));

                    // sort by startTime
                    entries.sort(function(a, b) {
                        return a.startTime - b.startTime;
                    });
                }

                return entries;
            };
        }
    }

    //
    // UserTiming support
    //
    if (typeof window.performance.mark !== "function") {
        window.performance.userTimingJsUserTiming = true;

        // copy prefixed version over if it exists
        prefixes = ["webkit", "moz", "ms"];
        methods = ["mark", "measure", "clearMarks", "clearMeasures"];

        for (i = 0; i < methods.length; i++) {
            for (j = 0; j < prefixes.length; j++) {
                // prefixed method will likely have an upper-case first letter
                methodTest = prefixes[j] + methods[i].substr(0, 1).toUpperCase() + methods[i].substr(1);

                if (typeof window.performance[methodTest] === "function") {
                    window.performance[methods[i]] = window.performance[methodTest];

                    window.performance.userTimingJsUserTimingPrefixed = true;
                }
            }
        }

        // only used for measure(), to quickly see the latest timestamp of a mark
        var marks = {};

        if (typeof window.performance.mark !== "function") {
            /**
             * UserTiming mark
             * http://www.w3.org/TR/user-timing/#dom-performance-mark
             *
             * @param {string} markName Mark name
             */
            window.performance.mark = function (markName) {
                var now = window.performance.now();

                // mark name is required
                if (typeof markName === "undefined") {
                    throw new SyntaxError("Mark name must be specified");
                }

                // mark name can't be a NT timestamp
                if (window.performance.timing && markName in window.performance.timing) {
                    throw new SyntaxError("Mark name is not allowed");
                }

                if (!marks[markName]) {
                    marks[markName] = [];
                }

                marks[markName].push(now);

                // add to perf timeline as well
                addToPerformanceTimeline({
                    entryType: "mark",
                    name: markName,
                    startTime: now,
                    duration: 0
                });
            };
        }

        if (typeof window.performance.clearMarks !== "function") {
            /**
             * UserTiming clear marks
             * http://www.w3.org/TR/user-timing/#dom-performance-clearmarks
             *
             * @param {string} markName Mark name
             */
            window.performance.clearMarks = function (markName) {
                if (!markName) {
                    // clear all marks
                    marks = {};
                } else {
                    marks[markName] = [];
                }

                clearEntriesFromPerformanceTimeline("mark", markName);
            };
        }

        if (typeof window.performance.measure !== "function") {
            /**
             * UserTiming measure
             * http://www.w3.org/TR/user-timing/#dom-performance-measure
             *
             * @param {string} measureName Measure name
             * @param {string} [startMark] Start mark name
             * @param {string} [endMark] End mark name
             */
            window.performance.measure = function (measureName, startMark, endMark) {
                var now = window.performance.now();

                if (typeof measureName === "undefined") {
                    throw new SyntaxError("Measure must be specified");
                }

                // if there isn't a startMark, we measure from navigationStart to now
                if (!startMark) {
                    // add to perf timeline as well
                    addToPerformanceTimeline({
                        entryType: "measure",
                        name: measureName,
                        startTime: 0,
                        duration: now
                    });

                    return;
                }

                //
                // If there is a startMark, check for it first in the NavigationTiming interface,
                // then check our own marks.
                //
                var startMarkTime = 0;
                if (window.performance.timing && startMark in window.performance.timing) {
                    // mark cannot have a timing of 0
                    if (startMark !== "navigationStart" && window.performance.timing[startMark] === 0) {
                        throw new Error(startMark + " has a timing of 0");
                    }

                    // time is the offset of this mark to navigationStart's time
                    startMarkTime = window.performance.timing[startMark] - window.performance.timing.navigationStart;
                } else if (startMark in marks) {
                    startMarkTime = marks[startMark][marks[startMark].length - 1];
                } else {
                    throw new Error(startMark + " mark not found");
                }

                //
                // If there is a endMark, check for it first in the NavigationTiming interface,
                // then check our own marks.
                //
                var endMarkTime = now;

                if (endMark) {
                    endMarkTime = 0;

                    if (window.performance.timing && endMark in window.performance.timing) {
                        // mark cannot have a timing of 0
                        if (endMark !== "navigationStart" && window.performance.timing[endMark] === 0) {
                            throw new Error(endMark + " has a timing of 0");
                        }

                        // time is the offset of this mark to navigationStart's time
                        endMarkTime = window.performance.timing[endMark] - window.performance.timing.navigationStart;
                    } else if (endMark in marks) {
                        endMarkTime = marks[endMark][marks[endMark].length - 1];
                    } else {
                        throw new Error(endMark + " mark not found");
                    }
                }

                // add to our measure array
                var duration = endMarkTime - startMarkTime;

                // add to perf timeline as well
                addToPerformanceTimeline({
                    entryType: "measure",
                    name: measureName,
                    startTime: startMarkTime,
                    duration: duration
                });
            };
        }

        if (typeof window.performance.clearMeasures !== "function") {
            /**
             * UserTiming clear measures
             * http://www.w3.org/TR/user-timing/#dom-performance-clearmeasures
             *
             * @param {string} measureName Measure name
             */
            window.performance.clearMeasures = function (measureName) {
                clearEntriesFromPerformanceTimeline("measure", measureName);
            };
        }
    }

    //
    // Export UserTiming to the appropriate location.
    //
    // When included directly via a script tag in the browser, we're good as we've been
    // updating the window.performance object.
    //
    if (typeof define !== "undefined" && define.amd) {
        //
        // AMD / RequireJS
        //
        define('usertiming',[], function () {
            return window.performance;
        });
    } else if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
        //
        // Node.js
        //
        module.exports = window.performance;
    }
}(typeof window !== "undefined" ? window : undefined));

/*jshint strict: false */
/*jshint unused: false */

define('core/performance',[
    'core/telemetry',
    'usertiming'
], function(telemetry, usertiming) {
    /**
     * Contains functions relating to performance timing
     * @module module:performance
     * @memberof module:Origin
     */

    var performance = window.performance || {},
        performanceEnabled = (performance.mark !== undefined),
        START = 'start',
        END = 'end',
        MEASURE = 'measure';


        function setMarker(markerName) {
            if (performanceEnabled) {
                performance.mark(markerName);
            }
        }

        function setMeasure(measureName, startMarker, endMarker) {
            if (performanceEnabled) {
                performance.measure(measureName, startMarker, endMarker);
            }
        }

        function clearMarker(markerName) {
            performance.clearMarks(markerName);
        }

        function clearMarkersAll() {
            performance.clearMarks();
        }


        function clearMeasure(measureName) {
            performance.clearMeasures(measureName);
        }

        function clearMeasuresAll() {
            performance.clearMeasures();
        }

        function getEntriesByType(type) {
            var entries = [];

            if (performanceEnabled) {
                entries = performance.getEntriesByType(type);
            }
            return entries;
        }

        function getMarker(markerName) {
            var perfMarkers = [];

            if (performanceEnabled) {
                perfMarkers = performance.getEntriesByName(markerName);
            }
            return perfMarkers;
        }

        function getMarkersAll() {
            var perfMarkers = [];
            if (performanceEnabled) {
                perfMarkers = performance.getEntriesByType('mark');
            }
            return perfMarkers;
        }

        function getMeasure(measureName) {
            var perfMeasures = [];

            if (performanceEnabled) {
                perfMeasures = performance.getEntriesByName(measureName);
            }
            return perfMeasures;
        }


        function getMeasuresAll() {
            var perfMarkers = [];
            if (performanceEnabled) {
                perfMarkers = performance.getEntriesByType('measure');
            }
            return perfMarkers;
        }

        //************************************************************
        //*************** HELPER FUNCTIONS ***************************
        //************************************************************
        function beginTime(markerPrefix) {
            //clear existing marker, if there is one
            clearMarker(markerPrefix+START);
            setMarker(markerPrefix+START);
        }

        function endTime(markerPrefix) {
            try {
                //clear existing marker, if there is one
                clearMarker(markerPrefix + END);
                setMarker(markerPrefix + END);
            } catch(e) {
                //prevent errors from leaking into user flow
            }
        }

        function measureTime(markerPrefix) {
            var measure = {},
                measureArray;
            //clear existing measure, if there is one
            clearMeasure(markerPrefix+MEASURE);
            setMeasure(markerPrefix+MEASURE, markerPrefix+START, markerPrefix+END);
            measureArray = getMeasure(markerPrefix+MEASURE);
            if (measureArray.length > 0) {
                measure = measureArray[0];
            }
            return measure;
        }

        function sendMeasureTelemetry(markerPrefix) {
            var markerArray, measureArray,
                startTime = 0,
                endTime = 0,
                duration = 0;

            markerArray = getMarker(markerPrefix+START);
            if (markerArray.length > 0) {
                startTime = markerArray[0].startTime;
            }

            markerArray = getMarker(markerPrefix+END);
            if (markerArray.length > 0) {
                endTime = markerArray[0].startTime;
            }

            measureArray = getMeasure(markerPrefix+MEASURE);
            if (measureArray.length > 0) {
                duration = measureArray[0].duration;
            }
            telemetry.sendPerformanceTimerEvent(markerPrefix, startTime, endTime, duration);

        }

        function endTimeMeasureAndSendTelemetry(markerPrefix) {
            try {
                endTime(markerPrefix);
                measureTime(markerPrefix);
                sendMeasureTelemetry(markerPrefix);
            } catch(e) {
                //prevent errors from leaking into user flow
            }
        }

    return /** @lends Origin.module:performance */{
        /**
         * sets a performance marker
         * @method
         * @static
         * @param {string} markname
         */
        setMarker: setMarker,

        /**
         * given marker start and marker end, sets a measure of specified name
         * @method
         * @static
         * @param {string} measure name
         * @param {string} marker start
         * @param {string} marker end
         */
        setMeasure: setMeasure,

        /**
         * clears specified marker
         * @method
         * @static
         * @param {string} markername
         */
        clearMarker: clearMarker,

        /**
         * clears all markers
         * @method
         * @static
         */
        clearMarkersAll: clearMarkersAll,

        /**
         * clears specified measure
         * @method
         * @static
         * @param {string} measurename measurename
         */
        clearMeasure: clearMeasure,

        /**
         * clears all measures
         * @method
         * @static
         */
        clearMeasuresAll: clearMeasuresAll,

        /**
         * @typedef performanceObject
         * @type object
         * @property {float} duration for mark, 0; for measure, duration between markers supplied
         * @property {string} entryType mark or measure
         * @property {string} name
         * @property {string} startTime
         */

        /**
         * given a marker name, returns the associated performanceObject(s)
         * @method
         * @static
         * @param {string} marker name of marker
         * @return {Origin.module:performance~performanceObject[]} markerObj array of markers
         */
        getMarker: getMarker,

        /**
         * returns all markers
         * @method
         * @static
         * @return {Origin.module:performance~performanceObject[]} markerObj array of markers
         */
        getMarkersAll: getMarkersAll,

        /**
         * given the start marker and end marker, returns the performanceObject(s)
         * @method
         * @static
         * @param {string} measureName
         * @return {Origin.module:performance~performanceObject[]} measureObj array of measures
         */
        getMeasure: getMeasure,

        /**
         * returns all markers
         * @method
         * @static
         * @param {string} measureName
         * @param {string} startMarker
         * @param {string} endMarker
         * @return {Origin.module:performance~performanceObject[]} measureObj array of measures
         */
        getMeasuresAll: getMeasuresAll,

        /**
         * marks the beginning timer, clears existing marker
         * @method
         * @static
         * @param {string} markerPrefix
         */
        beginTime: beginTime,

        /**
         * marks the end of the timer, clears existing marker
         * @method
         * @static
         * @param {string} markerPrefix
         */
        endTime: endTime,

        /**
         * measure the time between start and end marker, clears existing measure
         * @method
         * @static
         * @param {string} markerPrefix
         * @return {Origin.module:performance~performanceObject} measureObj
         */
        measureTime: measureTime,

        /**
         * sends to telemetry info about the specified measure, measureTime needs to have been called prior to this
         * @method
         * @static
         * @param {string} markerPrefix
         */
        sendMeasureTelemetry: sendMeasureTelemetry,

        /**
         * all-in-one function that calls endTime, measureTime and sendMeasureTelemetry
         * @method
         * @static
         * @param {string} markerPrefix
         */
        endTimeMeasureAndSendTelemetry: endTimeMeasureAndSendTelemetry
    };
});
define('core/anonymoustoken',[
    'core/urls',
    'core/dataManager',
    'core/errorhandler'
], function(urls, dataManager, errorhandler) {

    'use strict';
    var TEN_MINUTES = 1000 /* milliseconds */ * 60 /* seconds */ * 10 /* minutes */;
    var token;
    /**
     * Create and return a AnonymourToken for the app to use (Singleton)
     * @return {object} A promise that will return the token when complete.
     */
    function getAnonymousToken() {
        token = token ? token : token = new AnonymousToken();
        return token.ensureAnonymousToken();
    }

    /**
     * Private data layer function  that will call th server end point to get an anonymous token
     * @return {Promise} A Rest call promise
     */
    function retrieveAnonymousToken() {
        var endPoint = urls.endPoints.anonymousToken,
            config = {
                atype: 'POST',
                headers: [{
                    'label': 'accept',
                    'val': 'application/json'
                }, {
                    'label': 'Content-Type',
                    'val' : 'application/x-www-form-urlencoded'
                }],
                parameters: [],
                reqauth: false, //set these to false so that dataREST doesn't automatically trigger a relogin
                requser: false
            },
            requestBody = 'grant_type=anonymous_token&client_id=ORIGIN_JS_SDK&client_secret=68BEdbSaTQEQba8DvV2RGbNl9KRrY5stIN1IDVjPwm1ycRea3u9nlKCcuHD1uQybjQK7s2j4M3E7V1J8';
            config.body = requestBody;

        return dataManager.dataREST(endPoint, config)
            .catch(errorhandler.logAndCleanup('AUTH: anonymous token retrieval failed'));
    }

    // ANONYMOUS TOKEN //
    /**
     * Constructor for the cart token object
     * The token is an inner class used to handle the expire logic around a cart token
     */
    function AnonymousToken() {
        this.id = undefined;
        this.expires = 0;
    }

    /**
     * Check to see if a token is expired
     * @return {Boolean} is the token expired
     */
    AnonymousToken.prototype.isExpired = function() {
        return (this.expires - Date.now() < 0);
    };

    /**
     * Simple getter for the token id
     * @return {string} the token id.
     */
    AnonymousToken.prototype.getId = function() {
        return this.id;
    };

    /**
     * Make sure that the current token is up to date and valid.
     * @return {Promise} This promise will return the AnonymousToken object
     */
    AnonymousToken.prototype.ensureAnonymousToken = function() {
        var token = this;
        return new Promise(function(resolve) {
            if (token.isExpired()) {
                // We don't return the promise from refresh token because it returns the
                // http response from the server. This way the data is consistent.
                token.refreshAnonymousToken().then(function() {
                    resolve(token);
                });
            } else {
                resolve(token);
            }
        });
    };

    /**
     * Get a new token from the cart service
     * @return {Promise} The promise that will resolve when a new token is returned
     */
    AnonymousToken.prototype.refreshAnonymousToken = function() {
        var token = this;
        return retrieveAnonymousToken().then(function(response) {
            /* jshint camelcase:false */
            if (response && response.access_token  && response.expires_in){
                token.id = response.access_token;
                token.expires = Date.now() + (response.expires_in * 1000) - TEN_MINUTES;
            }
            /* jshint camelcase:true */
        });
    };

    return {
        getAnonymousToken: getAnonymousToken
    };
});

/*jshint unused: false */
/*jshint strict: false */
define('modules/achievements/achievement',[
    'core/user',
    'core/dataManager',
    'core/urls',
    'core/errorhandler',
], function(user, dataManager, urls, errorhandler) {

    /**
     * @module module:achievements
     * @memberof module:Origin
     */

    function userAchievements(personaId, achievementSet, locale) {
        var endPoint = urls.endPoints.userAchievements;
        var config = {
            atype: 'GET',
            headers: [{
                'label': 'X-Api-Version',
                'val': '2'
            },{
                'label': 'X-Application-Key',
                'val': 'Origin'
            }],
            parameters: [{
                'label': 'personaId',
                'val': personaId
            },{
                'label': 'achievementSet',
                'val': achievementSet
            },{
                'label': 'locale',
                'val': locale
            }],
            appendparams: [],
            reqauth: true,
            requser: false
        };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'X-AuthToken', token);
        }

        return dataManager.enQueue(endPoint, config, 0)
          .catch(errorhandler.logAndCleanup('ACHIEVEMENTS:userAchievements FAILED'));
    }

    function userAchievementSets(personaId, locale) {
        var endPoint = urls.endPoints.userAchievementSets;
        var config = {
            atype: 'GET',
            headers: [{
                'label': 'X-Api-Version',
                'val': '2'
            },{
                'label': 'X-Application-Key',
                'val': 'Origin'
            }],
            parameters: [{
                'label': 'personaId',
                'val': personaId
            },{
                'label': 'locale',
                'val': locale
            }],
            appendparams: [],
            reqauth: true,
            requser: false
        };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'X-AuthToken', token);
        }

        return dataManager.enQueue(endPoint, config, 0)
          .catch(errorhandler.logAndCleanup('ACHIEVEMENTS:userAchievementSets FAILED'));
    }

    function userAchievementPoints(personaId) {
        var endPoint = urls.endPoints.userAchievementPoints;
        var config = {
            atype: 'GET',
            headers: [{
                'label': 'X-Api-Version',
                'val': '2'
            },{
                'label': 'X-Application-Key',
                'val': 'Origin'
            }],
            parameters: [{
                'label': 'personaId',
                'val': personaId
            }],
            appendparams: [],
            reqauth: true,
            requser: false
        };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'X-AuthToken', token);
        }

        return dataManager.enQueue(endPoint, config, 0)
          .catch(errorhandler.logAndCleanup('ACHIEVEMENTS:userAchievementPoints FAILED'));
    }

    function achievementSetReleaseInfo(locale) {
        var endPoint = urls.endPoints.achievementSetReleaseInfo;
        var config = {
            atype: 'GET',
            headers: [{
                'label': 'X-Api-Version',
                'val': '2'
            },{
                'label': 'X-Application-Key',
                'val': 'Origin'
            }],
            parameters: [{
                'label': 'locale',
                'val': locale
            }],
            appendparams: [],
            reqauth: true,
            requser: false
        };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'X-AuthToken', token);
        }

        return dataManager.enQueue(endPoint, config, 0)
          .catch(errorhandler.logAndCleanup('ACHIEVEMENTS:achievementSetReleaseInfo FAILED'));
    }

    return /** @lends module:Origin.module:achievements */ {

        /**
         * Achievement icon set
         * @typedef achievementIconsObject
         * @type {object}
         * @property {string} 40 40x40 icon URL
         * @property {string} 208 208x208 icon URL
         * @property {string} 416 416x416 icon URL
         */
        /**
         * Achievement expansion info
         * @typedef achievementExpansionObject
         * @type {object}
         * @property {string} id
         * @property {string} name
         */
        /**
         * Achievement info
         * @typedef achievementObject
         * @type {object}
         * @property {string} achievedPercentage percentage as a string to two decimal places, i.e. 0.00
         * @property {number} cnt the number of times this achievement has been earned
         * @property {string} desc localized description of this achievement
         * @property {number} e timestamp of expiration date for this achievement, in msec since epoch
         * @property {achievementIconsObject} icons icons of various sizes
         * @property {string} howto localized description of how to earn this achievement
         * @property {string} img unlocalized name of the image associated with this achievement
         * @property {string} name localized achievement name
         * @property {number} p progress points towards this achievement
         * @property {number} pt TBD
         * @property {object[]} requirements TBD
         * @property {number} rp reward points
         * @property {string} rp_t reward points (visualized)
         * @property {number} s TBD
         * @property {boolean} supportable TBD
         * @property {number} t total progress points needed to earn this achievement
         * @property {number} tc TBD
         * @property {boolean} tiered TBD
         * @property {object[]} tn TBD
         * @property {number} tt TBD
         * @property {number} u timestamp of last update to this achievement, in msec since epoch
         * @property {number} xp experience points
         * @property {string} xp_t experience points (visualized)
         * @property {achievementExpansionObject} xpack if this achievement is associated with an expansion, this field will contain information about the expansion
         */
        /**
         * Achievement set info
         * @typedef achievementSetObject
         * @type {object}
         * @property {achievementObject[]} achievements indexed by achievement ID
         * @property {achievementExpansionObject[]} expansions
         * @property {string} name
         * @property {string} platform
         */
        /**
         * Achievement progress info
         * @typedef achievementProgressObject
         * @type {object}
         * @property {number} achievements
         * @property {number} rewardPoints
         * @property {number} experience
         */
        /**
         * Published achievement product info
         * @typedef publishedAchievementProductObject
         * @type {object}
         * @property {string} masterTitleId
         * @property {string} name
         * @property {string} platform
         */

        /**
         * Retrieve all achievements for a user
         * @param  {personaId} personaId of the user
         * @param  {achievementSet} achievementSetId of the achievement set
         * @param  {locale} current application locale
         * @return {Promise<achievementSetObject>} A promise that on success will return all achievements from a specific achievement set for a user.
         */
        userAchievements: userAchievements,

        /**
         * Retrieve all achievement sets for a user
         * @param  {personaId} personaId of the user
         * @param  {locale} current application locale
         * @return {Promise<achievementSetObject[]>} A promise that on success will return all applicable achievement sets indexed by achievementSetId for a user.
         */
        userAchievementSets: userAchievementSets,

        /**
         * Retrieve achievement points for a user
         * @param  {personaId} personaId of the user
         * @return {Promise<achievementProgressObject>} A promise that on success will return the Achievement Progression for a user.
         */
        userAchievementPoints: userAchievementPoints,

        /**
         * Retrieves all released achievement sets
         * @param  {locale} current application locale
         * @return {Promise<publishedAchievementProductObject[]>} A promise that on success with a list of offers indexed by achievementSetId that have achievements and
         * are published both in the catalog and the achievement service.
         */
        achievementSetReleaseInfo: achievementSetReleaseInfo

    };
});

/*jshint unused: false */
/*jshint strict: false */
define('modules/feeds/feeds',[
    'promise',
    'core/dataManager',
    'core/urls',
    'core/errorhandler',
], function(Promise, dataManager, urls, errorhandler) {

    /**
     * @module module:feeds
     * @memberof module:Origin
     */

    /**
     * handles the story response
     * @param  {object} story response
     */
    function processResponseStories(response) {
        if (typeof response.stories !== 'undefined') {
            return response.stories;
        } else {
            return errorhandler.promiseReject('unexpected response from retrieveFeeds');
        }
    }

    function retrieveStoryData(feedType, startingNdx, numStories, locale) {

        //url is composited
        //{env}.{feedType}.feeds.dm.origin.com/stories/{startinIndex}/
        //and if numStories is defined and not 1, then size=numStories is appended
        var endPoint = urls.endPoints.feedStories;

        //we need to substitute
        endPoint = endPoint.replace('{locale}', locale);
        endPoint = endPoint.replace(/{feedType}/g, feedType); //replace all occurrences
        endPoint = endPoint.replace('{index}', startingNdx);

        if (typeof numStories !== 'undefined') {
            endPoint += '/?size=' + numStories;
        }

        var requestConfig = {
            atype: 'GET',
            headers: [],
            parameters: [],
            appendparams: [],
            reqauth: true,
            requser: false
        };

        return dataManager.enQueue(endPoint, requestConfig, 0)
            .then(processResponseStories)
            .catch(errorhandler.logAndCleanup('FEEDS:retrieveStoryData FAILED')); //added cause we want to trap the reject from processResponseStories

    }

    return/** @lends module:Origin.module:feeds */ {

        /**
         * This will return a promise for the requested feed from ({env}.{feedType}.feeds.dm.origin.com/stories/{startinIndex}/)
         *
         * @param  {string} feedType    The feed type
         * @param  {number} startingNdx The starting index
         * @param  {number} numStories  Num stories to retrieve
         * @param  {string} locale      The locale
         * @return {promise} name response dependent on feedtype but returns an array of responsetype
         * @method
         */
        retrieveStoryData: retrieveStoryData
    };
});
/*jshint unused: false */
/*jshint strict: false */
define('modules/games/subscription',[
    'promise',
    'core/logger',
    'core/user',
    'core/urls',
    'core/dataManager',
    'core/errorhandler',
    'core/locale',
    'core/events',
    'core/utils',
    'modules/client/client',
    'generated/jssdkconfig.js'
], function(Promise, logger, user, urls, dataManager, errorhandler, locale, events, utils, client, jssdkconfig) {
    /**
     * @module module:subscription
     * @memberof module:Origin
     */

    var subReqNum = 0;  //to keep track of the request #

    function hasUsedTrial() {
        var endPoint = urls.endPoints.hasUsedTrial,
            config = {
                atype: 'GET',
                headers: [{
                    'label': 'Accept',
                    'val': 'application/vnd.origin.v3+json; x-cache/force-write'
                }],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }],
                reqauth: true,
                requser: true
            };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'AuthToken', token);
        }

        return dataManager.enQueue(endPoint, config, subReqNum)
            .catch(errorhandler.logAndCleanup('SUBS:hasUsedTrial FAILED'));
    }

    function userSubscriptionBasic(subscriptionState) {
        var endPoint = urls.endPoints.userSubscription,
            auth = 'Bearer ',
            config = {
                atype: 'GET',
                headers: [{
                    'label': 'Accept',
                    'val': 'application/vnd.origin.v3+json; x-cache/force-write'
                }],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }, {
                    'label': 'state',
                    'val' : subscriptionState
                }],
                reqauth: true, //set these to false so that dataREST doesn't automatically trigger a relogin
                requser: true
            };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            auth += token;
            dataManager.addHeader(config, 'Authorization', auth);
        }

        return dataManager.enQueue(endPoint, config, subReqNum)
            .catch(errorhandler.logAndCleanup('SUBS:userSubscriptionBasic FAILED'));
    }

    function userSubscriptionDetails(uri, forceRetrieve) {
        var endPoint = urls.endPoints.userSubscriptionDetails,
            auth = 'Bearer ',
            config = {
                atype: 'GET',
                headers: [{
                    'label': 'Accept',
                    'val': 'application/vnd.origin.v3+json; x-cache/force-write'
                }],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid(),
                }, {
                    'label' : 'uri',
                    'val': uri
                }],
                reqauth: true,
                requser: true
            };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            auth += token;
            dataManager.addHeader(config, 'Authorization', auth);
        }

        if (typeof forceRetrieve !== 'undefined' && forceRetrieve === true) {
            subReqNum++; //update the request #
        }

        return dataManager.enQueue(endPoint, config, subReqNum)
            .catch(errorhandler.logAndCleanup('SUBS:userSubscriptionDetails FAILED'));
    }

    function getUserVaultInfo(forceRetrieve) {
        var endPoint = urls.endPoints.userVaultInfo,
            config = {
                atype: 'GET',
                headers: [{
                    'label': 'Accept',
                    'val': 'application/vnd.origin.v3+json; x-cache/force-write'
                }],
                parameters: [],
                reqauth: true,
                requser: false
            };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'AuthToken', token);
        }

        var cmsstage = utils.getProperty(jssdkconfig, ['overrides', 'cmsstage']) || '';
        if (cmsstage === 'preview' || cmsstage === 'approve') {
            dataManager.addHeader(config, 'X-Origin-Access-Use-Unpublished-Vault', 'true');
        }

        if (typeof forceRetrieve !== 'undefined' && forceRetrieve === true) {
            subReqNum++; //update the request #
        }
        return dataManager.enQueue(endPoint, config, subReqNum)
            .catch(errorhandler.logAndCleanup('SUBS:getUserVaultInfo FAILED'));
    }

    function vaultEntitle(subscriptionId, offerId) {
        var token = user.publicObjs.accessToken();
        if (token.length === 0) {
            return Promise.reject({success: false, message: 'requires-auth'});
        }

        if (typeof subscriptionId === 'undefined' || subscriptionId === null) {
            return Promise.reject({success: false, message: 'requires-subscription'});
        }

        var endPoint = urls.endPoints.vaultEntitle;
        var config = {atype: 'POST', reqauth: true, requser: true };
        var clientOrWeb = client.isEmbeddedBrowser() ? 'CLIENT' : 'WEB';
        var countryCode = locale.countryCode();
        var source = 'ORIGIN-STORE-'+clientOrWeb+'-'+countryCode;

        dataManager.addHeader(config, 'authToken', token);
        dataManager.addAuthHint(config, 'authToken', '{token}');
        dataManager.addParameter(config, 'userId', user.publicObjs.userPid());
        dataManager.addParameter(config, 'subscriptionId', subscriptionId);
        dataManager.addParameter(config, 'offerId', offerId);
        dataManager.appendParameter(config, 'source', source);

        return dataManager.enQueue(endPoint, config, subReqNum)
            .then(function(data){
                // trigger dirtybits entitlement update event and then pass through data
                events.fire(events.DIRTYBITS_ENTITLEMENT);
                return data;
            })
            .catch(errorhandler.logAndCleanup('SUBS:vaultGameCheckout FAILED'));
    }

    function vaultRemove(subscriptionId, offerId) {
        var token = user.publicObjs.accessToken();
        if (token.length === 0) {
            return Promise.reject({success: false, message: 'requires-auth'});
        }

        if (typeof subscriptionId === 'undefined' || subscriptionId === null) {
            return Promise.reject({success: false, message: 'requires-subscription'});
        }

        var endPoint = urls.endPoints.vaultRemove;
        var config = {atype: 'DELETE', reqauth: true, requser: true };

        dataManager.addHeader(config, 'authToken', token);
        dataManager.addAuthHint(config, 'authToken', '{token}');
        dataManager.addParameter(config, 'userId', user.publicObjs.userPid());
        dataManager.addParameter(config, 'subscriptionId', subscriptionId);
        dataManager.appendParameter(config, 'offerId', offerId);

        return dataManager.enQueue(endPoint, config, subReqNum)
            .then(function(){
                // trigger dirtybits entitlement update event and then pass
                // through success response, since no response is returned
                // from request
                events.fire(events.DIRTYBITS_ENTITLEMENT);
                return {success: true};
            })
            .catch(errorhandler.logAndCleanup('SUBS:vaultGameRemove FAILED'));
    }

    return /** @lends module:Origin.module:subscription */{

        /**
         * @typedef subscriptionBasicObject
         * @type {object}
         * @property {string} firstSignUpDate date firsg signed up
         * @property {string} firstSignUpSubs path to first signed up subs
         * @property {string[]} subscriptionUri array of subscription uri paths
         */
        /**
         * This will return a promise for the user's basic subscription info
         *
         * @return {promise<module:Origin.module:subscription~subscriptionBasicObject>} responsename user's basic subs info, object will be empty if not a subscriber
         * @method
         */
        userSubscriptionBasic: userSubscriptionBasic,


        /**
         * @typedef subscriptionDetailObject
         * @type {object}
         * @property {string} userUri
         * @property {string} offerUri
         * @property {string} source
         * @property {string} status
         * @property {string} dateCreated
         * @property {string} dateModified
         * @property {string} entitlementsUri
         * @property {string} eventsUri
         * @property {string} invoicesUri
         * @property {string} scheduleOpesUri
         * @property {string} subscriptioinUri
         * @property {string} billingMode
         * @property {string} anniersaryDay
         * @property {string} subsStart
         * @property {string} subsEnd
         * @property {string} nextBillingDate
         * @property {string} freeTrial
         * @property {string} accountUri
         */
        /**
         * @typedef eventObject
         * @type {object}
         * @property {string} eventType
         * @property {string} eventDate
         * @property {string} eventStatus
         * @proeprty {string} eventId
         */
        /**
         * @typedef subscriptionEventReponseObject
         * @type {object}
         * @property {eventObject[]} SubscriptionEvent
         */
        /**
         * @typedef propertiesInfoObject
         * @type {Object}
         * @property {string} name
         * @property {string} value
         */
        /**
         * @typedef scheduleOperationObject
         * @type {object}
         * @property {string} operationId
         * @property {string} operationName
         * @property {string} status
         * @property {string} scheduleDate
         * @property {propertiesInfoObject[]} PropertiesInfo
         */
        /**
         * @typedef scheduleOperationResponseObject
         * @type {object}
         * @property {scheduleOperationObject[]} ScheduleOperation
         */
        /**
         * @typedef subscriptionDetailObject
         * @type {object}
         * @property {subscriptionObject} Subscription
         * @property {subscriptionEventResponseObject} GetSubscriptionEventsResponse
         * @property {scheduleOperationResponseObject} GetScheduleOperationResponse
         */
        /**
         * This will return a promise for the detail of a particualr subscription
         *
         * @param {string} uri uri of subscription
         * @param {boolean} forceRetrieve flag to force a retrieval from the server
         * @return {promise<module:Origin.module:subscription~subscriptionDetailObject>} responsename user's detailed subs info
         * @method
         */
        userSubscriptionDetails: userSubscriptionDetails,


        /**
         * This will return a promise for the details of user's vault
         *
         * @return {promise}
         * @method
         */
        getUserVaultInfo: getUserVaultInfo,

        /**
         * @typedef fullfillmentResponseObject
         * @type {object}
         * @property {stringp[]} entitlementUris array of entitlement URI paths
         * @property {stringp[]} subscriptionUris  array of subscription URI paths
         */
        /**
         * Grant vault game entitlement to user
         *
         * @param {string} subscriptionId users subscription ID
         * @param {string} offerId offer to grant entitlement for
         * @return {promise<module:Origin.module:subscription~fullfillmentResponseObject>} responsename vault entitle fullfillment response
         * @method
         */
        vaultEntitle: vaultEntitle,

        /**
         * @typedef removalResponseObject
         * @type {object}
         * @property {boolean} success true on successful removal, otherwise false
         */
        /**
         * Remove vault game entitlement from user
         *
         * @param {string} subscriptionId users subscription ID
         * @param {string} offerId offer to remove entitlement for
         * @return {promise<module:Origin.module:subscription~removalResponseObject>} responsename vault removal response
         * @method
         */
        vaultRemove: vaultRemove,

        /**
         * @typedef hasUsedTrialResponseObject
         * @type {object}
         * @property {boolean} hasUsedTrial has the user comsumed the subscription trial
         */
        /**
         * Check the users subscription trial status
         *
         * @return {promise<module:Origin.module:subscription~hasUsedTrialResponseObject>} responsename has used trial fullfillment response
         * @method
         */
        hasUsedTrial: hasUsedTrial
    };
});
/*jshint strict: false */
/*jshint unused: false*/
define('modules/games/games',[
    'promise',
    'core/logger',
    'core/utils',
    'core/user',
    'core/urls',
    'core/dataManager',
    'core/errorhandler',
    'core/events',
    'core/locale',
    'modules/games/subscription',
    'core/anonymoustoken',
    'modules/client/client'
], function(Promise, logger, utils, user, urls, dataManager, errorhandler, events, configService, subscription, anonymoustoken, client) {
    /**
     * @module module:games
     * @memberof module:Origin
     */
    var defaultLMD = 'Sat, 01 Jan 2000 00:00:00 GMT',
        entReqNum = 0, //to keep track of the entitlement requests
        lastEntitlementRetrievedDate; //temp for now until we get the trusted clock

    /**
     * Returns the cached information from Local Storage for given productInfo
     * @param    productId
     * @return   offerInfo object = r:[LMD], dirty:true/false, o:[LMD]
     *           if it doesn't exist in local storage, returns undefined object
     */

    function getCacheInfo(productId) {
        var offerInfoLSstr = null,
            offerInfo;

        try {
            offerInfoLSstr = localStorage.getItem('lmd_' + productId);
        } catch (error) {
            logger.error('getCacheInfo: cannot get item from local storage - ', error.message);
        }

        if (offerInfoLSstr !== null) {
            //logger.log('getCacheInfo:', productId, ':', offerInfoLSstr);
            offerInfo = JSON.parse(offerInfoLSstr);
        } else {
            //logger.log('no localstorage for:', productId);
        }
        return offerInfo;
    }
    /**
     * description
     */

    function setCacheInfo(productId, offerInfo) {
        var jsonS = JSON.stringify(offerInfo);
        try {
            localStorage.setItem('lmd_' + productId, jsonS);
        } catch (error) {
            logger.error('setCacheInfo: unable to write to local storage', error.message);
        }
        //logger.log('setCacheInfo:', productId, ':', jsonS, 'offerInfo:', offerInfo.r, ',', offerInfo.o);
    }

    function parseLMD(response) {
        var returnObj = Date.parse(defaultLMD);
        //realize it's a bit odd to handle two types of responses here
        //alternative was to take the cached data and put it back in the same format as the network response
        //but netowrk response has the LMD as a datestring, and it seemed silly to convert the numeric value back to string to mimic the response
        //only to convert it back to the numeric value in this function.
        if (!isNaN(Number(response))) {
            //was just passed in a cached value, so just use that
            returnObj = response;
        } else if (utils.isChainDefined(response, ['offer', 0, 'updatedDate'])) {
            returnObj = Date.parse(response.offer[0].updatedDate);
        }

        return returnObj;
    }

    /**
     * This will return a promise for the value to use as the cache parameter for the catalog offer request
     *
     * @param    productId
     * @return   a promise
     *
     */
    function catalogCacheParameter(productId, updatedLMD) {
        //retrieve our cache-buster value
        var offerInfo = getCacheInfo(productId),
            promise = null;

        //if we're getting passed in an lmdvalue, then we received it via dirtybits
        if (updatedLMD) {
            promise = Promise.resolve(updatedLMD);
        } else {
            //not requested previously or isDirty = true means we need to go retrieve the Last-Modified-Date (LMD)
            if ((typeof offerInfo === 'undefined') || offerInfo.dirty === true) {
                //make request to ML to retrieve LMD
                var endPoint = urls.endPoints.catalogInfoLMD,
                    config = {
                        atype: 'GET',
                        headers: [{
                            'label': 'Accept',
                            'val': 'application/json; x-cache/force-write'
                        }],
                        parameters: [{
                            'label': 'productId',
                            'val': productId
                        }],
                        appendparams: [],
                        reqauth: false,
                        requser: false
                    };
                //just use 1 as outstanding since this is a no-cache request
                promise = dataManager.enQueue(endPoint, config, 1 /* outstanding */ );
            } else {
                //here if outstanding was already updated (e.g. when base entitlement was retrieved)
                promise = Promise.resolve(offerInfo.o);
            }
        }

        return promise;
    }

    function updateOfferCacheInfo(productId) {
        return function(lmdValue) {
            var offerCacheInfo = getCacheInfo(productId);
            if (!offerCacheInfo) {
                offerCacheInfo = {};
                offerCacheInfo.r = 0;
                offerCacheInfo.dirty = true;
            }

            offerCacheInfo.o = lmdValue;
            setCacheInfo(productId, offerCacheInfo);

            return lmdValue;
        };
    }

    function markCacheNotDirty(productId) {
        return function(response) {
            var offerCacheInfo = getCacheInfo(productId);
            offerCacheInfo.r = offerCacheInfo.o;
            offerCacheInfo.dirty = false;
            setCacheInfo(productId, offerCacheInfo);

            return response;

        };
    }

    function retrievePrivateCatalogInfo(lmdValue, productId, locale, parentOfferId, forcePrivate) {
        var token = user.publicObjs.accessToken();
        //if offline, token would be empty but we still want to retrieve it from the cache
        if (token.length > 0 || !client.onlineStatus.isOnline()) {
            var endPoint = urls.endPoints.catalogInfoPrivate,

                setLocale = locale || 'DEFAULT',
                country2letter = configService.countryCode(),
                encodedProductId = encodeURIComponent(productId),
                config = {
                    atype: 'GET',
                    headers: [{
                        'label': 'Accept',
                        'val': 'application/json; x-cache/force-write'
                    }],
                    parameters: [{
                        'label': 'productId',
                        'val': encodedProductId
                    }, {
                        'label': 'locale',
                        'val': setLocale
                    }],
                    appendparams: [{
                        'label': 'country',
                        'val' : country2letter
                    }, {
                        'label': 'lmd',
                        'val': lmdValue
                    }],
                    reqauth: true,
                    requser: false
                };

            if (forcePrivate) {
                //a temporary hack to get around the issue that EC2 isn't allowing /public endpoints
                //we'll get back a 401 if we don't own the offer but we don't want to re-initiate
                //a login in the case.  so just allow it to fail
                config.dontRelogin = true;
            }

            //want this to be suppressed when offline to prevent OPTIONS call
            dataManager.addHeader(config, 'AuthToken', token);

            //if parentId passed in, then this would be a request for extra content catalog
            if (parentOfferId) {
                config.appendparams.push({
                    'label': 'parentId',
                    'val': parentOfferId
                });
            }

            //error is caught in catalogInfo
            return dataManager.enQueue(endPoint, config, lmdValue);

        } else {
            //if token doesn't exist then don't bother making the request because it will trigger
            //a loop of trying to log in
            return errorhandler.promiseReject('private catalog url missing token:' + productId);
        }

    }

    function retrieveCatalogInfo(productId, locale, usePrivateUrl, parentOfferId) {
        return function(lmdValue) {
            var forcePrivate = false,
                promise = null,
                country2letter = configService.countryCode(),
                setLocale;

            //may need to remap locale to one that is recognized by EADP
            if (locale) {
                setLocale = configService.eadpLocale(locale, country2letter);
            } else {
                setLocale = 'DEFAULT';
            }

            if (usePrivateUrl || forcePrivate) {
                promise = retrievePrivateCatalogInfo(lmdValue, productId, setLocale, parentOfferId);
            } else {
                var endPoint = urls.endPoints.catalogInfo,
                    encodedProductId = encodeURIComponent(productId),
                    config = {
                        atype: 'GET',
                        headers: [{
                            'label': 'Accept',
                            'val': 'application/json; x-cache/force-write'
                        }],
                        parameters: [{
                            'label': 'productId',
                            'val': encodedProductId
                        }, {
                            'label': 'locale',
                            'val': setLocale
                        }],
                        appendparams: [{
                            'label': 'country',
                            'val': country2letter
                        },{
                            'label': 'lmd',
                            'val': lmdValue
                        }],
                        reqauth: false,
                        requser: false
                    };

                //error is caught in cataloginfo
                promise = dataManager.enQueue(endPoint, config, lmdValue);
            }
            return promise;
        };

    }

    function updateOfferLMDInfo(offerId, newLMD) {
        var offerInfo = getCacheInfo(offerId);
        if (typeof offerInfo === 'undefined') {
            offerInfo = {};
            offerInfo.r = 0;
        }
        offerInfo.o = newLMD;
        offerInfo.dirty = false;
        setCacheInfo(offerId, offerInfo);
    }


    function filteredLogAndCleanup(msg) {
        return function(error) {
            //to prevent spamming we of the console log we don't want to log the following failure causes for catalog info retrieval. The occur due to the way we retrieve public/private offers for LARS3 and are a part of the normal work flow
            if (utils.isChainDefined(error, ['response', 'failure', 'cause']) && (error.response.failure.cause === 'UNKNOWN_STOREGROUP' || error.response.failure.cause === 'UNKNOWN_OFFER' || error.response.failure.cause === 'OFFER_NOT_OWNED')) {
                return Promise.reject(error);
            } else {
                return errorhandler.logAndCleanup(msg)(error);
            }
        };
    }


    /**
     * This will return a promise for catalog info
     *
     * @param {string} productId The product id of the offer.
     * @param {string} locale locale of the offer
     * @return {promise<catalogInfo>}
     */
    function catalogInfo(productId, locale, usePrivateUrl, parentOfferId, updatedLMD) {
        return catalogCacheParameter(productId, updatedLMD)
            .then(parseLMD, parseLMD)
            .then(updateOfferCacheInfo(productId))
            .then(retrieveCatalogInfo(productId, locale, usePrivateUrl, parentOfferId))
            .then(markCacheNotDirty(productId), filteredLogAndCleanup('GAMES:catalogInfo FAILED'));

    }

    function updateLastEntitlementRetrievedDateFromHeader(headers) {
        //date should eventually come server
        lastEntitlementRetrievedDate = new Date();
        lastEntitlementRetrievedDate = lastEntitlementRetrievedDate.toISOString();
        lastEntitlementRetrievedDate = lastEntitlementRetrievedDate.substring(0, lastEntitlementRetrievedDate.lastIndexOf(':')) + 'Z';
    }

    function handleConsolidatedEntitlementsResponse(responseAndHeaders) {
        var response = responseAndHeaders.data,
            headers = responseAndHeaders.headers;

        updateLastEntitlementRetrievedDateFromHeader(headers);

        //need to update the offer LMD for each offer in the entitlement
        var len = response.entitlements.length;
        for (var i = 0; i < len; i++) {
            var lmdValue = Date.parse(response.entitlements[i].updatedDate); //convert to numeric value
            updateOfferLMDInfo(response.entitlements[i].offerId, lmdValue);
        }
        return response.entitlements;
    }

    function onDirtyBitsCatalogUpdate(dirtyBitData) {
        var offerUpdateTimes = dirtyBitData.offerUpdateTimes;
        //update the lmd
        for (var p in offerUpdateTimes) {
            if (offerUpdateTimes.hasOwnProperty(p)) {
                updateOfferLMDInfo(p, offerUpdateTimes[p]);
            }
        }
    }

    function handleBaseGameOfferIdByMasterTitleIdResponse(response) {
        if (response && response.offer) {
            return response.offer;
        }
        return [];
    }

    function djb2Code(str) {
        var chr,
            hash = 5381;

        for (var i = 0; i < str.length; i++) {
            chr = str.charCodeAt(i);
            hash = hash * 33 + chr;
        }
        return hash;
    }



    /**
     * Fetch the auth token for a user. Either and Anonymous token or a proper token
     * @return {string} The required token.
     */
    // TODO Remove Promise here.
    function getToken() {
        return user.publicObjs.accessToken();
    }
    /**
     * Create the config object used by the dataManager
     * @param  {string} offerId The offerId
     * @param  {token} token   A uniques identifier (the users Auth Token)
     * @param  {string} currency a currrency code, e.g. 'USD', 'CAD'
     * @param  {string} atype TBD
     * @return {objet}         The config object used by the dataManager
     */
    function createRatingsConfig(offerId, token, currency, atype) {
        atype = atype || 'GET';
        var config = {atype: atype},
            eadpLocale;

        if (token) {
            config.reqauth = true;
            dataManager.addHeader(config, 'AuthToken', token);
        }

        dataManager.addHeader(config, 'Accept', 'application/json');
        dataManager.addHeader(config, 'Content-Type', 'application/json');

        // query params
        dataManager.appendParameter(config, 'country', configService.countryCode());

        //may need to remap to eadpLocale
        eadpLocale = configService.eadpLocale(configService.locale(), configService.countryCode());
        dataManager.appendParameter(config, 'locale', eadpLocale);

        dataManager.appendParameter(config, 'pid', user.publicObjs.userPid());
        dataManager.appendParameter(config, 'currency', currency || configService.currencyCode());
        dataManager.appendParameter(config, 'offerIds', offerId);

        return config;
    }

    /**
     * Get the price from the ratings service
     * @param  {string} offerId The offerId which price to fetch
     * @param  {string} currency a currrency code, e.g. 'USD', 'CAD'
     * @return {Object}         The personalized price data for that offer.
     */
    function fetchPrice(offerId, currency) {
        var token = getToken();
        var config = createRatingsConfig(offerId, token, currency);
        var endPoint = token ? urls.endPoints.ratingsOffers : urls.endPoints.anonRatingsOffers;

        return dataManager.enQueue(endPoint, config, entReqNum)
            .then(function(result) {
                return result.offer;
            });
    }

    function getPricingFormatter() {
        var endPoint = urls.endPoints.currencyFormatter;
        var config = {
            atype: 'GET',
            headers: [{
                'label': 'Accept',
                'val': 'application/json; x-cache/force-write'
            }],
            parameters: [],
            appendparams: [],
            reqauth: false,
            requser: false,
            responseHeader: true
        };
        return dataManager.enQueue(endPoint, config, entReqNum)
            .then(function(response) {
                return response.data;
            });
    }

    function getPricingList(offerIdList, currency) {
        var pricePromises = [];
        pricePromises.push(fetchPrice(offerIdList, currency));
        return Promise.all(pricePromises);
    }

    function consolidatedEntitlements(forceRetrieve) {
        var endPoint = urls.endPoints.consolidatedEntitlements;
        var config = {
            atype: 'GET',
            headers: [{
                'label': 'Accept',
                'val': 'application/vnd.origin.v3+json; x-cache/force-write'
            }],
            parameters: [{
                'label': 'userId',
                'val': user.publicObjs.userPid()
            }],
            appendparams: [],
            reqauth: true,
            requser: true,
            responseHeader: true
        };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'AuthToken', token);
        }

        if (typeof forceRetrieve !== 'undefined' && forceRetrieve === true) {
            entReqNum++; //update the request #
        }

        //                var promise = dataManager.dataRESTauth(baseUrl, config);

        return dataManager.enQueue(endPoint, config, entReqNum)
            .then(handleConsolidatedEntitlementsResponse, errorhandler.logAndCleanup('GAMES:consolidatedEntitlements FAILED'));
    }

    events.on(events.DIRTYBITS_CATALOG, onDirtyBitsCatalogUpdate);

    return /** @lends module:Origin.module:games */ {

        /**
         * @typedef platformObject
         * @type {object}
         * @property {string} platform
         * @property {string} multiPlayerId
         * @property {string} downloadPackageType
         * @property {Date} releaseDate
         * @property {Date} downloadStartDate
         * @property {Date} useEndDate
         * @property {string} executePathOverride - null unless it's a url (web game)
         * @property {string} achievementSet
         */

        /**
         * not sure how to represent this, but basically, the object looks like this:
         * {
         *   PCWIN: {platformObject},
         *   MAC: {platformObject}
         * }
         * but each one is optional, i.e. the object could be empty, or it could just have PCWIN or just MAC or it could have both
         *
         * @typedef platformsObject
         * @type {object}
         */

        /**
         * @typedef countriesObject
         * @type {object}
         * @property {booelan} isPurchasable
         * @property {string} inStock
         * @property {string} catalogPrice
         * @property {string} countryCurrency
         * @property {string[]} catalogPriceA - array of prices
         * @property {string[]} countryCurrencyA - array of currencies
         * @property {boolean} hasSubscriberDiscount
         */

        /**
         * @typedef i18nObject
         * @type {object}
         * @property {string} franchiseFacetKey
         * @property {string} systemRequirements
         * @property {string} platformFacetKey
         * @property {string} longDescription
         * @property {string} officialSiteURL
         * @property {string} publisherFacetKey
         * @property {string} developerFacetKey
         * @property {string} shortDescription
         * @property {string} onlineDisclaimer
         * @property {string} eulaURL
         * @property {string} gameForumURL
         * @property {string} gameTypeFacetKey
         * @property {string} numgerofPlayersFacetKey
         * @property {string} genreFacetKey
         * @property {string} franchisePageLink
         * @property {string} brand
         * @property {string} displayName
         * @property {string} preAnnouncementDisplayDate
         * @property {string} ratingSystemIcon - url for icon image
         * @property {string} packArtSmall - url for packArt
         * @property {string} packArtMedium - url for packArt
         * @property {string} packArtLarge - url for packArt
         * @property {string} gameManualURL
         */

        /**
         * @typedef vaultObject
         * @type {object}
         * @property {string} offerId
         * @property {boolean} isUpgradeable
         */

        /**
         * @typedef catalogInfo
         * @type {object}
         * @property {string} offerId
         * @property {string} offerType
         * @property {string[]} extraContent - a list of extra content offerIds
         * @property {boolean} isDownloadable
         * @property {string} gameDistributionSubType
         * @property {string} trialLaunchDuration
         * @property {string} masterTitleId
         * @property {string[]} alternateMasterTitleIds - array of alternate masterTitleIds
         * @property {string[]} suppressedOfferIds - array of suppressedOffers
         * @property {string} originDisplayType
         * @property {platformsObject} platforms
         * @property {string} ratingSystemIcon - url for icon
         * @property {string} gameRatingUrl
         * @property {boolean} gameRatingPendingMature
         * @property {string} gameRatingDescriptionLong
         * @property {string} gameRatingTypeValue
         * @property {string[]} gameRatingDesc - array of descriptions
         * @property {string} franchiseFacetKey
         * @property {string} mdmItemType
         * @property {string} platformFacetKey
         * @property {string} publisherFacetKey
         * @property {string} imageServer - domain portion of packArt Url
         * @property {string} developerFacetKey
         * @property {string} revenueModel
         * @property {string[]} softwareLocales - array of locales
         * @property {string} gameTypeFacetKey
         * @property {string} masterTitle
         * @property {string} gameEditionTypeFacetKey
         * @property {string} numberofPlayersFacetKey
         * @property {string} genreFacetKey
         * @property {string} itemName
         * @property {string} itemType
         * @property {string} itemId
         * @property {string} rbuCode
         * @property {string} storeGroupId
         * @property {boolean} dynamicPricing
         * @property {countriesObject} countries
         * @property {i18nObject} i18n
         * @property {vaultObject} vault
         * @property {string[]} includeOffers
         * @property {string} contentId
         * @property {string} gameNameFacetKey
         * @property {string} gameEditionTypeFacetKeyRankDesc
         * @property {string} offerPath
         */

        /**
         * This will return a promise for catalog info
         *
         * @param {string} productId The product id of the offer.
         * @param {string} locale locale of the offer
         * @return {promise<module:Origin.module:games~catalogInfo>}
         * @method
         */
        catalogInfo: catalogInfo,

        /**
         * This will return a promise for the private catalog info
         *
         * @param {string} productId The product id of the offer.
         * @param {string} locale locale of the offer
         * @return {promise<module:Origin.module:games~catalogInfo>}
         */
        catalogInfoPrivate: function(productId, locale, parentOfferId) {
            return catalogInfo(productId, locale, true /*usePrivateUrl*/ , parentOfferId);
        },

        /**
         * @typedef entitlementObject
         * @type {object}
         * @property {string[]} alternateMasterTitleIds List of alternate master title IDs (optional)
         * @property {string} cdKey CD key issued by keymaster to activate the game (optional)
         * @property {number} entitlementId The ID of this entitlement record in nucleus
         * @property {string} entitlementSource The source of this entitlement
         * @property {string} entitlementTag The catalog-configured tag for this entitlement.
         * @property {string} entitlementType The catalog-configure type of this entitlement.
         * @property {string} gameDistributionSubType The catalog-configured subtype of this offer.
         * @property {string} gameEditionTypeFacetKeyRankDesc The catalog-configured rank of this offer.
         * @property {date} grantDate The date when this entitlement was created.
         * @property {string} groupName The catalog-configured group for this offer. (optional)
         * @property {boolean} isConsumable If true, the entitlement can be consumed, i.e. virtual currency points or card packs.
         * @property {string} masterTitleId The catalog-configured master title ID for this offer.
         * @property {string} offerAccess Describes whether the offer is public (published) or private.
         * @property {string} offerId The offer ID
         * @property {string} offerPath The OCD path for this offer.
         * @property {string} offerType The type of this offer.
         * @property {string} originDisplayType The catalog-configured display type for the offer (i.e. base game, DLC, etc.)
         * @property {string} originPermissions Indicates any special permissions this offer grants.
         * @property {string} productCatalog The catalog the offer originated from.
         * @property {string} projectId The catalog-configured project ID for this offer. (optional)
         * @property {string} status The status of this entitlement (ACTIVE, DELETED, etc.)
         * @property {string[]} suppressedBy A list of offers that suppress this offer via catalog configuration.
         * @property {string[]} suppressedOfferIds A list of offers that are suppressed by this offer via catalog configuration.
         * @property {date} updatedDate The date of the most recent update to this entitlement.
         * @property {number} useCount If the entitlement is consumable, this represents how many copies remain.
         * @property {number} version Version of the entitlement, incremented on each entitlement change.
         */
        /**
         * This will return a promise for the user's Entitlements
         *
         * @param {boolean} forceRetrieve If true grab latest info from server.
         * @return {promise<module:Origin.module:games~entitlementObject[]>}
         *
         */
         consolidatedEntitlements: function(forceRetrieve) {
            if(client.isEmbeddedBrowser()) {
                return client.games.retrieveConsolidatedEntitlements(urls.endPoints.consolidatedEntitlements, forceRetrieve)
                       .then(handleConsolidatedEntitlementsResponse, errorhandler.logAndCleanup('GAMES:consolidatedEntitlements FAILED'));
            } else {
                return consolidatedEntitlements(forceRetrieve);
            }
        },

        /**
         * This is the direct entitlement response object.
         *
         * @typedef directEntitlementObject
         * @type {object}
         * @property {boolean} success success state of entitlement request
         * @property {string} message optional message explaining success
         * @property {object} extra optional extra data explaining error
         */

        /**
         * Direct entitlement of free product
         *
         * @param {String} offerId Offer ID
         * @return {promise<module:Origin.module:games~directEntitlementObject>}
         * @method
         */
        directEntitle: function(offerId) {
            var authToken = user.publicObjs.accessToken(),
                eadpLocale;

            if (!authToken) {
                return new Promise(function(resolve){
                    resolve({success:false, message: 'requires-auth'});
                });
            }

            var endPoint = urls.endPoints.directEntitle;
            var config = {atype: 'POST', reqauth: true, requser: true};
            dataManager.addHeader(config, 'authToken', authToken);
            dataManager.addAuthHint(config, 'authToken', '{token}');
            dataManager.addHeader(config, 'Accept', 'application/json');
            dataManager.addParameter(config, 'offerId', offerId);
            dataManager.addParameter(config, 'userId', user.publicObjs.userPid());

            //may need to remap to eadpLocale
            eadpLocale = configService.eadpLocale(configService.locale(), configService.countryCode());
            dataManager.appendParameter(config, 'locale', eadpLocale);

            dataManager.appendParameter(config, 'cartName', 'store-cart-direct');

            return dataManager.enQueue(endPoint, config, entReqNum)
                .then(function(){
                    // trigger dirtybits entitlement update event
                    events.fire(events.DIRTYBITS_ENTITLEMENT);
                    return {success: true};
                }).catch(function(data) {
                    var failure = (data.response && data.response.error && data.response.error.failure) || {};

                    if (failure.cause === 'ALREADY_OWN') {
                        return {success: true, message: 'already-own'};
                    } else {
                        return {success: false, message: 'exception', extra: failure};
                    }
                });
        },

        /**
         * This will return a promise of a list of catalog info
         *
         * @return {promise<module:Origin.module:games~catalogInfoObject[]>}
         */
        getCriticalCatalogInfo: function(locale) {
            var setLocale,
                country2letter = configService.countryCode(),
                endPoint = urls.endPoints.criticalCatalogInfo,
                config = {
                    atype: 'GET',
                    headers: [{
                        'label': 'Accept',
                        'val': 'application/json'
                    }],
                    parameters: [{
                        'label': 'country2letter',
                        'val': country2letter
                    }],
                    appendparams: [],
                    reqauth: false,
                    requser: false
                };

            //may need to remap locale to one that is recognized by EADP
            if (locale) {
                setLocale = configService.eadpLocale(locale, country2letter);
            } else {
                setLocale = 'DEFAULT';
            }
            dataManager.addParameter(config, 'locale', setLocale);

            return dataManager.enQueue(endPoint, config, 0).catch(errorhandler.logAndCleanup('GAMES:getCriticalCatalogInfo FAILED'));
        },

        /**
         * @typedef path2offerIdObject
         * @type {object}
         * @property {string} storePath
         * @property {string} country
         * @property {string} offerId
         */
        /**
         * This will return a promise for path2offerId object
         *
         * @param {string} path
         * @return {promise<module:Origin.module:games~path2offerIdObject>} response
         */
        getOfferIdByPath: function(path) {
            var country2letter = configService.countryCode().toUpperCase(),
                endPoint = urls.endPoints.offerIdbyPath,
                config = {
                    atype: 'GET',
                    headers: [{
                        'label': 'Accept',
                        'val': 'application/json'
                    }],
                    parameters: [{
                        'label': 'path',
                        'val': path
                    }, {
                        'label': 'country2letter',
                        'val': country2letter
                    }],
                    appendparams: [],
                    reqauth: false,
                    requser: false
                };
            return dataManager.enQueue(endPoint, config, 0)
                .catch(errorhandler.logAndCleanup('GAMES:getOfferIdByPath FAILED'));
        },

        /**
         * @typedef customAttribObject
         * @type {object}
         * @property {string} gameEditionTypeFacetKeyRankDesc
         */

        /**
         * @typedef masterTitle2offerIdObject
         * @type {object}
         * @property {customAttribObject} customAttributes
         * @property {string} offerId
         */
        /**
         * Given a masterTitleId, this will return a promise for an array of objects of purchasable offerId with assciated gameEditionTypeFacetKeyRankDesc
         *
         * @param {string} masterTitleId
         * @return {promise<module:Origin.module:games~masterTitle2offerIdObject[]>} response
         */

        getBaseGameOfferIdByMasterTitleId: function(masterTitleId) {
            var country2letter = configService.countryCode().toUpperCase(),
                endPoint = urls.endPoints.basegameOfferIdByMasterTitleId,
                config = {
                    atype: 'GET',
                    headers: [{
                        'label': 'Accept',
                        'val': 'application/json'
                    }],
                    parameters: [{
                        'label': 'masterTitleId',
                        'val': masterTitleId
                    }, {
                        'label': 'country2letter',
                        'val': country2letter
                    }],
                    appendparams: [],
                    reqauth: false,
                    requser: false
                };
            return dataManager.enQueue(endPoint, config, 0)
                .then(handleBaseGameOfferIdByMasterTitleIdResponse)
                .catch(errorhandler.logAndCleanup('GAMES:getBaseGameOfferIdByMasterTitleId FAILED'));
        },

        /**
         * This will return a promise for the OCD object for the specified path
         *
         * @param {string} locales - should be locale+country, e.g. en-us.usa
         * @param {string} path
         * @return {promise<Object>} responsename OCD object for the specified path in CQ5 game tree
         *
         */
        getOcdByPath: function(locale, path) {
            var localeLower = locale.toLowerCase(),
                endPoint = urls.endPoints.ocdByPath,

                config = {
                    atype: 'GET',
                    headers: [{
                        'label': 'Accept',
                        'val': 'application/json; x-cache/force-write'
                    }],
                    parameters: [],
                    appendparams: [],
                    reqauth: false,
                    requser: false,
                    responseHeader: true
                };

            endPoint +=  path + '.' + localeLower + '.ocd';

            return dataManager.enQueue(endPoint, config, 0).catch(errorhandler.logAndCleanup('GAMES:getOcdByPath FAILED'));
        },

        /**
         * @typedef ratingObject
         * @type {object}
         * @property {float} finalTotalPrice
         * @property {float} originalTotalPrice
         * @property {float} originalTotalUnitPrice
         * @property {promotionsObject} promotions - could be empty
         * @property {integer} quantity
         * @property {recommendedPromotionsObject} recommendedPromotions - could be empty
         * @property {float} totalDiscountAmount
         * @property {float} totalDiscountRate
         */

        /**
         * @typedef priceObj
         * @type {object}
         * @property {string} offerId
         * @property {string} offerType
         * @property {ratingObject} rating associative array indexed by currency country e.g. rating['USD']
         */

        /**
         * This will return a list of pricing information from the ratingsEngine
         *
         * @param {string[]} offerIdList list of offers for which to retrieve price
         * @param {string} country 3-letter country
         * @param {string} currency a currrency code, e.g. 'USD', 'CAD'
         * @return {promise<module:Origin.module:games~priceObj[]>} responsename a promise for a list of priceObject
         */
        getPrice: function(offerIdList, country, currency) {
            return getPricingList(offerIdList, currency);
        },
        /**
         * Fetch the formatting rules for each locale from the server.
         *
         * @return {Promise} The HTTP response promise
         */
        getPricingFormatter: getPricingFormatter,

        /**
         * @typedef bundlePromotionsObj
         * @type {object}
         * @param {string} promotionRuleId
         * @param {float} discountAmount
         * @param {float} discountRate
         * @param {string} promotionRuleType
         */

        /**
         * @typedef bundleRatingObj
         * @type {object}
         * @property {float} finalTotalPrice
         * @property {float} originalTotalPrice
         * @property {float} originalTotalUnitPrice
         * @property {bundlePromotionsObject} promotions - could be empty
         * @property {integer} quantity
         * @property {recommendedPromotionsObject} recommendedPromotions - could be empty
         * @property {float} totalDiscountAmount
         * @property {float} totalDiscountRate
         */

        /**
         * @typedef lineitemPriceObj
         * @type {object}
         * @property {string} bundleType
         * @property {bundleRatingObj} rating
         */

        /**
         * @typedef bundlePriceObj
         * @type {object}
         * @property {boolean} isComplete
         * @property {lineitemPriceObj[]} lineitems;
         */

        /**
         * This will return a promise for the ODC profile data
         *
         * @param {string} odcProfile the ODC profile ID
         * @param {string} language The two-letter language code, i.e. 'en'
         * @return {promise<Object>} responsename ODC data for the given ODC profile
         *
         */
        getOdcProfile: function(odcProfile, language) {
            var endPoint = urls.endPoints.odcProfile;
            var config = {
                atype: 'GET',
                headers: [{
                    'label': 'Accept',
                    'val': 'application/json; x-cache/force-write'
                }],
                parameters: [{
                    'label': 'profile',
                    'val': odcProfile
                }, {
                    'label': 'language',
                    'val': language
                }],
                appendparams: [],
                reqauth: false,
                requser: false,
                responseHeader: false
            };

            return dataManager.enQueue(endPoint, config, 0)
                .catch(errorhandler.logAndCleanup('GAMES:getOdcProfile FAILED'));
        },

    };
});

define('modules/games/cart',[
    'promise',
    'core/auth',
    'core/logger',
    'core/user',
    'core/urls',
    'core/dataManager',
    'core/errorhandler',
    'core/anonymoustoken'
], function(Promise, auth, logger, user, urls, dataManager, errorhandler, anonymousToken) {
    /**
     * @module module:cart
     * @memberof module:Origin
     */
    'use strict';
    var CLIENT_ID = 'ORIGIN_JS_SDK',
        CLIENT_SECRET = '68BEdbSaTQEQba8DvV2RGbNl9KRrY5stIN1IDVjPwm1ycRea3u9nlKCcuHD1uQybjQK7s2j4M3E7V1J8',
        ACCEPT_TYPE = 'application/json',
        REQUESTOR_ID = 'Ebisu-Platform',
        subReqNum = 0;

    // expose dataManager functions
    var addParameter = dataManager.addParameter,
        appendParameter = dataManager.appendParameter,
        addHeader = dataManager.addHeader,
        addAuthHint = dataManager.addAuthHint,
        enQueue = dataManager.enQueue,
        validateDataObject = dataManager.validateDataObject;

    /**
     * Object contract for passing offer data to addOffer
     *
     * required:
     * - offerIdList {Array}            array of offer IDs
     * - bundleType {String}            bundle type
     * - bundlePromotionRuleId {String} bundle promotion ID
     * - cartName {String}              cart name
     * - storeId {String}               store ID
     * - currency {String}              cart currency
     *
     * optional:
     * - needClearCart {String}         clear cart before adding offer (true/false)
     */
    var addOfferDataContract = {
        required: ['offerIdList', 'bundleType', 'bundlePromotionRuleId', 'cartName', 'storeId', 'currency', 'countryCode'],
        optional: ['needClearCart']
    };
    /**
     * Add offer to cart
     * @param  {Object} data data object defined by addOfferDataContract
     * @return {Object}             Cart response
     */
    function addOffer(data) {
        return getAuthorization().then(function(token) {
            var authHint = buildAuthHint('Authorization', 'Bearer {token}'),
                addHeaders = {
                    Authorization: token,
                    'client_secret': CLIENT_SECRET
                },
                addParameters = {},
                appendParameters = {
                    storeId: data.storeId,
                    currencyCode: data.currency,
                    needFullCartInfo: 'true',
                    needClearCart: data.needClearCart,
                    countryCode: data.countryCode
                },
                requestBody = {},
                offerList = [];

            for(var i=data.offerIdList.length-1; i >= 0;i--) {
                offerList.push({
                    offerId: data.offerIdList[i],
                    quantity: 1
                });
            }

            requestBody.offers = {offer: offerList};
            requestBody.bundleType = data.bundleType || '';
            requestBody.bundlePromotionRuleId = data.bundlePromotionRuleId || '';

            return makeRequest('addOffer', 'POST', urls.endPoints.cartAddOffer, data, addOfferDataContract, addHeaders, addParameters, appendParameters, authHint, requestBody);
        });
    }

    /**
     * Object contract for passing data to removeOffer
     *
     * required:
     * - offerEntryID {String}  offer entry ID to remove from cart
     * - cartName {String}      cart name
     * - storeId {String}       store ID
     */
    var removeOfferDataContract = {
        required: ['offerEntryId', 'cartName', 'storeId', 'countryCode']
    };
    /**
     * Remove offer from cart
     * @param  {Object} data data object defined by removeOfferDataContract
     * @return {Object}             Cart response
     */
    function removeOffer(data) {
        return getAuthorization().then(function(token) {
            var authHint = buildAuthHint('Authorization', 'Bearer {token}'),
                addHeaders = {
                    Authorization: token,
                    'client_secret': CLIENT_SECRET
                },
                addParameters = {offerEntryId: data.offerEntryId},
                appendParameters = {
                    storeId: data.storeId,
                    needFullCartInfo: 'true',
                    countryCode: data.countryCode
                };

            return makeRequest('removeOffer', 'DELETE', urls.endPoints.cartRemoveOffer, data, removeOfferDataContract, addHeaders, addParameters, appendParameters, authHint);
        });
    }

    /**
     * Object contract for passing data to addCoupon
     *
     * required:
     * - cartName {String}      cart name
     * - storeId {String}       store ID
     * - couponCode {String}    coupon code
     */
    var addCouponDataContract = {
        required: ['couponCode', 'cartName', 'storeId', 'countryCode']
    };
    /**
     * Add coupon to cart
     * @param  {dataContractObject} data data object defined by addCouponDataContract
     * @return {Object}             Cart response
     */
    function addCoupon(data) {
        return getAuthorization().then(function(token) {
            var authHint = buildAuthHint('Authorization', 'Bearer {token}'),
                addHeaders = {
                    Authorization: token,
                    'client_secret': CLIENT_SECRET
                },
                addParameters = {},
                appendParameters = {
                    storeId: data.storeId,
                    currencyCode: data.currency,
                    needFullCartInfo: 'true',
                    countryCode: data.countryCode
                },
                requestBody = {couponCode: data.couponCode};

            return makeRequest('addCoupon', 'POST', urls.endPoints.cartAddCoupon, data, addCouponDataContract, addHeaders, addParameters, appendParameters, authHint, requestBody);
        });
    }

    /**
     * Object contract for passing data to removeCoupon
     *
     * required:
     * - couponEntryID {String}  coupon entry ID to remove from cart
     * - cartName {String}       cart name
     * - storeId {String}        store ID
     * - currency {String}       cart currency
     */
    var removeCouponDataContract = {
        required: ['couponEntryId', 'cartName', 'storeId', 'currency', 'countryCode']
    };
    /**
     * Remove coupon from cart
     * @param  {dataContractObject} data data object defined by removeCouponDataContract
     * @return {Object}             Cart response
     */
    function removeCoupon(data) {
        return getAuthorization().then(function(token) {
            var authHint = buildAuthHint('Authorization', 'Bearer {token}'),
                addHeaders = {
                    Authorization: token,
                    'client_secret': CLIENT_SECRET
                },
                addParameters = {couponEntryId: data.couponEntryId},
                appendParameters = {
                    storeId: data.storeId,
                    needFullCartInfo: 'true',
                    countryCode: data.countryCode
                };

            return makeRequest('removeCoupon', 'DELETE', urls.endPoints.cartRemoveCoupon, data, removeCouponDataContract, addHeaders, addParameters, appendParameters, authHint);
        });
    }

    /**
     * Object contract for passing data to getCart
     *
     * required:
     * - cartName {String}      cart name
     * - storeId {String}       store ID
     * - currency {String}      cart currency
     */
    var getCartDataContract = {
        required: ['cartName', 'storeId', 'currency', 'countryCode']
    };
    /**
     * Get cart
     * @param  {dataContractObject} data data object defined by getCartDataContract
     * @return {Object}             Cart response
     */
    function getCart(data) {
        return getAuthorization().then(function(token) {
            var authHint = buildAuthHint('Authorization', 'Bearer {token}'),
                addHeaders = {
                Authorization: token,
                'client_secret': CLIENT_SECRET
            },
            addParameters = {},
            appendParameters = {
                storeId: data.storeId,
                currency: data.currency,
                needFullCartInfo: 'true',
                countryCode: data.countryCode
            };
            return makeRequest('getCart', 'GET', urls.endPoints.cartGetCart, data, getCartDataContract, addHeaders, addParameters, appendParameters, authHint);
        });

    }

    /**
     * Object contract for passing data to mergeCart
     *
     * required:
     * - anonymousToken {String} raw token of initial anonymous cart
     * - cartName {String}       cart name
     * - sourcePidId {String}    pidId of initial anonymous cart
     */
    var mergeCartDataContract = {
        required: ['cartName', 'sourcePidId', 'anonymousToken', 'countryCode']
    };
    /**
     * Merge carts
     * @param  {dataContractObject} data data object defined by mergeCartDataContract
     * @return {Object}             Cart response
     */
    function mergeCart(data) {
        return getAuthorization().then(function(token) {
            var authHint = buildAuthHint('Authorization', 'Bearer {token}'),
                addHeaders = {
                    Authorization: token,
                    'anonymous_token': data.anonymousToken,
                    'client_secret': CLIENT_SECRET
                },
                addParameters = {},
                appendParameters = {
                    sourcePidId: data.sourcePidId,
                    action: 'merge',
                    needFullCartInfo: 'true',
                    countryCode: data.countryCode
                };

            return makeRequest('mergeCart', 'POST', urls.endPoints.cartOperation, data, mergeCartDataContract, addHeaders, addParameters, appendParameters, authHint);
        });
    }

    /**
     * Object contract for passing data to clearCart
     *
     * required:
     * - cartName {String}        cart name
     */
    var clearCartDataContract = {
        required: ['cartName', 'countryCode']
    };
    /**
     * Clear cart
     * @param  {dataContractObject} data data object defined by clearCartDataContract
     * @return {Object}             Cart response
     */
    function clearCart(data) {
        return getAuthorization().then(function(token) {
            var authHint = buildAuthHint('Authorization', 'Bearer {token}'),
                addHeaders = {
                    Authorization: token,
                    'client_secret': CLIENT_SECRET
                },
                addParameters = {},
                appendParameters = {
                    action: 'close',
                    needFullCartInfo: 'true',
                    countryCode: data.countryCode
                };

            return makeRequest('clearCart', 'POST', urls.endPoints.cartOperation, data, clearCartDataContract, addHeaders, addParameters, appendParameters, authHint);
        });
    }


    /**
     * Object contract for setCartProperties
     *
     * required:
     * - cartName {String}  cart name
     * - property {Array} array of properties objects
     */
    var setCartPropertiesDataContract = {
        required: ['cartName', 'property']
    };
    /**
     * Set Cart Properties
     * @param  {dataContractObject} data data object defined by setCartPropertiesDataContract
     * @return {Object}             Cart response
     */
    function setCartProperties(data) {
        return getAuthorization().then(function(token) {
            var authHint = buildAuthHint('Authorization', 'Bearer {token}'),
                addHeaders = {
                    Authorization: token,
                    'client_secret': CLIENT_SECRET
                },
                addParameters = {},
                appendParameters = {
                    needFullCartInfo: 'true'
                },
                requestBody = {};

            requestBody.property = data.property || {};

            return makeRequest('setCartProperties', 'PUT', urls.endPoints.cartPutProperties, data, setCartPropertiesDataContract, addHeaders, addParameters, appendParameters, authHint, requestBody);
        });
    }

    // private

    /**
     * If the user is logged in returns their access token otherwise returns a anonymous access token.
     * @return {string} The Access token
     */
    function getAuthorization(){
        return new Promise(function(resolve) {
            var authorization = user.publicObjs.accessToken();
            if(authorization){
                resolve('Bearer '  + authorization);
            } else {
                anonymousToken.getAnonymousToken().then(function(token) {
                    resolve('Anon ' + token.getId());
                });
            }
        });
    }

    /**
     * Performs service request
     * @param  {String} requestName      Type of request to make
     * @param  {String} method           Http method - POST, GET, etc
     * @param  {String} endPoint         Service endpoint
     * @param  {Object} data             data object defined by dataContract
     * @param  {Object} dataContract     data contract object
     * @param  {Object} addHeaders       headers to add to request
     * @param  {Object} addParameters    replacement parameters to add to request
     * @param  {Object} appendParameters query string parameters to add to request
     * @param  {Object} authHint         Auth token hinting for use during re-auth/re-try
     * @param  {Object} requestBody      request body object (optional)
     * @return {Object}                  Cart response
     */
    function makeRequest(requestName, method, endPoint, data, dataContract, addHeaders, addParameters, appendParameters, authHint, requestBody) {
        data = validateDataObject(dataContract, data);
        if (data === false) {
            return errorhandler.logAndCleanup('CART:'+requestName+' VALIDATION FAILED');
        }

        var config = initCartConfig(method, data.cartName, data.storeId, data.currency),
            prop;

        addHeaders = addHeaders || {};
        addParameters = addParameters || {};
        appendParameters = appendParameters || {};
        requestBody = requestBody || {};

        for (prop in addHeaders) {
            if(addHeaders.hasOwnProperty(prop)) {
                addHeader(config, prop, addHeaders[prop]);
            }
        }

        for (prop in addParameters) {
            if(addParameters.hasOwnProperty(prop)) {
                addParameter(config, prop, addParameters[prop]);
            }
        }

        for (prop in appendParameters) {
            if(appendParameters.hasOwnProperty(prop)) {
                appendParameter(config, prop, appendParameters[prop]);
            }
        }

        if (addHeaders.hasOwnProperty('Authorization') && addHeaders.Authorization.substring(0, 4) === 'Anon') {
            // this parameter will be removed eventually when the requirement is removed
            // in favor of relying on the Authorizaation header to determine if a request
            // is authenticated or not.
            appendParameter(config, 'isAnonymous', 'true');
            config.reqauth = false;
            config.requser = false;
        }

        config.body = JSON.stringify(requestBody);

        if (authHint && authHint.hasOwnProperty('property') && authHint.hasOwnProperty('format')) {
            addAuthHint(config, authHint.property, authHint.format);
        }

        return enQueue(endPoint, config, subReqNum)
            .then(function(response){
                if (response && response.hasOwnProperty ('cartInfo')) {
                    return response.cartInfo;
                }
                return response;
            })
            .catch(errorhandler.logAndCleanup('CART:'+requestName+' FAILED'));
    }

    /**
     * Initialize request config object
     * @param  {String} type          Http request method (GET, POST, etc)
     * @param  {String cartName       Cart name
     * @param  {String} storeId       Store ID
     * @param  {String} currency      Currency code (CAD, USD, etc)
     * @param  {Boolean} requiresAuth Requires auth
     * @param  {Boolean} requiresUser Requires user
     * @return {Object}               Service request config object
     */
    function initCartConfig(type, cartName, storeId, currency, requiresAuth, requiresUser) {
        requiresAuth = requiresAuth || true;
        requiresUser = requiresUser || true;

        var config = {
                atype: type,
                headers: [{
                    'label': 'accept',
                    'val' : ACCEPT_TYPE
                }, {
                    'label': 'Nucleus-RequestorId',
                    'val': REQUESTOR_ID
                }, {
                    'label': 'X-CART-REQUESTORID',
                    'val': REQUESTOR_ID
                }, {
                    'label': 'client_id',
                    'val': CLIENT_ID
                }],
                parameters: [{
                    'label': 'cartName',
                    'val': cartName
                }, {
                    'label': 'storeId',
                    'val': storeId
                }, {
                    'label': 'currency',
                    'val': currency
                }],

                reqauth: requiresAuth,
                requser: requiresUser
            };

        return config;
    }

    /**
     * Build authHint object
     * @param  {string} property Authentication header name
     * @param  {string} format   Authentication header value format - use {token} as placeholder.
     * @return {object}          authHint object
     */
    function buildAuthHint(property, format) {
        return {property: property, format: format};
    }

    return /** @lends module:Origin.module:cart */{

        /**
         * This is the cart response object.
         *
         * @typedef cartResponse
         * @type {object}
         * @property {object} shippingInfo physical shipping info
         * @property {number} totalNumberOfItems Number of items in the cart
         * @property {string} currency Currency of cart
         * @property {float} totalPriceWithoutTax Total price of cart without tax
         * @property {float} totalDiscountRate Rate of discount
         * @property {float} totalDiscountAmount Dollar value of discount
         * @property {number} checkoutToken Checkout token
         * @property {number} pidId User pidId of cart owner
         * @property {string} cartName Name of cart
         * @property {string} storeId Store ID
         * @property {number} updatedDateTime Update time in seconds
         * @property {number} createdDateTime Created time in seconds
         * @property {object[]} offerEntry List of offer entry objects
         * @property {object[]} discountLineItem List of line item discount objects
         * @property {object[]} couponEntry List of coupon entry objects
         *
         */

        /**
         * This is a data contract object used to ensure that the data that is
         * passed to the method is valid.
         *
         * @typedef dataContractObject
         * @type {object}
         * @property {string[]} required a list of required object properties
         * @property {string[]} optional a list of optional object properties
         */

        /**
         * Add offer to cart<br>
         * <br>
         * Object contract for passing offer data to addOffer:<br>
         * <br>
         * Required:<br>
         * - offerIdList {Array}            array of offer IDs<br>
         * - bundleType {String}            bundle type<br>
         * - bundlePromotionRuleId {String} bundle promotion ID<br>
         * - cartName {String}              cart name<br>
         * - storeId {String}               store ID<br>
         * - currency {String}              cart currency<br>
         * <br>
         * Optional:<br>
         * - needClearCart {String}         clear cart before adding offer (true/false)<br><br>
         *
         * @param {dataContractObject} data data object defined by addOfferDataContract
         * @return {promise<module:Origin.module:cart~cartResponse>} responsename response from cart service
         * @method
         */
        addOffer: addOffer,

        /**
         * Remove offer from cart<br>
         * <br>
         * Object contract for passing data to removeOffer:<br>
         * <br>
         * Required:<br>
         * - cartName {String}      cart name<br>
         * - storeId {String}       store ID<br>
         * - currency {String}      cart currency<br>
         * - offerEntryID {String}  offer Entry ID to remove from cart<br><br>
         *
         * @param {dataContractObject} data data object defined by removeOfferDataContract
         * @return {promise<module:Origin.module:cart~cartResponse>} responsename response from cart service
         * @method
         */
        removeOffer: removeOffer,

        /**
         * Add coupon to cart<br>
         *<br>
         * Object contract for passing data to addCoupon:<br>
         *<br>
         * Required:<br>
         * - cartName {String}      cart name<br>
         * - storeId {String}       store ID<br>
         * - couponCode {String}    coupon code<br><br>
         *
         * @param {dataContractObject} data data object defined by addCouponDataContract
         * @return {promise<module:Origin.module:cart~cartResponse>} responsename response from cart service
         * @method
         */
        addCoupon: addCoupon,

        /**
         * Remove coupon from cart<br>
         * <br>
         * Object contract for passing data to removeCoupon:<br>
         *<br>
         * Required:<br>
         * - couponEntryID {String}  offer Entry ID to remove from cart<br>
         * - cartName {String}       cart name<br>
         * - storeId {String}        store ID<br>
         * - currency {String}       cart currency<br><br>
         *
         * @param {dataContractObject} data data object defined by removeCouponDataContract
         * @return {promise<module:Origin.module:cart~cartResponse>} responsename response from cart service
         * @method
         */
        removeCoupon: removeCoupon,

        /**
         * Get cart<br>
         *<br>
         * Object contract for passing data to getCart:<br>
         *<br>
         * Required:<br>
         * - cartName {String}      cart name<br>
         * - storeId {String}       store ID<br>
         * - currency {String}      cart currency<br><br>
         *
         * @param {dataContractObject} data data object defined by getCartDataContract
         * @return {promise<module:Origin.module:cart~cartResponse>} responsename response from cart service
         * @method
         */
        getCart: getCart,

        /**
         * Merge anonymous cart with authenticated cart<br>
         *<br>
         * Object contract for passing data to mergeCart:<br>
         *<br>
         * Required:<br>
         * - anonymousToken {String} raw token of initial anonymous cart<br>
         * - cartName {String}       cart name<br>
         * - sourcePidId {String}    pidId of initial anonymous cart<br><br>
         *
         * @param {dataContractObject} data data object defined by mergeCartDataContract
         * @return {promise<module:Origin.module:cart~cartResponse>} responsename response from cart service
         * @method
         */
        mergeCart: mergeCart,


        /**
         * Clear cart contents (maintains cart)<br>
         *<br>
         * Object contract for passing data to clearCart:<br>
         *<br>
         * Required:<br>
         * - cartName {String}        cart name<br><br>
         *
         * @param {dataContractObject} data data object defined by clearCartDataContract
         * @return {promise<module:Origin.module:cart~cartResponse>} responsename response from cart service
         * @method
         */
        clearCart: clearCart,

        /**
         * Add properties to cart<br>
         * <br>
         * Object contract for passing property data to setCartProperties:<br>
         * <br>
         * Required:<br>
         * - cartName {String}              cart name<br>
         * - properties {Array}             array of property objects, which include namespace, name, and value<br>
         *
         * @param {dataContractObject} data data object defined by setCartPropertiesDataContract
         * @return {promise<module:Origin.module:cart~cartResponse>} responsename response from cart service
         * @method
         */
        setCartProperties: setCartProperties
    };
});

/*jshint unused: false */
/*jshint strict: false */
define('modules/games/lmd',[
    'modules/client/client',
    'core/logger'
], function(client, logger) {
    //need to set all localStorage entries to be dirty to force retrieval of LMD
    function markAllLMDdirty() {
        //do this only if we're online
        var online = true;
        if (client.isEmbeddedBrowser()) {
            online = client.onlineStatus.isOnline();
        }
        if (online) {
            try {
                for (var i = 0; i < localStorage.length; i++) {
                    if (localStorage.key(i).indexOf('lmd_') === 0) {
                        var lmdEntryStr = localStorage.getItem(localStorage.key(i));
                        var offerCacheInfo = JSON.parse(lmdEntryStr);
                        //mark it as dirty
                        offerCacheInfo.dirty = true;

                        var jsonS = JSON.stringify(offerCacheInfo);
                        localStorage.setItem(localStorage.key(i), jsonS);
                    }
                }
            } catch (error) {
                logger.error('Cannot set local storage item for LMD', error.message);
            }
        }
    }
    return {
        markAllLMDdirty: markAllLMDdirty
    };
});
/*jshint unused: false */
/*jshint strict: false */
define('modules/games/trial',[
    'promise',
    'core/logger',
    'core/user',
    'core/urls',
    'core/dataManager',
    'core/errorhandler',
    'core/locale',
    'core/utils',
    'modules/client/client'
], function(Promise, logger, user, urls, dataManager, errorhandler, locale, utils, client) {
    /**
     * @module module:trial
     * @memberof module:Origin
     */

    var subReqNum = 0;  //to keep track of the request #

    function getTime(contentId) {
        var token = user.publicObjs.accessToken();
        if (token.length === 0) {
            // early return if this is called when user is not authenticated
            return Promise.resolve({success: false, message: 'requires-auth'});
        }

        if (!contentId) {
            // early return if this is called without a contentId
            return Promise.resolve({success: false, message: 'requires-content-id'});
        }

        var endPoint = urls.endPoints.trialCheckTime;
        var config = {atype: 'GET', reqauth: true, requser: true };

        dataManager.addHeader(config, 'Authorization', 'Bearer '+token);
        dataManager.addAuthHint(config, 'Authorization', 'Bearer {token}');
        dataManager.addHeader(config, 'Accept', 'application/json');
        dataManager.addHeader(config, 'localeInfo', locale.locale());
        dataManager.addParameter(config, 'userId', user.publicObjs.userPid());
        dataManager.addParameter(config, 'contentId', contentId);

        return dataManager.enQueue(endPoint, config, subReqNum)
            .then(function(data){
                if (data.hasOwnProperty('checkTimeResponse')) {
                    return data.checkTimeResponse;
                } else {
                    return data;
                }
            })
            .catch(function(error){
                var errorMsg = utils.getProperty(error, ['response', 'error', 'failure', 'cause']) || 'request-failed';
                errorhandler.logAndCleanup('trial:getTime FAILED');
                return {success: false, message: errorMsg};
            });
    }

    return /** @lends module:Origin.module:trial */{

        /**
         * @typedef getTimeResponseObject
         * @type {object}
         * @property {boolean} hasTimeLeft user has time left in trial
         * @property {integer} leftTrialSec time left in trial (in seconds)
         * @property {integer} totalTrialSec total time for trial (in seconds)
         * @property {integer} totalGrantedSec total time granted (in seconds)
         */
        /**
         * Get the remaining play time for a users trial offer
         *
         * @param {string} contentId contentId of entitled offer
         * @return {promise<module:Origin.module:trial~getTimeResponseObject>} responsename getTime response object
         * @method
         */
        getTime: getTime
    };
});
/*jshint unused: false */
/*jshint strict: false */
define('modules/games/gifts',[
    'promise',
    'core/logger',
    'core/user',
    'core/urls',
    'core/dataManager',
    'core/errorhandler',
    'core/locale',
    'core/utils',
    'modules/client/client'
], function(Promise, logger, user, urls, dataManager, errorhandler, locale, utils, client) {

    var PAGE_NUMBER = 1,
        PAGE_SIZE = 500,
        subReqNum = 0;

    function processGiftingEligibilityResponse(response) {
        if (response && response.recipients) {
            return response.recipients;
        } else {
            return [];
        }
    }


    return /** @lends module:Origin.module:gifts */{

        /**
         * Activate (i.e., open) a gift by offerId
         * @param {String} giftId offer id of gift to open
         * @return {Promise<response>} response from gift activation
         */
        activateGift: function(giftId) {
            var endPoint = urls.endPoints.updateGiftStatus;
            var config = {
                atype: 'PUT',
                headers: [],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                },{
                    'label': 'giftId',
                    'val': giftId
                }],
                appendparams: [],
                reqauth: true,
                requser: true
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }

            return dataManager.enQueue(endPoint, config, subReqNum)
                .catch(errorhandler.logAndCleanup('GIFTS:activateGift FAILED'));
        },

        /**
         * @typedef giftDataObject
         * @type {object}
         * @property {string} giftId
         * @property {string} senderPersonaId
         * @property {string} status
         * @property {string} senderName
         * @property {string} message
         * @property {string} productId
         */

        /**
         * This will return a promise for the user's gifts
         *
         * @return {promise<module:Origin.module:gifts~giftDataObject[]>}
         *
         */
        getGift: function(giftId) {
            var endPoint = urls.endPoints.getGift;
            var config = {
                atype: 'GET',
                headers: [],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                },
                {
                    'label': 'giftId',
                    'val': giftId
                }],
                reqauth: true,
                requser: true
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }

            return dataManager.enQueue(endPoint, config, subReqNum)
                .catch(errorhandler.logAndCleanup('GIFTS:getGift FAILED'));
        },

        /**
         * @typedef giftDataObject
         * @type {object}
         * @property {string} giftId
         * @property {string} senderPersonaId
         * @property {string} status
         * @property {string} senderName
         * @property {string} message
         * @property {string} productId
         */

        /**
         * This will return a promise for the user's gifts
         *
         * @return {promise<module:Origin.module:gifts~giftDataObject[]>}
         *
         */
         getGifts: function() {
            var endPoint = urls.endPoints.getGifts;
            var config = {
                atype: 'GET',
                headers: [],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }],
                appendparams: [{
                    'label': 'pageNo',
                    'val': PAGE_NUMBER
                },{
                    'label': 'pageSize',
                    'val': PAGE_SIZE
                }],
                reqauth: true,
                requser: true
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }

            return dataManager.enQueue(endPoint, config, subReqNum)
                .catch(errorhandler.logAndCleanup('GIFTS:getGifts FAILED'));
        },

        /**
         * Determine eligibility of recipients to receive gift from user
         * @param  {string} offerId      Offer ID to gift
         * @param  {string} recipientIds Comma-separated list of user IDs
         * @return {promise}              Recipient response
         */
        getGiftingEligibility: function(offerId, recipientIds) {
            var endPoint = urls.endPoints.giftingEligibility;
            var config = {
                atype: 'GET',
                headers: [{
                    'label': 'X-Origin-Platform',
                    'val': utils.os()
                },{
                    'label': 'Accept',
                    'val': 'application/json'
                }],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }, {
                    'label': 'recipientIds',
                    'val': recipientIds.replace(/ /g, '')
                }, {
                    'label': 'offerId',
                    'val': offerId
                }],
                reqauth: true,
                requser: true
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }

            return dataManager.enQueue(endPoint, config, 0)
                .then(processGiftingEligibilityResponse, errorhandler.logAndCleanup('ATOM:processGiftingEligibilityResponse FAILED'));
        }
    };
});
/*jshint unused: false */
/*jshint strict: false */
define('modules/settings/email',[
    'promise',
    'core/defines',
    'core/logger',
    'core/user',
    'core/auth',
    'core/events',
    'core/dataManager',
    'core/urls',
    'core/errorhandler',
], function(Promise, defines, logger, user, auth, events, dataManager, urls, errorhandler) {

    /**
     * @module module:email
     * @memberof module:Origin.module:settings
     */
    function handleSendEmailVerificationResponse(response) {
        return response;
    }

    function sendEmailVerification() {
        var endPoint = urls.endPoints.sendEmailVerification;
        var config = {
            atype: 'POST',
            headers: [{
                'Content-Type': 'application/x-www-form-urlencoded'
            }],
            parameters: [],
            appendparams: [],
            reqauth: true,
            requser: false,
            responseHeader: false
        };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'accessToken', token);
        }

        return dataManager.enQueue(endPoint, config)
            .then(handleSendEmailVerificationResponse, errorhandler.logAndCleanup('GETSTARTED:sendEmailVarification FAILED'));
    }

    function handleSendOptinEmailSettingResponse(response) {
        return response;
    }

    function sendOptinEmailSetting() {
        var endPoint = urls.endPoints.optinToOriginEmail;
        var config = {
            atype: 'POST',
            headers: [{
                'Content-Type': 'application/x-www-form-urlencoded'
            }],
            parameters: [{
                'label': 'pid',
                'val': user.publicObjs.userPid()
            }],
            appendparams: [],
            reqauth: true,
            requser: true,
            responseHeader: false
        };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'Authorization', 'Bearer ' + token);
        }

        return dataManager.enQueue(endPoint, config)
            .then(handleSendOptinEmailSettingResponse, errorhandler.logAndCleanup('GETSTARTED:sendOptinEmailSetting FAILED'));
    }

    return /** @lends module:Origin.module:settings.module:email */ {

        /**
         * Makes a request to send the user a verification email to the address attached to the user's account
         * @method
        */
        sendEmailVerification: sendEmailVerification,
        /**
         * Makes a request to sign the user up for origin emails
         * @method
        */
        sendOptinEmailSetting: sendOptinEmailSetting,
    };
});
/*jshint unused: false */
/*jshint strict: false */
define('modules/settings/settings',[
    'promise',
    'core/defines',
    'core/logger',
    'core/user',
    'core/auth',
    'core/events',
    'core/dataManager',
    'core/urls',
    'core/errorhandler',
    'modules/settings/email',
], function(Promise, defines, logger, user, auth, events, dataManager, urls, errorhandler, email) {

    /**
     * @module module:settings
     * @memberof module:Origin
     */
    function retrieveUserSettings(category) {
        /*
        possible categories:
        ACCOUNT,
        GENERAL,
        NOTIFICATION,
        INGAME,
        HIDDENGAMES,
        FAVORITEGAMES,
        TELEMETRYOPTOUT,
        ENABLEIGO,
        ENABLECLOUDSAVING,
        BROADCASTING;
        */
        var endPoint = urls.endPoints.settingsData,
            token = user.publicObjs.accessToken(),
            requestConfig = {
                atype: 'GET',
                headers: [{
                    'label': 'Accept',
                    'val': 'x-cache/force-write'
                }],
                parameters: [],
                appendparams: [],
                reqauth: true,
                requser: false
            };

        //we need to substitute
        endPoint = endPoint.replace('{userId}', user.publicObjs.userPid());
        if (category) {
            endPoint += '/' + category;
        }
        if (token.length > 0) {
            dataManager.addHeader(requestConfig, 'AuthToken', token);
        }

        return dataManager.enQueue(endPoint, requestConfig, 0)
            .catch(errorhandler.logAndCleanup('SETTINGS:retrieveUserSettings FAILED'));
    }

    function postUserSettings(category, value) {
        /*
        possible categories:
        ACCOUNT,
        GENERAL,
        NOTIFICATION,
        INGAME,
        HIDDENGAMES,
        FAVORITEGAMES,
        TELEMETRYOPTOUT,
        ENABLEIGO,
        ENABLECLOUDSAVING,
        BROADCASTING;
        */
        var endPoint = urls.endPoints.settingsData;

        //we need to substitute
        endPoint = endPoint.replace('{userId}', user.publicObjs.userPid());

        if (category) {
            endPoint += '/' + category;
        }

        var requestConfig = {
            atype: 'POST',
            headers: [],
            parameters: [],
            appendparams: [],
            reqauth: true,
            requser: false
        };

        var token = user.publicObjs.accessToken();

        if (token.length > 0) {
            dataManager.addHeader(requestConfig, 'AuthToken', token);
        }


        requestConfig.body = value;


        var promise = dataManager.enQueue(endPoint, requestConfig, 0);
        return promise
            .catch(errorhandler.logAndCleanup('SETTINGS:postUserSettings FAILED'));
    }

    return /** @lends module:Origin.module:settings */ {

        /**
         * This will return a promise for the requested user settings from server
         *
         * @return {promise}  response returns the current settings as key value pairs in JSON format
         * @method
         */
        retrieveUserSettings: retrieveUserSettings,

        /**
         * This will return a promise for the posted user settings
         *
         * @param  {string} category The category we want to post to
         * @param  {string} value    The payload
         * @return {promise}  response returns the current settings as key value pairs in JSON format
         * @method
         */
        postUserSettings: postUserSettings,

        email: email
    };
});
/*jshint unused: false */
/*jshint strict: false */

define('modules/social/atom',[
    'promise',
    'core/logger',
    'core/user',
    'core/dataManager',
    'core/urls',
    'core/errorhandler',
    'core/utils'
], function(Promise, logger, user, dataManager, urls, errorhandler, utils) {

    /**
     * @module module:atom
     * @memberof module:Origin
     */
    function processAtomUserInfoResponse(response) {
        //if only one user was specified, then it returns the response as users.user.avatar
        //but if more than one user was specified, it returns the response as users.user[].avatar
        //so we need to convert the single user case into returning it as an array (of one element) too.
        if (!(response.users.user instanceof Array)) {
            response.users.user = [response.users.user];
        }

        return response.users.user;
    }

    function processAtomGameUsageResponse(response) {
        return response.usage;
    }

    function processAtomLastPlayedResponse(response) {
        var returnObj = response.lastPlayedGames.lastPlayed;

        //when converting from xml to JSON we don't figure out its an array so we check here
        if (Object.prototype.toString.call(response.lastPlayedGames.lastPlayed) !== '[object Array]') {
            returnObj = [response.lastPlayedGames.lastPlayed];
        }

        return returnObj;
    }

    function processAtomGamesOwnedForUserResponse(response) {
        if (!!response && !!response.productInfoList && !!response.productInfoList.productInfo) {
            if (!(response.productInfoList.productInfo instanceof Array)) {
                response.productInfoList.productInfo = [response.productInfoList.productInfo];
            }
            return response.productInfoList.productInfo;
        } else {
            return [];
        }
    }

    function processAtomFriendsForUserResponse(response) {
        if (!!response && !!response.users && !!response.users.user) {
            if (!(response.users.user instanceof Array)) {
                response.users.user = [response.users.user];
            }
            return response.users.user;
        } else {
            return [];
        }
    }

    function processAtomFriendCountForUserResponse(response) {
        if (!!response && !!response.friendsCount && !!response.friendsCount.count) {
            return response.friendsCount.count;
        } else {
            return 0;
        }
    }

    return /** @lends module:Origin.module:atom */ {

        /**
         * user info for a single user
         * @typedef atomUserInfoObject
         * @type {object}
         * @property {string} userId
         * @property {string} personaId
         * @property {string} originId
         * @property {string} firstName
         * @property {string} lastName
         */



        /**
         * This will return a promise for the atom user info for each user in the userId list
         *
         * @param {Object} list of userIds, separate by ;
         * @return {promise<module:Origin.module:atom~atomUserInfoObject[]>} name array of atomUserInfoObjects
         */
        atomUserInfoByUserIds: function (userIdList) {

            var endPoint = urls.endPoints.atomUsers;

            var config = {
                atype: 'GET',
                headers: [{
                    'label': 'Accept',
                    'val': 'x-cache/force-write'
                }],
                parameters: [{
                    'label': 'userIdList',
                    'val': userIdList
                }],
                appendparams: [],
                reqauth: true,
                requser: false
            };

            //need to add via addHeader so it will get suppressed when offline to prevent OPTIONS call
            dataManager.addHeader(config, 'X-Origin-Platform', utils.os());

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }

            return dataManager.enQueue(endPoint, config, 0)
                .then(processAtomUserInfoResponse, errorhandler.logAndCleanup('ATOM:atomUserInfoByUserIds FAILED'));

        },

        /**
         * game usage info
         * @typedef atomGameUsageObject
         * @type {object}
         * @property {string} gameId
         * @property {string} total
         * @property {string} lastSession
         * @property {string} lastSessionEndTimeStamp in epoch time
         */

        /**
         * This will return a promise for the atom user info for each user in the userId list
         *
         * @param {String} masterTitleId
         * @param {String} multiplayerId
         * @return {promise<module:Origin.module:atom~atomGameUsageObject[]>} name array of atomUserInfoObjects
         */
        atomGameUsage: function (masterTitleId, multiplayerId) {
            var endPoint = urls.endPoints.atomGameUsage;

            var config = {
                atype: 'GET',
                headers: [{
                    'label': 'X-Origin-Platform',
                    'val': utils.os()
                }],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }, {
                    'label': 'masterTitleId',
                    'val': masterTitleId
                }],
                appendparams: [],
                reqauth: true,
                requser: true
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }

            if (multiplayerId) {
                config.headers.push({
                    'label': 'MultiplayerId',
                    'val': multiplayerId
                });
            }

            return dataManager.enQueue(endPoint, config, 0)
                .then(processAtomGameUsageResponse, errorhandler.logAndCleanup('ATOM:processAtomGameUsageResponse FAILED'));
        },

        /**
         * game lastplayed info
         * @typedef atomGameLastPlayedObject
         * @type {object}
         * @property {string} userId
         * @property {string} masterTitleId
         * @property {string} timestamp
         */

        /**
         * This will return a promise for the last played game of the current user
         *
         * @return {promise<module:Origin.module:atom~atomGameLastPlayedObject>}  atomGameLastPlayedObject
         */
        atomGameLastPlayed: function () {
            var endPoint = urls.endPoints.atomGameLastPlayed;

            var config = {
                atype: 'GET',
                headers: [{
                    'label': 'X-Origin-Platform',
                    'val': utils.os()
                }],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }],
                appendparams: [],
                reqauth: true,
                requser: true
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }

            return dataManager.enQueue(endPoint, config, 0)
                .then(processAtomLastPlayedResponse, errorhandler.logAndCleanup('ATOM:processAtomLastPlayedResponse FAILED'));

        },


        /**
         * owned games for user
         * @typedef atomGamesOwnedForUserObject
         * @type {object}
         * @property {string} productId
         * @property {string} displayProductName
         * @property {string} cdnAssetRoot
         * @property {string} packArtSmall
         * @property {string} packArtMedium
         * @property {string} packArtLarge
         */

        /**
         * This will return a promise for the games owned by the specified userId
         *
         * @param {String} userId
         * @return {promise<module:Origin.module:atom~atomGamesOwnedForUserObject[]>} name array of atomGamesOwnedForUserObjects
         */
        atomGamesOwnedForUser: function (userId) {
            var endPoint = urls.endPoints.atomGamesOwnedForUser;

            var config = {
                atype: 'GET',
                headers: [{
                    'label': 'X-Origin-Platform',
                    'val': utils.os()
                }],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }, {
                    'label': 'otherUserId',
                    'val': userId
                }],
                appendparams: [],
                reqauth: true,
                requser: true
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }

            return dataManager.enQueue(endPoint, config, 0)
                .then(processAtomGamesOwnedForUserResponse, errorhandler.logAndCleanup('ATOM:processAtomGamesOwnedForUserResponse FAILED'));
        },

        /**
         * friends for user
         * @typedef atomFriendsForUserObject
         * @type {object}
         * @property {string} userId
         */

        /**
         * This will return a promise for the friends of the specified userId for the specified page number (pages are 50 users long)
         *
         * @param {String} userId
         * @param {String} page
         * @return {promise<module:Origin.module:atom~atomFriendsForUserObject[]>} name array of atomFriendsForUserObjects
         */
        atomFriendsForUser: function (userId, page) {
            var endPoint = urls.endPoints.atomFriendsForUser;

            var config = {
                atype: 'GET',
                headers: [{
                    'label': 'X-Origin-Platform',
                    'val': utils.os()
                }],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }, {
                    'label': 'otherUserId',
                    'val': userId
                }, {
                    'label': 'page',
                    'val': page
                }],
                appendparams: [],
                reqauth: true,
                requser: true
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }

            return dataManager.enQueue(endPoint, config, 0)
                .then(processAtomFriendsForUserResponse, errorhandler.logAndCleanup('ATOM:processAtomFriendsForUserResponse FAILED'));
        },

        /**
         * friend count for user
         * @typedef atomFriendCountForUserObject
         * @type {object}
         */

        /**
         * This will return a promise for the friend count of the specified userId
         *
         * @param {String} userId
         * @return {promise<module:Origin.module:atom~atomFriendCountForUserObject>} name atomFriendCountForUserObject
         */
        atomFriendCountForUser: function (userId) {
            var endPoint = urls.endPoints.atomFriendCountForUser;

            var config = {
                atype: 'GET',
                headers: [{
                    'label': 'X-Origin-Platform',
                    'val': utils.os()
                }],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }, {
                    'label': 'otherUserId',
                    'val': userId
                }],
                appendparams: [],
                reqauth: true,
                requser: true
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }

            return dataManager.enQueue(endPoint, config, 0)
                .then(processAtomFriendCountForUserResponse, errorhandler.logAndCleanup('ATOM:processAtomFriendCountForUserResponse FAILED'));
        },


        /**
         * This will return a promise for the user abuse report response
         *
         * @param {String} userId userId to report
         * @param {String} location Location of the offense (ie "In Game")
         * @param {String} reason Reason for the report (ie "Cheating")
         * @param {String} comment User-specified comment (optional)
         * @param {String} masterTitle Master Title of the game that the offense occured if it occurred in-game (optional)
         * @return {promise} response raw response
         */
        atomReportUser: function (userId, location, reason, comment, masterTitle) {
            var endPoint = urls.endPoints.atomReportUser;

            var config = {
                atype: 'POST',
                headers: [{
                    'label': 'X-Origin-Platform',
                    'val': utils.os()
                }],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }, {
                    'label': 'otherUserId',
                    'val': userId
                }],
                appendparams: [],
                reqauth: true,
                requser: true
            };

            comment = !!comment ? comment : '';
            masterTitle = !!masterTitle ? masterTitle : '';

            var contentTypeEl = ' <contentType>%1</contentType>\n'.replace('%1', location);
            var reportReasonEl = ' <reportReason>%1</reportReason>\n'.replace('%1', reason);
            var commentsEl = comment.length ? ' <comments>%1</comments>\n'.replace('%1', comment) : '';
            var locationEl = masterTitle.length ? ' <location>%1</location>\n'.replace('%1', masterTitle) : '';

            var reportUser = '<reportUser>\n%1%2%3%4</reportUser>'.replace('%1', contentTypeEl)
                .replace('%2', reportReasonEl)
                .replace('%3', commentsEl)
                .replace('%4', locationEl);

            config.body = reportUser;

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }

            // No response processing function needed here
            return dataManager.enQueue(endPoint, config, 0)
                .catch(errorhandler.logAndCleanup('ATOM:processAtomReportUserResponse FAILED'));
        },
        /**
         * Gets a list of mastertitle ids a user owns
         * @param  {string} friendsIds a string of common deliminated nucleus ids (max 5)
         * @return {promise} retVal returns a promise that resovles with an array of objects containing masterTitleIds
         */
        atomCommonGames: function (friendsIds) {
            var endPoint = urls.endPoints.atomCommonGames;

            var config = {
                atype: 'GET',
                headers: [],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }, {
                    'label': 'friendsIds',
                    'val': friendsIds
                }],
                appendparams: [],
                reqauth: true,
                requser: true
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }

            return dataManager.enQueue(endPoint, config, 0)
                .catch(errorhandler.logAndCleanup('ATOM:atomCommonGames FAILED'));
        }
    };

});

/*jshint unused: false */
/*jshint strict: false */
define('modules/social/avatar',[
    'promise',
    'core/logger',
    'core/user',
    'core/dataManager',
    'core/urls',
    'core/errorhandler',
    'core/defines'
], function(Promise, logger, user, dataManager, urls, errorhandler, defines) {

    /**
     * @module module:avatar
     * @memberof module:Origin
     */

    function processAvatarInfoResponse(response) {
        //if only one user was specified, then it returns the response as users.user.avatar
        //but if more than one user was specified, it returns the response as users.user[].avatar
        //so we need to convert the single user case into returning it as an array (of one element) too.
        if (!(response.users.user instanceof Array)) {
            response.users.user = [response.users.user];
        }
        return response.users.user;
    }

    return /** @lends module:Origin.module:avatar */{

        /**
         * avatar info
         * @typedef avatarObject
         * @type {object}
         * @property {string} avatarId
         * @property {string} galleryId
         * @property {string} galleryName
         * @property {boolean} isRecent
         * @property {string} link url for the avatar image
         * @property {string} orderNumber
         * @property {string} statusId
         * @property {string} stausName
         * @property {string} typeId
         * @property {string} typeName
         */

        /**
         * avatar info for a single user
         * @typedef avatarInfoObject
         * @type {object}
         * @property {avatarObject} avatar
         * @property {string} userId nucleusId of the user
         */

        /**
         * This will return a promise for the avatar info for each of the users in the userId list
         *
         * @param {Object} list of userIds, separate by ;
         * @param {string} avatarSize AVATAR_SZ_SMALL, AVATAR_SZ_MEDIUM, AVATAR_SZ_LARGE
         * @return {promise<module:Origin.module:avatar~avatarInfoObject[]>}  name array of avatarInfoObjects
         */
        avatarInfoByUserIds: function(userIdList, avatarSize) {

            var endPoint = urls.endPoints.avatarUrls;

            var sizeVal = 0;
            if (avatarSize === defines.avatarSizes.SMALL) {
                sizeVal = 0;
            } else if (avatarSize === defines.avatarSizes.MEDIUM) {
                sizeVal = 1;
            } else if (avatarSize === defines.avatarSizes.LARGE) {
                sizeVal = 2;
            }

            var config = {
                atype: 'GET',
                headers: [{
                    'label': 'Accept',
                    'val': 'x-cache/force-write'
                }],
                parameters: [{
                    'label': 'userIdList',
                    'val': userIdList
                }, {
                    'label': 'size',
                    'val': sizeVal
                }],
                appendparams: [],
                reqauth: true,
                requser: false
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }
            return dataManager.enQueue(endPoint, config, 0)
                .then(processAvatarInfoResponse, errorhandler.logAndCleanup('AVATAR:avatarInfoByUserIds FAILED'));
        },
    };
});
/*jshint unused: false */
/*jshint strict: false */

define('modules/social/friends',[
    'core/logger',
    'core/user',
    'core/dataManager',
    'core/urls',
    'core/errorhandler',
], function(logger, user, dataManager, urls, errorhandler) {

    /**
     * @module module:friends
     * @memberof module:Origin
     */
    var filterEnums = {
        FRIEND_OF_FRIEND: 1,
        BASED_ON_GAMES_PLAYED: 2,
        LOCATION_BASED: 3,
        BASED_ON_NUCLEUS_DATA: 4
    };

    return /** @lends module:Origin.module:friends */ {
      /**
       * @typedef PlayHistory
       * @type {object}
       * @property {string} game title of the game
       * @property {number} no_of_matches the number of matches played
       * @property {number} most_recent_ts timestamp of most recently played game.
       */
      /**
         * @typedef FriendsReasonObject
         * @type {object}
         * @property {array} mf an array of mutual friends nucleus ids
         * @property {module:Origin.module:friends~PlayHistory[]} play_history an array of play histories
         */
        /**
         * @typedef RecommendedFriendObject
         * @type {object}
         * @property {number} id nucleus id of recommended friends
         * @property {number} wt weight of the recommendation
         * @property {module:Origin.module:friends~FriendsReasonObject[]} reasons a reason object telling you why the friend was recommended
         */
        /**
         * @typedef FriendsObject
         * @type {object}
         * @property {module:Origin.module:friends~RecommendedFriendObject[]} recs array of recommended friends
         * @property {number} page_size number of records returned in the current response
         * @property {boolean} more_recs a flag indicating if there are more records which can be retrieved for the user
         */
        /**
         * This will return a list of friend recommendations from EDAP Social API
         * @see {@link https://developer.ea.com/pages/viewpage.action?pageId=163746092|See EADP Social API doc}
         * @param {number} start start page Number. default is 1
         * @param {number} pageSize the size of the page. default is 10
         * @return {module:Origin.module:friends~FriendsObject} return object containing recommended friends info
         */
        friendRecommendations: function(start, pageSize) {

            var endPoint = urls.endPoints.friendRecommendation;

            var config = {
                atype: 'GET',
                headers: [],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }, {
                  'label': 'pagestart',
                  'val': start ? start : 1
                },{
                  'label': 'pagesize',
                  'val': pageSize ? pageSize : 10
                }],
                appendparams: [],
                reqauth: true,
                requser: true
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'Authorization', 'Bearer ' + token);
            }

            return dataManager.enQueue(endPoint, config, 0)
                .catch(errorhandler.logAndCleanup('Friends:friendRecommendations FAILED'));

        },
        /**
         * Takes in a list of nucleus ids and adds them to a ignore list for friends recommendations
         * @param  {string} nucleusIds a single/or array of nucleus ids
         * @return {promise} retVal resolves when the post call has completed
         */
        friendRecommendationsIgnore: function(nucleusIds) {

            var endPoint = urls.endPoints.friendRecommendationIgnore;

            var config = {
                atype: 'DELETE',
                headers: [{
                    'label': 'Content-Type',
                    'val': 'application/json'
                }],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }, {
                    'label' : 'disableUserId',
                    'val' : nucleusIds
                }],
                appendparams: [],
                reqauth: true,
                requser: true
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'Authorization', 'Bearer ' + token);
            }

            return dataManager.enQueue(endPoint, config, 0)
                .catch(errorhandler.logAndCleanup('Friends:friendIngoreRecommendation FAILED'));

        },

        filter: filterEnums
    };
});

/*jshint unused: false */
/*jshint strict: false */

define('modules/social/obfuscate',[
    'core/logger',
    'core/user',
    'core/dataManager',
    'core/urls',
    'core/errorhandler',
], function(logger, user, dataManager, urls, errorhandler) {

    return /** @lends module:Origin.module:obfuscate */ {

        /**
         * This will return an obfuscated id for the given user
         * @return {string} return obfuscated string
         */
        encode: function(nucleusId) {
            var endPoint = urls.endPoints.idObsfucationEncodePair;

            var config = {
                atype: 'GET',
                headers: [],
                parameters: [{
                    'label': 'id',
                    'val': nucleusId
                }],
                appendparams: [],
                reqauth: true,
                requser: true
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }

            return dataManager.enQueue(endPoint, config, 0);
        },
        /**
         * Takes in a list of nucleus ids and adds them to a ignore list for friends recommendations
         * @param  {string} nucleusIds a single/or array of nucleus ids
         * @return {promise} retVal resolves when the post call has completed
         */
        decode: function(encodedId) {
            var endPoint = urls.endPoints.idObsfucationDecodePair;

            var config = {
                atype: 'GET',
                headers: [],
                parameters: [{
                    'label': 'id',
                    'val': encodedId
                }],
                appendparams: [],
                reqauth: true,
                requser: true
            };

            var token = user.publicObjs.accessToken();
            if (token.length > 0) {
                dataManager.addHeader(config, 'AuthToken', token);
            }

            return dataManager.enQueue(endPoint, config, 0);
        }
    };
});

/*jshint strict: false */
/*jshint unused: false */

define('modules/xmpp/xmppBridge',[
    'promise',
    'core/events',
    'core/urls',
    'core/logger',
    'modules/client/client'
], function(Promise, events, urls, logger, client) {

    var connected = false;

    /**
     * bridge sends us back an array of presence so we want to iterate over that, in most cases
     * it will just be an array of 1, except for the case of initialPresence
     */
    function onPresenceArray(presenceArray) {
        for (var i = 0; i < presenceArray.length; i++) {
            events.fire(events.XMPP_PRESENCECHANGED, presenceArray[i]);
        }
    }

    /** @typedef gameActivityObject
     *  @type {object}
     *  @property {string} title
     *  @property {string} productId
     *  @property {bool} joinable
     *  @property {string} twitchPresence
     *  @property {string} gamePresence
     *  @property {string} multiplayerId
     */

    /**
     * @typedef bridgePresenceObject
     * @type {object}
     * @property {string} jid
     * @property {string} show
     * @property {gameActivityObj} gameActivity
     */

    function onRosterChanged(rosterChangeObject) {
        events.fire(events.XMPP_ROSTERCHANGED, rosterChangeObject);
        return true;
    }

    function onBlockListChanged() {
        events.fire(events.XMPP_BLOCKLISTCHANGED);
        return true;
    }

    function onConnectionStateChanged(isConnected) {
        //broadcast that we're connected
        connected = isConnected;

        if (connected) {
            events.fire(events.XMPP_CONNECTED);
        } else {
            events.fire(events.XMPP_DISCONNECTED);
        }

        logger.log('xmppBridge:handleConnectionChange: social connected =', connected);
    }

    function onMessageReceived(msg) {
        if (msg.type === 'chat' || msg.type === 'groupchat') {
            msg.time = Date.now();
            events.fire(events.XMPP_INCOMINGMSG, msg);
        }
    }

    function onGameInviteReceived(gameInviteObject) {
        events.fire(events.XMPP_GAMEINVITERECEIVED, gameInviteObject);
        return true;
    }

    function onGameInviteFlowStarted(data) {
        events.fire(events.XMPP_GAMEINVITEFLOWSTARTED, data);
        return true;
    }

    function onGameInviteFlowSuccess(data) {
        events.fire(events.XMPP_GAMEINVITEFLOWSUCCESS, data);
        return true;
    }

    function onGameInviteFlowFailed(data) {
        events.fire(events.XMPP_GAMEINVITEFLOWFAILED, data);
        return true;
    }

    function onLeavingParty(data) {
        events.fire(events.XMPP_LEAVINGPARTY, data);
        return true;
    }

    function init() {
        events.on(events.CLIENT_SOCIAL_PRESENCECHANGED, onPresenceArray);
        events.on(events.CLIENT_SOCIAL_CONNECTIONCHANGED, onConnectionStateChanged);
        events.on(events.CLIENT_SOCIAL_MESSAGERECEIVED, onMessageReceived);
        events.on(events.CLIENT_SOCIAL_CHATSTATERECEIVED, onMessageReceived);
        events.on(events.CLIENT_SOCIAL_ROSTERCHANGED, onRosterChanged);
        events.on(events.CLIENT_SOCIAL_BLOCKLISTCHANGED, onBlockListChanged);
        events.on(events.CLIENT_SOCIAL_GAMEINVITERECEIVED, onGameInviteReceived);
        events.on(events.CLIENT_SOCIAL_GAMEINVITEFLOWSTARTED, onGameInviteFlowStarted);
        events.on(events.CLIENT_SOCIAL_GAMEINVITEFLOWSUCCESS, onGameInviteFlowSuccess);
        events.on(events.CLIENT_SOCIAL_GAMEINVITEFLOWFAILED, onGameInviteFlowFailed);
        events.on(events.CLIENT_SOCIAL_LEAVINGPARTY, onLeavingParty);
    }

    function handleRosterLoadSuccess(resolve, timeoutHandle) {
        return function(roster) {
            clearTimeout(timeoutHandle);
            resolve(roster.roster);
        };
    }

    function handleRosterLoadTimeout(reject) {
        return function() {
            reject(new Error('[XMPP FROM CLIENT]: Initial roster load timed out'));
        };
    }

    function waitForRosterLoad() {
        return new Promise(function(resolve, reject) {
            var ROSTER_WAIT_TIMEOUT = 30000,
            timeoutHandle = setTimeout(handleRosterLoadTimeout(reject), ROSTER_WAIT_TIMEOUT);
            events.on(events.CLIENT_SOCIAL_ROSTERLOADED, handleRosterLoadSuccess(resolve, timeoutHandle));
        });
    }

    function loadRosterIfNeeded(loaded) {
        return loaded ? client.social.roster() : waitForRosterLoad();
    }

    function handleUpdatePresenceError() {
        logger.error('[XMPP FROM CLIENT]: Error Updating Presence');
    }
    
    /** @namespace
     * @memberof Origin
     * @alias xmpp
     */
    return {
        init: init,

        /**
         * @method
         * @returns {boolean}
         */
        isConnected: function() {
            return connected;
        },

        /**
         * initiate xmpp connection
         * @method
         * @returns {void}
         */
        connect: function() {
            //check initial xmpp client connection state
            client.social.isConnectionEstablished().then(onConnectionStateChanged);
        },

        /**
         * manual disconnect -- will disconnect automatically when jssdk logout is detected
         * @method
         * @returns {void}
         */
        disconnect: function() {
            //for now, do nothing here since the C++ client handle the disconnect
        },

        /**
         * convert a nucleusId to a JabberID
         * @method
         * @param {string} nucleusId The nucleusId you want to convert
         * @returns {string}
         */
        nucleusIdToJid: function (nucleusId) {
            return nucleusId + '@' + urls.endPoints.xmppConfig.domain;
        },

        /**
         * returned from the {@link Origin.xmpp.requestRoster} promise
         * @typedef rosterObject
         * @type {object}
         * @property {string} subState The subscription state of the user.
         * @property {string} jid The jabber id of the user.
         * @property {string} originId originId
         * @property {string} subReqSent true if you sent this user a request
         */

        /**
         * contactInfoObject - individual contactInfo
         * @typedef contactInfoObject
         * @type {object}
         * @property {string} availability
         * @property {bool} blocked
         * @property {string} capabilities
         * @property {string} id
         * @property {string} nickname
         * @property {string} playingGame
         * @property {string} presence
         * @property {object} realName (firstName, lastName)
         * @property {string} statusText
         * @property {string} jabberId
         * @property {string} originId
         * @property {object} subscriptionState (direction, pendingContactApproval, pendingCurrentUserApproval)
         */

        /**
         * @typedef rosterObject
         * @type {object}
         * @property {contactInfoObject[]} contacts - array of contacts
         * @property {bool} hasFriends
         * @property {bool} hasLoaded
         * @property {string} objectName
         */

        /**
         * Request the friends roster of the current user
         * @method
         * @returns {promise<rosterObject>} The result of the promise will return the xmpp iq roster stanza
         */
        requestRoster: function(requestSuccess, requestError) {
            return client.social.isRosterLoaded()
                .then(loadRosterIfNeeded);
        },
        /**
         * Sends a message to the selected user
         * @method
         * @param {string} userId The jid of the user you want to send the message to.
         * @param {string} msgBody The message you want to send.
         * @returns {void}
         */
        sendMessage: function(userId, msgBody, type) {
            client.social.sendMessage(userId, msgBody, typeof type === 'undefined' ? 'chat' : type);
        },


        sendTypingState: function(state, userId) {
            client.social.setTypingState(state, userId);
        },


        /**
         * Accept a friend request from a giver user
         * @method
         * @param {string} userId The jid of the user whose friend request you want to accept.
         * @returns {void}
         */
        friendRequestAccept: function(jid) {
            client.social.approveSubscriptionRequest(jid);
        },

        /**
         * Reject a friend request from a giver user
         * @method
         * @param {string} userId The jid of the user whose friend request you want to reject.
         * @returns {void}
         */
        friendRequestReject: function(jid) {
            client.social.denySubscriptionRequest(jid);
        },

        /**
         * Send a friend request to the user
         * @method
         * @param {string} userId The jid of the user who you want to send a friend request to.
         * @returns {void}
         */
        friendRequestSend: function(jid) {
            client.social.subscriptionRequest(jid);
        },

        /**
         * Revoke the friend request you sent
         * @method
         * @param {string} userId The jid of the user who you want to revoke the friend request from.
         * @returns {void}
         */
        friendRequestRevoke: function(jid) {
            client.social.cancelSubscriptionRequest(jid);
        },

        /**
         * Revoke a friend
         * @method
         * @param {string} userId The jid of the friend who you want to remove.
         * @returns {void}
         */
        removeFriend: function(jid) {
            client.social.removeFriend(jid);
        },

        /**
         * Remove a friend and block user
         * @method
         * @param {string} jid The jid of the friend who you want to remove.
         * @param {string} nucleusId The nucleusId of the user who you want to block.
         * @returns {void}
         */
        removeFriendAndBlock: function(nucleusId, jid) {
            // On the client, a block will automatically remove friend
            client.social.blockUser(nucleusId);
        }, 
        
        /**
         * Block a user
         * @method
         * @param {string} userId The nucleusId of the user who you want to block.
         * @returns {void}
         */
        blockUser: function(nucleusId) {
            client.social.blockUser(nucleusId);
        },
        
        /**
         * Block a user, and cancel pending friend request
         * @method
         * @param {string} userId The nucleusId of the user who you want to block.
         * @returns {void}
         */
        cancelAndBlockUser: function(nucleusId) {
            client.social.blockUser(nucleusId);
        },

        /**
         * Block a user, and ignore incoming friend request
         * @method
         * @param {string} userId The nucleusId of the user who you want to block.
         * @returns {void}
         */
        ignoreAndBlockUser: function(nucleusId) {
            client.social.blockUser(nucleusId);
        },
        
        /**
         * Unblock a user
         * @method
         * @param {string} userId The nucleusId of the user who you want to unblock.
         * @returns {void}
         */
        unblockUser: function(nucleusId) {
            client.social.unblockUser(nucleusId);
        },
        
        /**
         * Join a friend's game
         * @method
         * @param {string} userId The nucleusId of the friend who's game you want to join.
         * @returns {void}
         */
        joinGame: function (nucleusId) {
            client.social.joinGame(nucleusId);
        },

        /**
         * Invite a friend to your game
         * @method
         * @param {string} userId The nucleusId of the friend who you want to invite
         * @returns {void}
         */
        inviteToGame: function (nucleusId) {
            client.social.inviteToGame(nucleusId);
        },

        /**
         * Updates the current users presence
         * @method
         * @returns {void}
         */
        updatePresence: function() {
            client.social.setInitialPresence('ONLINE')
                .then(client.social.requestInitialPresenceForUserAndFriends)
                .then(onPresenceArray)
                .catch(handleUpdatePresenceError);

        },

        requestPresence: function(presence) {
            client.social.requestPresenceChange(presence);
        },

        /**
         * Join a chat room
         * @method
         * @param {jid} jid of room to join
         * @param {originId} Origin ID of user joining the room
         * @returns {void}
         */
        joinRoom: function(jid, originId) {
            client.social.joinRoom(jid, originId);
        },

        /**
         * Leave a chat room
         * @method
         * @param {jid} jid of room to leave
         * @param {originId} Origin ID of user leaving the room
         * @returns {void}
         */
        leaveRoom: function(jid, originId) {
            client.social.leaveRoom(jid, originId);
        },

        isBlocked: function(nucleusId) {
            return Promise.resolve(client.social.isBlocked(nucleusId));
        },

        getUserPartyGuid: function () {
            return Promise.resolve(client.social.getUserPartyGuid());
        },

        /**
         * Loads the XMPP block list- just a stub- block list is automatically loaded on client
         * @method
         * @returns {void}
         */
        loadBlockList: function() {
        },
        

    };
});

(function(root) {
define("strophe", [], function() {
  return (function() {
// This code was written by Tyler Akins and has been placed in the
// public domain.  It would be nice if you left this header intact.
// Base64 code from Tyler Akins -- http://rumkin.com

var Base64 = (function () {
    var keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

    var obj = {
        /**
         * Encodes a string in base64
         * @param {String} input The string to encode in base64.
         */
        encode: function (input) {
            var output = "";
            var chr1, chr2, chr3;
            var enc1, enc2, enc3, enc4;
            var i = 0;

            do {
                chr1 = input.charCodeAt(i++);
                chr2 = input.charCodeAt(i++);
                chr3 = input.charCodeAt(i++);

                enc1 = chr1 >> 2;
                enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
                enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
                enc4 = chr3 & 63;

                if (isNaN(chr2)) {
                    enc3 = enc4 = 64;
                } else if (isNaN(chr3)) {
                    enc4 = 64;
                }

                output = output + keyStr.charAt(enc1) + keyStr.charAt(enc2) +
                    keyStr.charAt(enc3) + keyStr.charAt(enc4);
            } while (i < input.length);

            return output;
        },

        /**
         * Decodes a base64 string.
         * @param {String} input The string to decode.
         */
        decode: function (input) {
            var output = "";
            var chr1, chr2, chr3;
            var enc1, enc2, enc3, enc4;
            var i = 0;

            // remove all characters that are not A-Z, a-z, 0-9, +, /, or =
            input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");

            do {
                enc1 = keyStr.indexOf(input.charAt(i++));
                enc2 = keyStr.indexOf(input.charAt(i++));
                enc3 = keyStr.indexOf(input.charAt(i++));
                enc4 = keyStr.indexOf(input.charAt(i++));

                chr1 = (enc1 << 2) | (enc2 >> 4);
                chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
                chr3 = ((enc3 & 3) << 6) | enc4;

                output = output + String.fromCharCode(chr1);

                if (enc3 != 64) {
                    output = output + String.fromCharCode(chr2);
                }
                if (enc4 != 64) {
                    output = output + String.fromCharCode(chr3);
                }
            } while (i < input.length);

            return output;
        }
    };

    return obj;
})();

/*
 * A JavaScript implementation of the Secure Hash Algorithm, SHA-1, as defined
 * in FIPS PUB 180-1
 * Version 2.1a Copyright Paul Johnston 2000 - 2002.
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for details.
 */

/* Some functions and variables have been stripped for use with Strophe */

/*
 * These are the functions you'll usually want to call
 * They take string arguments and return either hex or base-64 encoded strings
 */
function b64_sha1(s){return binb2b64(core_sha1(str2binb(s),s.length * 8));}
function str_sha1(s){return binb2str(core_sha1(str2binb(s),s.length * 8));}
function b64_hmac_sha1(key, data){ return binb2b64(core_hmac_sha1(key, data));}
function str_hmac_sha1(key, data){ return binb2str(core_hmac_sha1(key, data));}

/*
 * Calculate the SHA-1 of an array of big-endian words, and a bit length
 */
function core_sha1(x, len)
{
  /* append padding */
  x[len >> 5] |= 0x80 << (24 - len % 32);
  x[((len + 64 >> 9) << 4) + 15] = len;

  var w = new Array(80);
  var a =  1732584193;
  var b = -271733879;
  var c = -1732584194;
  var d =  271733878;
  var e = -1009589776;

  var i, j, t, olda, oldb, oldc, oldd, olde;
  for (i = 0; i < x.length; i += 16)
  {
    olda = a;
    oldb = b;
    oldc = c;
    oldd = d;
    olde = e;

    for (j = 0; j < 80; j++)
    {
      if (j < 16) { w[j] = x[i + j]; }
      else { w[j] = rol(w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16], 1); }
      t = safe_add(safe_add(rol(a, 5), sha1_ft(j, b, c, d)),
                       safe_add(safe_add(e, w[j]), sha1_kt(j)));
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = t;
    }

    a = safe_add(a, olda);
    b = safe_add(b, oldb);
    c = safe_add(c, oldc);
    d = safe_add(d, oldd);
    e = safe_add(e, olde);
  }
  return [a, b, c, d, e];
}

/*
 * Perform the appropriate triplet combination function for the current
 * iteration
 */
function sha1_ft(t, b, c, d)
{
  if (t < 20) { return (b & c) | ((~b) & d); }
  if (t < 40) { return b ^ c ^ d; }
  if (t < 60) { return (b & c) | (b & d) | (c & d); }
  return b ^ c ^ d;
}

/*
 * Determine the appropriate additive constant for the current iteration
 */
function sha1_kt(t)
{
  return (t < 20) ?  1518500249 : (t < 40) ?  1859775393 :
         (t < 60) ? -1894007588 : -899497514;
}

/*
 * Calculate the HMAC-SHA1 of a key and some data
 */
function core_hmac_sha1(key, data)
{
  var bkey = str2binb(key);
  if (bkey.length > 16) { bkey = core_sha1(bkey, key.length * 8); }

  var ipad = new Array(16), opad = new Array(16);
  for (var i = 0; i < 16; i++)
  {
    ipad[i] = bkey[i] ^ 0x36363636;
    opad[i] = bkey[i] ^ 0x5C5C5C5C;
  }

  var hash = core_sha1(ipad.concat(str2binb(data)), 512 + data.length * 8);
  return core_sha1(opad.concat(hash), 512 + 160);
}

/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */
function safe_add(x, y)
{
  var lsw = (x & 0xFFFF) + (y & 0xFFFF);
  var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xFFFF);
}

/*
 * Bitwise rotate a 32-bit number to the left.
 */
function rol(num, cnt)
{
  return (num << cnt) | (num >>> (32 - cnt));
}

/*
 * Convert an 8-bit or 16-bit string to an array of big-endian words
 * In 8-bit function, characters >255 have their hi-byte silently ignored.
 */
function str2binb(str)
{
  var bin = [];
  var mask = 255;
  for (var i = 0; i < str.length * 8; i += 8)
  {
    bin[i>>5] |= (str.charCodeAt(i / 8) & mask) << (24 - i%32);
  }
  return bin;
}

/*
 * Convert an array of big-endian words to a string
 */
function binb2str(bin)
{
  var str = "";
  var mask = 255;
  for (var i = 0; i < bin.length * 32; i += 8)
  {
    str += String.fromCharCode((bin[i>>5] >>> (24 - i%32)) & mask);
  }
  return str;
}

/*
 * Convert an array of big-endian words to a base-64 string
 */
function binb2b64(binarray)
{
  var tab = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var str = "";
  var triplet, j;
  for (var i = 0; i < binarray.length * 4; i += 3)
  {
    triplet = (((binarray[i   >> 2] >> 8 * (3 -  i   %4)) & 0xFF) << 16) |
              (((binarray[i+1 >> 2] >> 8 * (3 - (i+1)%4)) & 0xFF) << 8 ) |
               ((binarray[i+2 >> 2] >> 8 * (3 - (i+2)%4)) & 0xFF);
    for (j = 0; j < 4; j++)
    {
      if (i * 8 + j * 6 > binarray.length * 32) { str += "="; }
      else { str += tab.charAt((triplet >> 6*(3-j)) & 0x3F); }
    }
  }
  return str;
}

/*
 * A JavaScript implementation of the RSA Data Security, Inc. MD5 Message
 * Digest Algorithm, as defined in RFC 1321.
 * Version 2.1 Copyright (C) Paul Johnston 1999 - 2002.
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for more info.
 */

/*
 * Everything that isn't used by Strophe has been stripped here!
 */

var MD5 = (function () {
    /*
     * Add integers, wrapping at 2^32. This uses 16-bit operations internally
     * to work around bugs in some JS interpreters.
     */
    var safe_add = function (x, y) {
        var lsw = (x & 0xFFFF) + (y & 0xFFFF);
        var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
        return (msw << 16) | (lsw & 0xFFFF);
    };

    /*
     * Bitwise rotate a 32-bit number to the left.
     */
    var bit_rol = function (num, cnt) {
        return (num << cnt) | (num >>> (32 - cnt));
    };

    /*
     * Convert a string to an array of little-endian words
     */
    var str2binl = function (str) {
        var bin = [];
        for(var i = 0; i < str.length * 8; i += 8)
        {
            bin[i>>5] |= (str.charCodeAt(i / 8) & 255) << (i%32);
        }
        return bin;
    };

    /*
     * Convert an array of little-endian words to a string
     */
    var binl2str = function (bin) {
        var str = "";
        for(var i = 0; i < bin.length * 32; i += 8)
        {
            str += String.fromCharCode((bin[i>>5] >>> (i % 32)) & 255);
        }
        return str;
    };

    /*
     * Convert an array of little-endian words to a hex string.
     */
    var binl2hex = function (binarray) {
        var hex_tab = "0123456789abcdef";
        var str = "";
        for(var i = 0; i < binarray.length * 4; i++)
        {
            str += hex_tab.charAt((binarray[i>>2] >> ((i%4)*8+4)) & 0xF) +
                hex_tab.charAt((binarray[i>>2] >> ((i%4)*8  )) & 0xF);
        }
        return str;
    };

    /*
     * These functions implement the four basic operations the algorithm uses.
     */
    var md5_cmn = function (q, a, b, x, s, t) {
        return safe_add(bit_rol(safe_add(safe_add(a, q),safe_add(x, t)), s),b);
    };

    var md5_ff = function (a, b, c, d, x, s, t) {
        return md5_cmn((b & c) | ((~b) & d), a, b, x, s, t);
    };

    var md5_gg = function (a, b, c, d, x, s, t) {
        return md5_cmn((b & d) | (c & (~d)), a, b, x, s, t);
    };

    var md5_hh = function (a, b, c, d, x, s, t) {
        return md5_cmn(b ^ c ^ d, a, b, x, s, t);
    };

    var md5_ii = function (a, b, c, d, x, s, t) {
        return md5_cmn(c ^ (b | (~d)), a, b, x, s, t);
    };

    /*
     * Calculate the MD5 of an array of little-endian words, and a bit length
     */
    var core_md5 = function (x, len) {
        /* append padding */
        x[len >> 5] |= 0x80 << ((len) % 32);
        x[(((len + 64) >>> 9) << 4) + 14] = len;

        var a =  1732584193;
        var b = -271733879;
        var c = -1732584194;
        var d =  271733878;

        var olda, oldb, oldc, oldd;
        for (var i = 0; i < x.length; i += 16)
        {
            olda = a;
            oldb = b;
            oldc = c;
            oldd = d;

            a = md5_ff(a, b, c, d, x[i+ 0], 7 , -680876936);
            d = md5_ff(d, a, b, c, x[i+ 1], 12, -389564586);
            c = md5_ff(c, d, a, b, x[i+ 2], 17,  606105819);
            b = md5_ff(b, c, d, a, x[i+ 3], 22, -1044525330);
            a = md5_ff(a, b, c, d, x[i+ 4], 7 , -176418897);
            d = md5_ff(d, a, b, c, x[i+ 5], 12,  1200080426);
            c = md5_ff(c, d, a, b, x[i+ 6], 17, -1473231341);
            b = md5_ff(b, c, d, a, x[i+ 7], 22, -45705983);
            a = md5_ff(a, b, c, d, x[i+ 8], 7 ,  1770035416);
            d = md5_ff(d, a, b, c, x[i+ 9], 12, -1958414417);
            c = md5_ff(c, d, a, b, x[i+10], 17, -42063);
            b = md5_ff(b, c, d, a, x[i+11], 22, -1990404162);
            a = md5_ff(a, b, c, d, x[i+12], 7 ,  1804603682);
            d = md5_ff(d, a, b, c, x[i+13], 12, -40341101);
            c = md5_ff(c, d, a, b, x[i+14], 17, -1502002290);
            b = md5_ff(b, c, d, a, x[i+15], 22,  1236535329);

            a = md5_gg(a, b, c, d, x[i+ 1], 5 , -165796510);
            d = md5_gg(d, a, b, c, x[i+ 6], 9 , -1069501632);
            c = md5_gg(c, d, a, b, x[i+11], 14,  643717713);
            b = md5_gg(b, c, d, a, x[i+ 0], 20, -373897302);
            a = md5_gg(a, b, c, d, x[i+ 5], 5 , -701558691);
            d = md5_gg(d, a, b, c, x[i+10], 9 ,  38016083);
            c = md5_gg(c, d, a, b, x[i+15], 14, -660478335);
            b = md5_gg(b, c, d, a, x[i+ 4], 20, -405537848);
            a = md5_gg(a, b, c, d, x[i+ 9], 5 ,  568446438);
            d = md5_gg(d, a, b, c, x[i+14], 9 , -1019803690);
            c = md5_gg(c, d, a, b, x[i+ 3], 14, -187363961);
            b = md5_gg(b, c, d, a, x[i+ 8], 20,  1163531501);
            a = md5_gg(a, b, c, d, x[i+13], 5 , -1444681467);
            d = md5_gg(d, a, b, c, x[i+ 2], 9 , -51403784);
            c = md5_gg(c, d, a, b, x[i+ 7], 14,  1735328473);
            b = md5_gg(b, c, d, a, x[i+12], 20, -1926607734);

            a = md5_hh(a, b, c, d, x[i+ 5], 4 , -378558);
            d = md5_hh(d, a, b, c, x[i+ 8], 11, -2022574463);
            c = md5_hh(c, d, a, b, x[i+11], 16,  1839030562);
            b = md5_hh(b, c, d, a, x[i+14], 23, -35309556);
            a = md5_hh(a, b, c, d, x[i+ 1], 4 , -1530992060);
            d = md5_hh(d, a, b, c, x[i+ 4], 11,  1272893353);
            c = md5_hh(c, d, a, b, x[i+ 7], 16, -155497632);
            b = md5_hh(b, c, d, a, x[i+10], 23, -1094730640);
            a = md5_hh(a, b, c, d, x[i+13], 4 ,  681279174);
            d = md5_hh(d, a, b, c, x[i+ 0], 11, -358537222);
            c = md5_hh(c, d, a, b, x[i+ 3], 16, -722521979);
            b = md5_hh(b, c, d, a, x[i+ 6], 23,  76029189);
            a = md5_hh(a, b, c, d, x[i+ 9], 4 , -640364487);
            d = md5_hh(d, a, b, c, x[i+12], 11, -421815835);
            c = md5_hh(c, d, a, b, x[i+15], 16,  530742520);
            b = md5_hh(b, c, d, a, x[i+ 2], 23, -995338651);

            a = md5_ii(a, b, c, d, x[i+ 0], 6 , -198630844);
            d = md5_ii(d, a, b, c, x[i+ 7], 10,  1126891415);
            c = md5_ii(c, d, a, b, x[i+14], 15, -1416354905);
            b = md5_ii(b, c, d, a, x[i+ 5], 21, -57434055);
            a = md5_ii(a, b, c, d, x[i+12], 6 ,  1700485571);
            d = md5_ii(d, a, b, c, x[i+ 3], 10, -1894986606);
            c = md5_ii(c, d, a, b, x[i+10], 15, -1051523);
            b = md5_ii(b, c, d, a, x[i+ 1], 21, -2054922799);
            a = md5_ii(a, b, c, d, x[i+ 8], 6 ,  1873313359);
            d = md5_ii(d, a, b, c, x[i+15], 10, -30611744);
            c = md5_ii(c, d, a, b, x[i+ 6], 15, -1560198380);
            b = md5_ii(b, c, d, a, x[i+13], 21,  1309151649);
            a = md5_ii(a, b, c, d, x[i+ 4], 6 , -145523070);
            d = md5_ii(d, a, b, c, x[i+11], 10, -1120210379);
            c = md5_ii(c, d, a, b, x[i+ 2], 15,  718787259);
            b = md5_ii(b, c, d, a, x[i+ 9], 21, -343485551);

            a = safe_add(a, olda);
            b = safe_add(b, oldb);
            c = safe_add(c, oldc);
            d = safe_add(d, oldd);
        }
        return [a, b, c, d];
    };


    var obj = {
        /*
         * These are the functions you'll usually want to call.
         * They take string arguments and return either hex or base-64 encoded
         * strings.
         */
        hexdigest: function (s) {
            return binl2hex(core_md5(str2binl(s), s.length * 8));
        },

        hash: function (s) {
            return binl2str(core_md5(str2binl(s), s.length * 8));
        }
    };

    return obj;
})();

/*
    This program is distributed under the terms of the MIT license.
    Please see the LICENSE file for details.

    Copyright 2006-2008, OGG, LLC
*/

/* jshint undef: true, unused: true:, noarg: true, latedef: true */
/*global document, window, setTimeout, clearTimeout, console,
    ActiveXObject, Base64, MD5, DOMParser */
// from sha1.js
/*global core_hmac_sha1, binb2str, str_hmac_sha1, str_sha1, b64_hmac_sha1*/

/** File: strophe.js
 *  A JavaScript library for XMPP BOSH/XMPP over Websocket.
 *
 *  This is the JavaScript version of the Strophe library.  Since JavaScript
 *  had no facilities for persistent TCP connections, this library uses
 *  Bidirectional-streams Over Synchronous HTTP (BOSH) to emulate
 *  a persistent, stateful, two-way connection to an XMPP server.  More
 *  information on BOSH can be found in XEP 124.
 *
 *  This version of Strophe also works with WebSockets.
 *  For more information on XMPP-over WebSocket see this RFC draft:
 *  http://tools.ietf.org/html/draft-ietf-xmpp-websocket-00
 */

/** PrivateFunction: Function.prototype.bind
 *  Bind a function to an instance.
 *
 *  This Function object extension method creates a bound method similar
 *  to those in Python.  This means that the 'this' object will point
 *  to the instance you want.  See
 *  <a href='https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Function/bind'>MDC's bind() documentation</a> and
 *  <a href='http://benjamin.smedbergs.us/blog/2007-01-03/bound-functions-and-function-imports-in-javascript/'>Bound Functions and Function Imports in JavaScript</a>
 *  for a complete explanation.
 *
 *  This extension already exists in some browsers (namely, Firefox 3), but
 *  we provide it to support those that don't.
 *
 *  Parameters:
 *    (Object) obj - The object that will become 'this' in the bound function.
 *    (Object) argN - An option argument that will be prepended to the
 *      arguments given for the function call
 *
 *  Returns:
 *    The bound function.
 */
if (!Function.prototype.bind) {
    Function.prototype.bind = function (obj /*, arg1, arg2, ... */)
    {
        var func = this;
        var _slice = Array.prototype.slice;
        var _concat = Array.prototype.concat;
        var _args = _slice.call(arguments, 1);

        return function () {
            return func.apply(obj ? obj : this,
                              _concat.call(_args,
                                           _slice.call(arguments, 0)));
        };
    };
}

/** PrivateFunction: Array.prototype.indexOf
 *  Return the index of an object in an array.
 *
 *  This function is not supplied by some JavaScript implementations, so
 *  we provide it if it is missing.  This code is from:
 *  http://developer.mozilla.org/En/Core_JavaScript_1.5_Reference:Objects:Array:indexOf
 *
 *  Parameters:
 *    (Object) elt - The object to look for.
 *    (Integer) from - The index from which to start looking. (optional).
 *
 *  Returns:
 *    The index of elt in the array or -1 if not found.
 */
if (!Array.prototype.indexOf)
{
    Array.prototype.indexOf = function(elt /*, from*/)
    {
        var len = this.length;

        var from = Number(arguments[1]) || 0;
        from = (from < 0) ? Math.ceil(from) : Math.floor(from);
        if (from < 0) {
            from += len;
        }

        for (; from < len; from++) {
            if (from in this && this[from] === elt) {
                return from;
            }
        }

        return -1;
    };
}

/* All of the Strophe globals are defined in this special function below so
 * that references to the globals become closures.  This will ensure that
 * on page reload, these references will still be available to callbacks
 * that are still executing.
 */

(function (callback) {
var Strophe;

/** Function: $build
 *  Create a Strophe.Builder.
 *  This is an alias for 'new Strophe.Builder(name, attrs)'.
 *
 *  Parameters:
 *    (String) name - The root element name.
 *    (Object) attrs - The attributes for the root element in object notation.
 *
 *  Returns:
 *    A new Strophe.Builder object.
 */
function $build(name, attrs) { return new Strophe.Builder(name, attrs); }
/** Function: $msg
 *  Create a Strophe.Builder with a <message/> element as the root.
 *
 *  Parmaeters:
 *    (Object) attrs - The <message/> element attributes in object notation.
 *
 *  Returns:
 *    A new Strophe.Builder object.
 */
function $msg(attrs) { return new Strophe.Builder("message", attrs); }
/** Function: $iq
 *  Create a Strophe.Builder with an <iq/> element as the root.
 *
 *  Parameters:
 *    (Object) attrs - The <iq/> element attributes in object notation.
 *
 *  Returns:
 *    A new Strophe.Builder object.
 */
function $iq(attrs) { return new Strophe.Builder("iq", attrs); }
/** Function: $pres
 *  Create a Strophe.Builder with a <presence/> element as the root.
 *
 *  Parameters:
 *    (Object) attrs - The <presence/> element attributes in object notation.
 *
 *  Returns:
 *    A new Strophe.Builder object.
 */
function $pres(attrs) { return new Strophe.Builder("presence", attrs); }

/** Class: Strophe
 *  An object container for all Strophe library functions.
 *
 *  This class is just a container for all the objects and constants
 *  used in the library.  It is not meant to be instantiated, but to
 *  provide a namespace for library objects, constants, and functions.
 */
Strophe = {
    /** Constant: VERSION
     *  The version of the Strophe library. Unreleased builds will have
     *  a version of head-HASH where HASH is a partial revision.
     */
    VERSION: "1.1.3",

    /** Constants: XMPP Namespace Constants
     *  Common namespace constants from the XMPP RFCs and XEPs.
     *
     *  NS.HTTPBIND - HTTP BIND namespace from XEP 124.
     *  NS.BOSH - BOSH namespace from XEP 206.
     *  NS.CLIENT - Main XMPP client namespace.
     *  NS.AUTH - Legacy authentication namespace.
     *  NS.ROSTER - Roster operations namespace.
     *  NS.PROFILE - Profile namespace.
     *  NS.DISCO_INFO - Service discovery info namespace from XEP 30.
     *  NS.DISCO_ITEMS - Service discovery items namespace from XEP 30.
     *  NS.MUC - Multi-User Chat namespace from XEP 45.
     *  NS.SASL - XMPP SASL namespace from RFC 3920.
     *  NS.STREAM - XMPP Streams namespace from RFC 3920.
     *  NS.BIND - XMPP Binding namespace from RFC 3920.
     *  NS.SESSION - XMPP Session namespace from RFC 3920.
     *  NS.XHTML_IM - XHTML-IM namespace from XEP 71.
     *  NS.XHTML - XHTML body namespace from XEP 71.
     */
    NS: {
        HTTPBIND: "http://jabber.org/protocol/httpbind",
        BOSH: "urn:xmpp:xbosh",
        CLIENT: "jabber:client",
        AUTH: "jabber:iq:auth",
        ROSTER: "jabber:iq:roster",
        PROFILE: "jabber:iq:profile",
        DISCO_INFO: "http://jabber.org/protocol/disco#info",
        DISCO_ITEMS: "http://jabber.org/protocol/disco#items",
        MUC: "http://jabber.org/protocol/muc",
        SASL: "urn:ietf:params:xml:ns:xmpp-sasl",
        STREAM: "http://etherx.jabber.org/streams",
        BIND: "urn:ietf:params:xml:ns:xmpp-bind",
        SESSION: "urn:ietf:params:xml:ns:xmpp-session",
        VERSION: "jabber:iq:version",
        STANZAS: "urn:ietf:params:xml:ns:xmpp-stanzas",
        XHTML_IM: "http://jabber.org/protocol/xhtml-im",
        XHTML: "http://www.w3.org/1999/xhtml"
    },


    /** Constants: XHTML_IM Namespace
     *  contains allowed tags, tag attributes, and css properties.
     *  Used in the createHtml function to filter incoming html into the allowed XHTML-IM subset.
     *  See http://xmpp.org/extensions/xep-0071.html#profile-summary for the list of recommended
     *  allowed tags and their attributes.
     */
    XHTML: {
                tags: ['a','blockquote','br','cite','em','img','li','ol','p','span','strong','ul','body'],
                attributes: {
                        'a':          ['href'],
                        'blockquote': ['style'],
                        'br':         [],
                        'cite':       ['style'],
                        'em':         [],
                        'img':        ['src', 'alt', 'style', 'height', 'width'],
                        'li':         ['style'],
                        'ol':         ['style'],
                        'p':          ['style'],
                        'span':       ['style'],
                        'strong':     [],
                        'ul':         ['style'],
                        'body':       []
                },
                css: ['background-color','color','font-family','font-size','font-style','font-weight','margin-left','margin-right','text-align','text-decoration'],
                validTag: function(tag)
                {
                        for(var i = 0; i < Strophe.XHTML.tags.length; i++) {
                                if(tag == Strophe.XHTML.tags[i]) {
                                        return true;
                                }
                        }
                        return false;
                },
                validAttribute: function(tag, attribute)
                {
                        if(typeof Strophe.XHTML.attributes[tag] !== 'undefined' && Strophe.XHTML.attributes[tag].length > 0) {
                                for(var i = 0; i < Strophe.XHTML.attributes[tag].length; i++) {
                                        if(attribute == Strophe.XHTML.attributes[tag][i]) {
                                                return true;
                                        }
                                }
                        }
                        return false;
                },
                validCSS: function(style)
                {
                        for(var i = 0; i < Strophe.XHTML.css.length; i++) {
                                if(style == Strophe.XHTML.css[i]) {
                                        return true;
                                }
                        }
                        return false;
                }
    },

    /** Constants: Connection Status Constants
     *  Connection status constants for use by the connection handler
     *  callback.
     *
     *  Status.ERROR - An error has occurred
     *  Status.CONNECTING - The connection is currently being made
     *  Status.CONNFAIL - The connection attempt failed
     *  Status.AUTHENTICATING - The connection is authenticating
     *  Status.AUTHFAIL - The authentication attempt failed
     *  Status.CONNECTED - The connection has succeeded
     *  Status.DISCONNECTED - The connection has been terminated
     *  Status.DISCONNECTING - The connection is currently being terminated
     *  Status.ATTACHED - The connection has been attached
     */
    Status: {
        ERROR: 0,
        CONNECTING: 1,
        CONNFAIL: 2,
        AUTHENTICATING: 3,
        AUTHFAIL: 4,
        CONNECTED: 5,
        DISCONNECTED: 6,
        DISCONNECTING: 7,
        ATTACHED: 8
    },

    /** Constants: Log Level Constants
     *  Logging level indicators.
     *
     *  LogLevel.DEBUG - Debug output
     *  LogLevel.INFO - Informational output
     *  LogLevel.WARN - Warnings
     *  LogLevel.ERROR - Errors
     *  LogLevel.FATAL - Fatal errors
     */
    LogLevel: {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        FATAL: 4
    },

    /** PrivateConstants: DOM Element Type Constants
     *  DOM element types.
     *
     *  ElementType.NORMAL - Normal element.
     *  ElementType.TEXT - Text data element.
     *  ElementType.FRAGMENT - XHTML fragment element.
     */
    ElementType: {
        NORMAL: 1,
        TEXT: 3,
        CDATA: 4,
        FRAGMENT: 11
    },

    /** PrivateConstants: Timeout Values
     *  Timeout values for error states.  These values are in seconds.
     *  These should not be changed unless you know exactly what you are
     *  doing.
     *
     *  TIMEOUT - Timeout multiplier. A waiting request will be considered
     *      failed after Math.floor(TIMEOUT * wait) seconds have elapsed.
     *      This defaults to 1.1, and with default wait, 66 seconds.
     *  SECONDARY_TIMEOUT - Secondary timeout multiplier. In cases where
     *      Strophe can detect early failure, it will consider the request
     *      failed if it doesn't return after
     *      Math.floor(SECONDARY_TIMEOUT * wait) seconds have elapsed.
     *      This defaults to 0.1, and with default wait, 6 seconds.
     */
    TIMEOUT: 1.1,
    SECONDARY_TIMEOUT: 0.1,

    /** Function: addNamespace
     *  This function is used to extend the current namespaces in
     *  Strophe.NS.  It takes a key and a value with the key being the
     *  name of the new namespace, with its actual value.
     *  For example:
     *  Strophe.addNamespace('PUBSUB', "http://jabber.org/protocol/pubsub");
     *
     *  Parameters:
     *    (String) name - The name under which the namespace will be
     *      referenced under Strophe.NS
     *    (String) value - The actual namespace.
     */
    addNamespace: function (name, value)
    {
      Strophe.NS[name] = value;
    },

    /** Function: forEachChild
     *  Map a function over some or all child elements of a given element.
     *
     *  This is a small convenience function for mapping a function over
     *  some or all of the children of an element.  If elemName is null, all
     *  children will be passed to the function, otherwise only children
     *  whose tag names match elemName will be passed.
     *
     *  Parameters:
     *    (XMLElement) elem - The element to operate on.
     *    (String) elemName - The child element tag name filter.
     *    (Function) func - The function to apply to each child.  This
     *      function should take a single argument, a DOM element.
     */
    forEachChild: function (elem, elemName, func)
    {
        var i, childNode;

        for (i = 0; i < elem.childNodes.length; i++) {
            childNode = elem.childNodes[i];
            if (childNode.nodeType == Strophe.ElementType.NORMAL &&
                (!elemName || this.isTagEqual(childNode, elemName))) {
                func(childNode);
            }
        }
    },

    /** Function: isTagEqual
     *  Compare an element's tag name with a string.
     *
     *  This function is case insensitive.
     *
     *  Parameters:
     *    (XMLElement) el - A DOM element.
     *    (String) name - The element name.
     *
     *  Returns:
     *    true if the element's tag name matches _el_, and false
     *    otherwise.
     */
    isTagEqual: function (el, name)
    {
        return el.tagName.toLowerCase() == name.toLowerCase();
    },

    /** PrivateVariable: _xmlGenerator
     *  _Private_ variable that caches a DOM document to
     *  generate elements.
     */
    _xmlGenerator: null,

    /** PrivateFunction: _makeGenerator
     *  _Private_ function that creates a dummy XML DOM document to serve as
     *  an element and text node generator.
     */
    _makeGenerator: function () {
        var doc;

        // IE9 does implement createDocument(); however, using it will cause the browser to leak memory on page unload.
        // Here, we test for presence of createDocument() plus IE's proprietary documentMode attribute, which would be
                // less than 10 in the case of IE9 and below.
        if (document.implementation.createDocument === undefined ||
                        document.implementation.createDocument && document.documentMode && document.documentMode < 10) {
            doc = this._getIEXmlDom();
            doc.appendChild(doc.createElement('strophe'));
        } else {
            doc = document.implementation
                .createDocument('jabber:client', 'strophe', null);
        }

        return doc;
    },

    /** Function: xmlGenerator
     *  Get the DOM document to generate elements.
     *
     *  Returns:
     *    The currently used DOM document.
     */
    xmlGenerator: function () {
        if (!Strophe._xmlGenerator) {
            Strophe._xmlGenerator = Strophe._makeGenerator();
        }
        return Strophe._xmlGenerator;
    },

    /** PrivateFunction: _getIEXmlDom
     *  Gets IE xml doc object
     *
     *  Returns:
     *    A Microsoft XML DOM Object
     *  See Also:
     *    http://msdn.microsoft.com/en-us/library/ms757837%28VS.85%29.aspx
     */
    _getIEXmlDom : function() {
        var doc = null;
        var docStrings = [
            "Msxml2.DOMDocument.6.0",
            "Msxml2.DOMDocument.5.0",
            "Msxml2.DOMDocument.4.0",
            "MSXML2.DOMDocument.3.0",
            "MSXML2.DOMDocument",
            "MSXML.DOMDocument",
            "Microsoft.XMLDOM"
        ];

        for (var d = 0; d < docStrings.length; d++) {
            if (doc === null) {
                try {
                    doc = new ActiveXObject(docStrings[d]);
                } catch (e) {
                    doc = null;
                }
            } else {
                break;
            }
        }

        return doc;
    },

    /** Function: xmlElement
     *  Create an XML DOM element.
     *
     *  This function creates an XML DOM element correctly across all
     *  implementations. Note that these are not HTML DOM elements, which
     *  aren't appropriate for XMPP stanzas.
     *
     *  Parameters:
     *    (String) name - The name for the element.
     *    (Array|Object) attrs - An optional array or object containing
     *      key/value pairs to use as element attributes. The object should
     *      be in the format {'key': 'value'} or {key: 'value'}. The array
     *      should have the format [['key1', 'value1'], ['key2', 'value2']].
     *    (String) text - The text child data for the element.
     *
     *  Returns:
     *    A new XML DOM element.
     */
    xmlElement: function (name)
    {
        if (!name) { return null; }

        var node = Strophe.xmlGenerator().createElement(name);

        // FIXME: this should throw errors if args are the wrong type or
        // there are more than two optional args
        var a, i, k;
        for (a = 1; a < arguments.length; a++) {
            if (!arguments[a]) { continue; }
            if (typeof(arguments[a]) == "string" ||
                typeof(arguments[a]) == "number") {
                node.appendChild(Strophe.xmlTextNode(arguments[a]));
            } else if (typeof(arguments[a]) == "object" &&
                       typeof(arguments[a].sort) == "function") {
                for (i = 0; i < arguments[a].length; i++) {
                    if (typeof(arguments[a][i]) == "object" &&
                        typeof(arguments[a][i].sort) == "function") {
                        node.setAttribute(arguments[a][i][0],
                                          arguments[a][i][1]);
                    }
                }
            } else if (typeof(arguments[a]) == "object") {
                for (k in arguments[a]) {
                    if (arguments[a].hasOwnProperty(k)) {
                        node.setAttribute(k, arguments[a][k]);
                    }
                }
            }
        }

        return node;
    },

    /*  Function: xmlescape
     *  Excapes invalid xml characters.
     *
     *  Parameters:
     *     (String) text - text to escape.
     *
     *  Returns:
     *      Escaped text.
     */
    xmlescape: function(text)
    {
        text = text.replace(/\&/g, "&amp;");
        text = text.replace(/</g,  "&lt;");
        text = text.replace(/>/g,  "&gt;");
        text = text.replace(/'/g,  "&apos;");
        text = text.replace(/"/g,  "&quot;");
        return text;
    },

    /** Function: xmlTextNode
     *  Creates an XML DOM text node.
     *
     *  Provides a cross implementation version of document.createTextNode.
     *
     *  Parameters:
     *    (String) text - The content of the text node.
     *
     *  Returns:
     *    A new XML DOM text node.
     */
    xmlTextNode: function (text)
    {
        return Strophe.xmlGenerator().createTextNode(text);
    },

    /** Function: xmlHtmlNode
     *  Creates an XML DOM html node.
     *
     *  Parameters:
     *    (String) html - The content of the html node.
     *
     *  Returns:
     *    A new XML DOM text node.
     */
    xmlHtmlNode: function (html)
    {
        var node;
        //ensure text is escaped
        if (window.DOMParser) {
            var parser = new DOMParser();
            node = parser.parseFromString(html, "text/xml");
        } else {
            node = new ActiveXObject("Microsoft.XMLDOM");
            node.async="false";
            node.loadXML(html);
        }
        return node;
    },

    /** Function: getText
     *  Get the concatenation of all text children of an element.
     *
     *  Parameters:
     *    (XMLElement) elem - A DOM element.
     *
     *  Returns:
     *    A String with the concatenated text of all text element children.
     */
    getText: function (elem)
    {
        if (!elem) { return null; }

        var str = "";
        if (elem.childNodes.length === 0 && elem.nodeType ==
            Strophe.ElementType.TEXT) {
            str += elem.nodeValue;
        }

        for (var i = 0; i < elem.childNodes.length; i++) {
            if (elem.childNodes[i].nodeType == Strophe.ElementType.TEXT) {
                str += elem.childNodes[i].nodeValue;
            }
        }

        return Strophe.xmlescape(str);
    },

    /** Function: copyElement
     *  Copy an XML DOM element.
     *
     *  This function copies a DOM element and all its descendants and returns
     *  the new copy.
     *
     *  Parameters:
     *    (XMLElement) elem - A DOM element.
     *
     *  Returns:
     *    A new, copied DOM element tree.
     */
    copyElement: function (elem)
    {
        var i, el;
        if (elem.nodeType == Strophe.ElementType.NORMAL) {
            el = Strophe.xmlElement(elem.tagName);

            for (i = 0; i < elem.attributes.length; i++) {
                el.setAttribute(elem.attributes[i].nodeName.toLowerCase(),
                                elem.attributes[i].value);
            }

            for (i = 0; i < elem.childNodes.length; i++) {
                el.appendChild(Strophe.copyElement(elem.childNodes[i]));
            }
        } else if (elem.nodeType == Strophe.ElementType.TEXT) {
            el = Strophe.xmlGenerator().createTextNode(elem.nodeValue);
        }

        return el;
    },


    /** Function: createHtml
     *  Copy an HTML DOM element into an XML DOM.
     *
     *  This function copies a DOM element and all its descendants and returns
     *  the new copy.
     *
     *  Parameters:
     *    (HTMLElement) elem - A DOM element.
     *
     *  Returns:
     *    A new, copied DOM element tree.
     */
    createHtml: function (elem)
    {
        var i, el, j, tag, attribute, value, css, cssAttrs, attr, cssName, cssValue;
        if (elem.nodeType == Strophe.ElementType.NORMAL) {
            tag = elem.nodeName.toLowerCase();
            if(Strophe.XHTML.validTag(tag)) {
                try {
                    el = Strophe.xmlElement(tag);
                    for(i = 0; i < Strophe.XHTML.attributes[tag].length; i++) {
                        attribute = Strophe.XHTML.attributes[tag][i];
                        value = elem.getAttribute(attribute);
                        if(typeof value == 'undefined' || value === null || value === '' || value === false || value === 0) {
                            continue;
                        }
                        if(attribute == 'style' && typeof value == 'object') {
                            if(typeof value.cssText != 'undefined') {
                                value = value.cssText; // we're dealing with IE, need to get CSS out
                            }
                        }
                        // filter out invalid css styles
                        if(attribute == 'style') {
                            css = [];
                            cssAttrs = value.split(';');
                            for(j = 0; j < cssAttrs.length; j++) {
                                attr = cssAttrs[j].split(':');
                                cssName = attr[0].replace(/^\s*/, "").replace(/\s*$/, "").toLowerCase();
                                if(Strophe.XHTML.validCSS(cssName)) {
                                    cssValue = attr[1].replace(/^\s*/, "").replace(/\s*$/, "");
                                    css.push(cssName + ': ' + cssValue);
                                }
                            }
                            if(css.length > 0) {
                                value = css.join('; ');
                                el.setAttribute(attribute, value);
                            }
                        } else {
                            el.setAttribute(attribute, value);
                        }
                    }

                    for (i = 0; i < elem.childNodes.length; i++) {
                        el.appendChild(Strophe.createHtml(elem.childNodes[i]));
                    }
                } catch(e) { // invalid elements
                  el = Strophe.xmlTextNode('');
                }
            } else {
                el = Strophe.xmlGenerator().createDocumentFragment();
                for (i = 0; i < elem.childNodes.length; i++) {
                    el.appendChild(Strophe.createHtml(elem.childNodes[i]));
                }
            }
        } else if (elem.nodeType == Strophe.ElementType.FRAGMENT) {
            el = Strophe.xmlGenerator().createDocumentFragment();
            for (i = 0; i < elem.childNodes.length; i++) {
                el.appendChild(Strophe.createHtml(elem.childNodes[i]));
            }
        } else if (elem.nodeType == Strophe.ElementType.TEXT) {
            el = Strophe.xmlTextNode(elem.nodeValue);
        }

        return el;
    },

    /** Function: escapeNode
     *  Escape the node part (also called local part) of a JID.
     *
     *  Parameters:
     *    (String) node - A node (or local part).
     *
     *  Returns:
     *    An escaped node (or local part).
     */
    escapeNode: function (node)
    {
        return node.replace(/^\s+|\s+$/g, '')
            .replace(/\\/g,  "\\5c")
            .replace(/ /g,   "\\20")
            .replace(/\"/g,  "\\22")
            .replace(/\&/g,  "\\26")
            .replace(/\'/g,  "\\27")
            .replace(/\//g,  "\\2f")
            .replace(/:/g,   "\\3a")
            .replace(/</g,   "\\3c")
            .replace(/>/g,   "\\3e")
            .replace(/@/g,   "\\40");
    },

    /** Function: unescapeNode
     *  Unescape a node part (also called local part) of a JID.
     *
     *  Parameters:
     *    (String) node - A node (or local part).
     *
     *  Returns:
     *    An unescaped node (or local part).
     */
    unescapeNode: function (node)
    {
        return node.replace(/\\20/g, " ")
            .replace(/\\22/g, '"')
            .replace(/\\26/g, "&")
            .replace(/\\27/g, "'")
            .replace(/\\2f/g, "/")
            .replace(/\\3a/g, ":")
            .replace(/\\3c/g, "<")
            .replace(/\\3e/g, ">")
            .replace(/\\40/g, "@")
            .replace(/\\5c/g, "\\");
    },

    /** Function: getNodeFromJid
     *  Get the node portion of a JID String.
     *
     *  Parameters:
     *    (String) jid - A JID.
     *
     *  Returns:
     *    A String containing the node.
     */
    getNodeFromJid: function (jid)
    {
        if (jid.indexOf("@") < 0) { return null; }
        return jid.split("@")[0];
    },

    /** Function: getDomainFromJid
     *  Get the domain portion of a JID String.
     *
     *  Parameters:
     *    (String) jid - A JID.
     *
     *  Returns:
     *    A String containing the domain.
     */
    getDomainFromJid: function (jid)
    {
        var bare = Strophe.getBareJidFromJid(jid);
        if (bare.indexOf("@") < 0) {
            return bare;
        } else {
            var parts = bare.split("@");
            parts.splice(0, 1);
            return parts.join('@');
        }
    },

    /** Function: getResourceFromJid
     *  Get the resource portion of a JID String.
     *
     *  Parameters:
     *    (String) jid - A JID.
     *
     *  Returns:
     *    A String containing the resource.
     */
    getResourceFromJid: function (jid)
    {
        var s = jid.split("/");
        if (s.length < 2) { return null; }
        s.splice(0, 1);
        return s.join('/');
    },

    /** Function: getBareJidFromJid
     *  Get the bare JID from a JID String.
     *
     *  Parameters:
     *    (String) jid - A JID.
     *
     *  Returns:
     *    A String containing the bare JID.
     */
    getBareJidFromJid: function (jid)
    {
        return jid ? jid.split("/")[0] : null;
    },

    /** Function: log
     *  User overrideable logging function.
     *
     *  This function is called whenever the Strophe library calls any
     *  of the logging functions.  The default implementation of this
     *  function does nothing.  If client code wishes to handle the logging
     *  messages, it should override this with
     *  > Strophe.log = function (level, msg) {
     *  >   (user code here)
     *  > };
     *
     *  Please note that data sent and received over the wire is logged
     *  via Strophe.Connection.rawInput() and Strophe.Connection.rawOutput().
     *
     *  The different levels and their meanings are
     *
     *    DEBUG - Messages useful for debugging purposes.
     *    INFO - Informational messages.  This is mostly information like
     *      'disconnect was called' or 'SASL auth succeeded'.
     *    WARN - Warnings about potential problems.  This is mostly used
     *      to report transient connection errors like request timeouts.
     *    ERROR - Some error occurred.
     *    FATAL - A non-recoverable fatal error occurred.
     *
     *  Parameters:
     *    (Integer) level - The log level of the log message.  This will
     *      be one of the values in Strophe.LogLevel.
     *    (String) msg - The log message.
     */
    /* jshint ignore:start */
    log: function (level, msg)
    {
        return;
    },
    /* jshint ignore:end */

    /** Function: debug
     *  Log a message at the Strophe.LogLevel.DEBUG level.
     *
     *  Parameters:
     *    (String) msg - The log message.
     */
    debug: function(msg)
    {
        this.log(this.LogLevel.DEBUG, msg);
    },

    /** Function: info
     *  Log a message at the Strophe.LogLevel.INFO level.
     *
     *  Parameters:
     *    (String) msg - The log message.
     */
    info: function (msg)
    {
        this.log(this.LogLevel.INFO, msg);
    },

    /** Function: warn
     *  Log a message at the Strophe.LogLevel.WARN level.
     *
     *  Parameters:
     *    (String) msg - The log message.
     */
    warn: function (msg)
    {
        this.log(this.LogLevel.WARN, msg);
    },

    /** Function: error
     *  Log a message at the Strophe.LogLevel.ERROR level.
     *
     *  Parameters:
     *    (String) msg - The log message.
     */
    error: function (msg)
    {
        this.log(this.LogLevel.ERROR, msg);
    },

    /** Function: fatal
     *  Log a message at the Strophe.LogLevel.FATAL level.
     *
     *  Parameters:
     *    (String) msg - The log message.
     */
    fatal: function (msg)
    {
        this.log(this.LogLevel.FATAL, msg);
    },

    /** Function: serialize
     *  Render a DOM element and all descendants to a String.
     *
     *  Parameters:
     *    (XMLElement) elem - A DOM element.
     *
     *  Returns:
     *    The serialized element tree as a String.
     */
    serialize: function (elem)
    {
        var result;

        if (!elem) { return null; }

        if (typeof(elem.tree) === "function") {
            elem = elem.tree();
        }

        var nodeName = elem.nodeName;
        var i, child;

        if (elem.getAttribute("_realname")) {
            nodeName = elem.getAttribute("_realname");
        }

        result = "<" + nodeName;
        for (i = 0; i < elem.attributes.length; i++) {
               if(elem.attributes[i].nodeName != "_realname") {
                 result += " " + elem.attributes[i].nodeName.toLowerCase() +
                "='" + elem.attributes[i].value
                    .replace(/&/g, "&amp;")
                       .replace(/\'/g, "&apos;")
                       .replace(/>/g, "&gt;")
                       .replace(/</g, "&lt;") + "'";
               }
        }

        if (elem.childNodes.length > 0) {
            result += ">";
            for (i = 0; i < elem.childNodes.length; i++) {
                child = elem.childNodes[i];
                switch( child.nodeType ){
                  case Strophe.ElementType.NORMAL:
                    // normal element, so recurse
                    result += Strophe.serialize(child);
                    break;
                  case Strophe.ElementType.TEXT:
                    // text element to escape values
                    result += Strophe.xmlescape(child.nodeValue);
                    break;
                  case Strophe.ElementType.CDATA:
                    // cdata section so don't escape values
                    result += "<![CDATA["+child.nodeValue+"]]>";
                }
            }
            result += "</" + nodeName + ">";
        } else {
            result += "/>";
        }

        return result;
    },

    /** PrivateVariable: _requestId
     *  _Private_ variable that keeps track of the request ids for
     *  connections.
     */
    _requestId: 0,

    /** PrivateVariable: Strophe.connectionPlugins
     *  _Private_ variable Used to store plugin names that need
     *  initialization on Strophe.Connection construction.
     */
    _connectionPlugins: {},

    /** Function: addConnectionPlugin
     *  Extends the Strophe.Connection object with the given plugin.
     *
     *  Parameters:
     *    (String) name - The name of the extension.
     *    (Object) ptype - The plugin's prototype.
     */
    addConnectionPlugin: function (name, ptype)
    {
        Strophe._connectionPlugins[name] = ptype;
    }
};

/** Class: Strophe.Builder
 *  XML DOM builder.
 *
 *  This object provides an interface similar to JQuery but for building
 *  DOM element easily and rapidly.  All the functions except for toString()
 *  and tree() return the object, so calls can be chained.  Here's an
 *  example using the $iq() builder helper.
 *  > $iq({to: 'you', from: 'me', type: 'get', id: '1'})
 *  >     .c('query', {xmlns: 'strophe:example'})
 *  >     .c('example')
 *  >     .toString()
 *  The above generates this XML fragment
 *  > <iq to='you' from='me' type='get' id='1'>
 *  >   <query xmlns='strophe:example'>
 *  >     <example/>
 *  >   </query>
 *  > </iq>
 *  The corresponding DOM manipulations to get a similar fragment would be
 *  a lot more tedious and probably involve several helper variables.
 *
 *  Since adding children makes new operations operate on the child, up()
 *  is provided to traverse up the tree.  To add two children, do
 *  > builder.c('child1', ...).up().c('child2', ...)
 *  The next operation on the Builder will be relative to the second child.
 */

/** Constructor: Strophe.Builder
 *  Create a Strophe.Builder object.
 *
 *  The attributes should be passed in object notation.  For example
 *  > var b = new Builder('message', {to: 'you', from: 'me'});
 *  or
 *  > var b = new Builder('messsage', {'xml:lang': 'en'});
 *
 *  Parameters:
 *    (String) name - The name of the root element.
 *    (Object) attrs - The attributes for the root element in object notation.
 *
 *  Returns:
 *    A new Strophe.Builder.
 */
Strophe.Builder = function (name, attrs)
{
    // Set correct namespace for jabber:client elements
    if (name == "presence" || name == "message" || name == "iq") {
        if (attrs && !attrs.xmlns) {
            attrs.xmlns = Strophe.NS.CLIENT;
        } else if (!attrs) {
            attrs = {xmlns: Strophe.NS.CLIENT};
        }
    }

    // Holds the tree being built.
    this.nodeTree = Strophe.xmlElement(name, attrs);

    // Points to the current operation node.
    this.node = this.nodeTree;
};

Strophe.Builder.prototype = {
    /** Function: tree
     *  Return the DOM tree.
     *
     *  This function returns the current DOM tree as an element object.  This
     *  is suitable for passing to functions like Strophe.Connection.send().
     *
     *  Returns:
     *    The DOM tree as a element object.
     */
    tree: function ()
    {
        return this.nodeTree;
    },

    /** Function: toString
     *  Serialize the DOM tree to a String.
     *
     *  This function returns a string serialization of the current DOM
     *  tree.  It is often used internally to pass data to a
     *  Strophe.Request object.
     *
     *  Returns:
     *    The serialized DOM tree in a String.
     */
    toString: function ()
    {
        return Strophe.serialize(this.nodeTree);
    },

    /** Function: up
     *  Make the current parent element the new current element.
     *
     *  This function is often used after c() to traverse back up the tree.
     *  For example, to add two children to the same element
     *  > builder.c('child1', {}).up().c('child2', {});
     *
     *  Returns:
     *    The Stophe.Builder object.
     */
    up: function ()
    {
        this.node = this.node.parentNode;
        return this;
    },

    /** Function: attrs
     *  Add or modify attributes of the current element.
     *
     *  The attributes should be passed in object notation.  This function
     *  does not move the current element pointer.
     *
     *  Parameters:
     *    (Object) moreattrs - The attributes to add/modify in object notation.
     *
     *  Returns:
     *    The Strophe.Builder object.
     */
    attrs: function (moreattrs)
    {
        for (var k in moreattrs) {
            if (moreattrs.hasOwnProperty(k)) {
                this.node.setAttribute(k, moreattrs[k]);
            }
        }
        return this;
    },

    /** Function: c
     *  Add a child to the current element and make it the new current
     *  element.
     *
     *  This function moves the current element pointer to the child,
     *  unless text is provided.  If you need to add another child, it
     *  is necessary to use up() to go back to the parent in the tree.
     *
     *  Parameters:
     *    (String) name - The name of the child.
     *    (Object) attrs - The attributes of the child in object notation.
     *    (String) text - The text to add to the child.
     *
     *  Returns:
     *    The Strophe.Builder object.
     */
    c: function (name, attrs, text)
    {
        var child = Strophe.xmlElement(name, attrs, text);
        this.node.appendChild(child);
        if (!text) {
            this.node = child;
        }
        return this;
    },

    /** Function: cnode
     *  Add a child to the current element and make it the new current
     *  element.
     *
     *  This function is the same as c() except that instead of using a
     *  name and an attributes object to create the child it uses an
     *  existing DOM element object.
     *
     *  Parameters:
     *    (XMLElement) elem - A DOM element.
     *
     *  Returns:
     *    The Strophe.Builder object.
     */
    cnode: function (elem)
    {
        var impNode;
        var xmlGen = Strophe.xmlGenerator();
        try {
            impNode = (xmlGen.importNode !== undefined);
        }
        catch (e) {
            impNode = false;
        }
        var newElem = impNode ?
                      xmlGen.importNode(elem, true) :
                      Strophe.copyElement(elem);
        this.node.appendChild(newElem);
        this.node = newElem;
        return this;
    },

    /** Function: t
     *  Add a child text element.
     *
     *  This *does not* make the child the new current element since there
     *  are no children of text elements.
     *
     *  Parameters:
     *    (String) text - The text data to append to the current element.
     *
     *  Returns:
     *    The Strophe.Builder object.
     */
    t: function (text)
    {
        var child = Strophe.xmlTextNode(text);
        this.node.appendChild(child);
        return this;
    },

    /** Function: h
     *  Replace current element contents with the HTML passed in.
     *
     *  This *does not* make the child the new current element
     *
     *  Parameters:
     *    (String) html - The html to insert as contents of current element.
     *
     *  Returns:
     *    The Strophe.Builder object.
     */
    h: function (html)
    {
        var fragment = document.createElement('body');

        // force the browser to try and fix any invalid HTML tags
        fragment.innerHTML = html;

        // copy cleaned html into an xml dom
        var xhtml = Strophe.createHtml(fragment);

        while(xhtml.childNodes.length > 0) {
            this.node.appendChild(xhtml.childNodes[0]);
        }
        return this;
    }
};

/** PrivateClass: Strophe.Handler
 *  _Private_ helper class for managing stanza handlers.
 *
 *  A Strophe.Handler encapsulates a user provided callback function to be
 *  executed when matching stanzas are received by the connection.
 *  Handlers can be either one-off or persistant depending on their
 *  return value. Returning true will cause a Handler to remain active, and
 *  returning false will remove the Handler.
 *
 *  Users will not use Strophe.Handler objects directly, but instead they
 *  will use Strophe.Connection.addHandler() and
 *  Strophe.Connection.deleteHandler().
 */

/** PrivateConstructor: Strophe.Handler
 *  Create and initialize a new Strophe.Handler.
 *
 *  Parameters:
 *    (Function) handler - A function to be executed when the handler is run.
 *    (String) ns - The namespace to match.
 *    (String) name - The element name to match.
 *    (String) type - The element type to match.
 *    (String) id - The element id attribute to match.
 *    (String) from - The element from attribute to match.
 *    (Object) options - Handler options
 *
 *  Returns:
 *    A new Strophe.Handler object.
 */
Strophe.Handler = function (handler, ns, name, type, id, from, options)
{
    this.handler = handler;
    this.ns = ns;
    this.name = name;
    this.type = type;
    this.id = id;
    this.options = options || {matchBare: false};

    // default matchBare to false if undefined
    if (!this.options.matchBare) {
        this.options.matchBare = false;
    }

    if (this.options.matchBare) {
        this.from = from ? Strophe.getBareJidFromJid(from) : null;
    } else {
        this.from = from;
    }

    // whether the handler is a user handler or a system handler
    this.user = true;
};

Strophe.Handler.prototype = {
    /** PrivateFunction: isMatch
     *  Tests if a stanza matches the Strophe.Handler.
     *
     *  Parameters:
     *    (XMLElement) elem - The XML element to test.
     *
     *  Returns:
     *    true if the stanza matches and false otherwise.
     */
    isMatch: function (elem)
    {
        var nsMatch;
        var from = null;

        if (this.options.matchBare) {
            from = Strophe.getBareJidFromJid(elem.getAttribute('from'));
        } else {
            from = elem.getAttribute('from');
        }

        nsMatch = false;
        if (!this.ns) {
            nsMatch = true;
        } else {
            var that = this;
            Strophe.forEachChild(elem, null, function (elem) {
                if (elem.getAttribute("xmlns") == that.ns) {
                    nsMatch = true;
                }
            });

            nsMatch = nsMatch || elem.getAttribute("xmlns") == this.ns;
        }

        if (nsMatch &&
            (!this.name || Strophe.isTagEqual(elem, this.name)) &&
            (!this.type || elem.getAttribute("type") == this.type) &&
            (!this.id || elem.getAttribute("id") == this.id) &&
            (!this.from || from == this.from)) {
                return true;
        }

        return false;
    },

    /** PrivateFunction: run
     *  Run the callback on a matching stanza.
     *
     *  Parameters:
     *    (XMLElement) elem - The DOM element that triggered the
     *      Strophe.Handler.
     *
     *  Returns:
     *    A boolean indicating if the handler should remain active.
     */
    run: function (elem)
    {
        var result = null;
        try {
            result = this.handler(elem);
        } catch (e) {
            if (e.sourceURL) {
                Strophe.fatal("error: " + this.handler +
                              " " + e.sourceURL + ":" +
                              e.line + " - " + e.name + ": " + e.message);
            } else if (e.fileName) {
                if (typeof(console) != "undefined") {
                    console.trace();
                    console.error(this.handler, " - error - ", e, e.message);
                }
                Strophe.fatal("error: " + this.handler + " " +
                              e.fileName + ":" + e.lineNumber + " - " +
                              e.name + ": " + e.message);
            } else {
                Strophe.fatal("error: " + e.message + "\n" + e.stack);
            }

            throw e;
        }

        return result;
    },

    /** PrivateFunction: toString
     *  Get a String representation of the Strophe.Handler object.
     *
     *  Returns:
     *    A String.
     */
    toString: function ()
    {
        return "{Handler: " + this.handler + "(" + this.name + "," +
            this.id + "," + this.ns + ")}";
    }
};

/** PrivateClass: Strophe.TimedHandler
 *  _Private_ helper class for managing timed handlers.
 *
 *  A Strophe.TimedHandler encapsulates a user provided callback that
 *  should be called after a certain period of time or at regular
 *  intervals.  The return value of the callback determines whether the
 *  Strophe.TimedHandler will continue to fire.
 *
 *  Users will not use Strophe.TimedHandler objects directly, but instead
 *  they will use Strophe.Connection.addTimedHandler() and
 *  Strophe.Connection.deleteTimedHandler().
 */

/** PrivateConstructor: Strophe.TimedHandler
 *  Create and initialize a new Strophe.TimedHandler object.
 *
 *  Parameters:
 *    (Integer) period - The number of milliseconds to wait before the
 *      handler is called.
 *    (Function) handler - The callback to run when the handler fires.  This
 *      function should take no arguments.
 *
 *  Returns:
 *    A new Strophe.TimedHandler object.
 */
Strophe.TimedHandler = function (period, handler)
{
    this.period = period;
    this.handler = handler;

    this.lastCalled = new Date().getTime();
    this.user = true;
};

Strophe.TimedHandler.prototype = {
    /** PrivateFunction: run
     *  Run the callback for the Strophe.TimedHandler.
     *
     *  Returns:
     *    true if the Strophe.TimedHandler should be called again, and false
     *      otherwise.
     */
    run: function ()
    {
        this.lastCalled = new Date().getTime();
        return this.handler();
    },

    /** PrivateFunction: reset
     *  Reset the last called time for the Strophe.TimedHandler.
     */
    reset: function ()
    {
        this.lastCalled = new Date().getTime();
    },

    /** PrivateFunction: toString
     *  Get a string representation of the Strophe.TimedHandler object.
     *
     *  Returns:
     *    The string representation.
     */
    toString: function ()
    {
        return "{TimedHandler: " + this.handler + "(" + this.period +")}";
    }
};

/** Class: Strophe.Connection
 *  XMPP Connection manager.
 *
 *  This class is the main part of Strophe.  It manages a BOSH connection
 *  to an XMPP server and dispatches events to the user callbacks as
 *  data arrives.  It supports SASL PLAIN, SASL DIGEST-MD5, SASL SCRAM-SHA1
 *  and legacy authentication.
 *
 *  After creating a Strophe.Connection object, the user will typically
 *  call connect() with a user supplied callback to handle connection level
 *  events like authentication failure, disconnection, or connection
 *  complete.
 *
 *  The user will also have several event handlers defined by using
 *  addHandler() and addTimedHandler().  These will allow the user code to
 *  respond to interesting stanzas or do something periodically with the
 *  connection.  These handlers will be active once authentication is
 *  finished.
 *
 *  To send data to the connection, use send().
 */

/** Constructor: Strophe.Connection
 *  Create and initialize a Strophe.Connection object.
 *
 *  The transport-protocol for this connection will be chosen automatically
 *  based on the given service parameter. URLs starting with "ws://" or
 *  "wss://" will use WebSockets, URLs starting with "http://", "https://"
 *  or without a protocol will use BOSH.
 *
 *  To make Strophe connect to the current host you can leave out the protocol
 *  and host part and just pass the path, e.g.
 *
 *  > var conn = new Strophe.Connection("/http-bind/");
 *
 *  WebSocket options:
 *
 *  If you want to connect to the current host with a WebSocket connection you
 *  can tell Strophe to use WebSockets through a "protocol" attribute in the
 *  optional options parameter. Valid values are "ws" for WebSocket and "wss"
 *  for Secure WebSocket.
 *  So to connect to "wss://CURRENT_HOSTNAME/xmpp-websocket" you would call
 *
 *  > var conn = new Strophe.Connection("/xmpp-websocket/", {protocol: "wss"});
 *
 *  Note that relative URLs _NOT_ starting with a "/" will also include the path
 *  of the current site.
 *
 *  Also because downgrading security is not permitted by browsers, when using
 *  relative URLs both BOSH and WebSocket connections will use their secure
 *  variants if the current connection to the site is also secure (https).
 *
 *  BOSH options:
 *
 *  by adding "sync" to the options, you can control if requests will
 *  be made synchronously or not. The default behaviour is asynchronous.
 *  If you want to make requests synchronous, make "sync" evaluate to true:
 *  > var conn = new Strophe.Connection("/http-bind/", {sync: true});
 *  You can also toggle this on an already established connection:
 *  > conn.options.sync = true;
 *
 *
 *  Parameters:
 *    (String) service - The BOSH or WebSocket service URL.
 *    (Object) options - A hash of configuration options
 *
 *  Returns:
 *    A new Strophe.Connection object.
 */
Strophe.Connection = function (service, options)
{
    // The service URL
    this.service = service;

    // Configuration options
    this.options = options || {};
    var proto = this.options.protocol || "";

    // Select protocal based on service or options
    if (service.indexOf("ws:") === 0 || service.indexOf("wss:") === 0 ||
            proto.indexOf("ws") === 0) {
        this._proto = new Strophe.Websocket(this);
    } else {
        this._proto = new Strophe.Bosh(this);
    }
    /* The connected JID. */
    this.jid = "";
    /* the JIDs domain */
    this.domain = null;
    /* stream:features */
    this.features = null;

    // SASL
    this._sasl_data = {};
    this.do_session = false;
    this.do_bind = false;

    // handler lists
    this.timedHandlers = [];
    this.handlers = [];
    this.removeTimeds = [];
    this.removeHandlers = [];
    this.addTimeds = [];
    this.addHandlers = [];

    this._authentication = {};
    this._idleTimeout = null;
    this._disconnectTimeout = null;

    this.do_authentication = true;
    this.authenticated = false;
    this.disconnecting = false;
    this.connected = false;

    this.errors = 0;

    this.paused = false;

    this._data = [];
    this._uniqueId = 0;

    this._sasl_success_handler = null;
    this._sasl_failure_handler = null;
    this._sasl_challenge_handler = null;

    // Max retries before disconnecting
    this.maxRetries = 5;

    // setup onIdle callback every 1/10th of a second
    this._idleTimeout = setTimeout(this._onIdle.bind(this), 100);

    // initialize plugins
    for (var k in Strophe._connectionPlugins) {
        if (Strophe._connectionPlugins.hasOwnProperty(k)) {
            var ptype = Strophe._connectionPlugins[k];
            // jslint complaints about the below line, but this is fine
            var F = function () {}; // jshint ignore:line
            F.prototype = ptype;
            this[k] = new F();
            this[k].init(this);
        }
    }
};

Strophe.Connection.prototype = {
    /** Function: reset
     *  Reset the connection.
     *
     *  This function should be called after a connection is disconnected
     *  before that connection is reused.
     */
    reset: function ()
    {
        this._proto._reset();

        // SASL
        this.do_session = false;
        this.do_bind = false;

        // handler lists
        this.timedHandlers = [];
        this.handlers = [];
        this.removeTimeds = [];
        this.removeHandlers = [];
        this.addTimeds = [];
        this.addHandlers = [];
        this._authentication = {};

        this.authenticated = false;
        this.disconnecting = false;
        this.connected = false;

        this.errors = 0;

        this._requests = [];
        this._uniqueId = 0;
    },

    /** Function: pause
     *  Pause the request manager.
     *
     *  This will prevent Strophe from sending any more requests to the
     *  server.  This is very useful for temporarily pausing
     *  BOSH-Connections while a lot of send() calls are happening quickly.
     *  This causes Strophe to send the data in a single request, saving
     *  many request trips.
     */
    pause: function ()
    {
        this.paused = true;
    },

    /** Function: resume
     *  Resume the request manager.
     *
     *  This resumes after pause() has been called.
     */
    resume: function ()
    {
        this.paused = false;
    },

    /** Function: getUniqueId
     *  Generate a unique ID for use in <iq/> elements.
     *
     *  All <iq/> stanzas are required to have unique id attributes.  This
     *  function makes creating these easy.  Each connection instance has
     *  a counter which starts from zero, and the value of this counter
     *  plus a colon followed by the suffix becomes the unique id. If no
     *  suffix is supplied, the counter is used as the unique id.
     *
     *  Suffixes are used to make debugging easier when reading the stream
     *  data, and their use is recommended.  The counter resets to 0 for
     *  every new connection for the same reason.  For connections to the
     *  same server that authenticate the same way, all the ids should be
     *  the same, which makes it easy to see changes.  This is useful for
     *  automated testing as well.
     *
     *  Parameters:
     *    (String) suffix - A optional suffix to append to the id.
     *
     *  Returns:
     *    A unique string to be used for the id attribute.
     */
    getUniqueId: function (suffix)
    {
        if (typeof(suffix) == "string" || typeof(suffix) == "number") {
            return ++this._uniqueId + ":" + suffix;
        } else {
            return ++this._uniqueId + "";
        }
    },

    /** Function: connect
     *  Starts the connection process.
     *
     *  As the connection process proceeds, the user supplied callback will
     *  be triggered multiple times with status updates.  The callback
     *  should take two arguments - the status code and the error condition.
     *
     *  The status code will be one of the values in the Strophe.Status
     *  constants.  The error condition will be one of the conditions
     *  defined in RFC 3920 or the condition 'strophe-parsererror'.
     *
     *  The Parameters _wait_, _hold_ and _route_ are optional and only relevant
     *  for BOSH connections. Please see XEP 124 for a more detailed explanation
     *  of the optional parameters.
     *
     *  Parameters:
     *    (String) jid - The user's JID.  This may be a bare JID,
     *      or a full JID.  If a node is not supplied, SASL ANONYMOUS
     *      authentication will be attempted.
     *    (String) pass - The user's password.
     *    (Function) callback - The connect callback function.
     *    (Integer) wait - The optional HTTPBIND wait value.  This is the
     *      time the server will wait before returning an empty result for
     *      a request.  The default setting of 60 seconds is recommended.
     *    (Integer) hold - The optional HTTPBIND hold value.  This is the
     *      number of connections the server will hold at one time.  This
     *      should almost always be set to 1 (the default).
     *    (String) route - The optional route value.
     */
    connect: function (jid, pass, callback, wait, hold, route)
    {
        this.jid = jid;
        /** Variable: authzid
         *  Authorization identity.
         */
        this.authzid = Strophe.getBareJidFromJid(this.jid);
        /** Variable: authcid
         *  Authentication identity (User name).
         */
        this.authcid = Strophe.getNodeFromJid(this.jid);
        /** Variable: pass
         *  Authentication identity (User password).
         */
        this.pass = pass;
        /** Variable: servtype
         *  Digest MD5 compatibility.
         */
        this.servtype = "xmpp";
        this.connect_callback = callback;
        this.disconnecting = false;
        this.connected = false;
        this.authenticated = false;
        this.errors = 0;

        // parse jid for domain
        this.domain = Strophe.getDomainFromJid(this.jid);

        this._changeConnectStatus(Strophe.Status.CONNECTING, null);

        this._proto._connect(wait, hold, route);
    },

    /** Function: attach
     *  Attach to an already created and authenticated BOSH session.
     *
     *  This function is provided to allow Strophe to attach to BOSH
     *  sessions which have been created externally, perhaps by a Web
     *  application.  This is often used to support auto-login type features
     *  without putting user credentials into the page.
     *
     *  Parameters:
     *    (String) jid - The full JID that is bound by the session.
     *    (String) sid - The SID of the BOSH session.
     *    (String) rid - The current RID of the BOSH session.  This RID
     *      will be used by the next request.
     *    (Function) callback The connect callback function.
     *    (Integer) wait - The optional HTTPBIND wait value.  This is the
     *      time the server will wait before returning an empty result for
     *      a request.  The default setting of 60 seconds is recommended.
     *      Other settings will require tweaks to the Strophe.TIMEOUT value.
     *    (Integer) hold - The optional HTTPBIND hold value.  This is the
     *      number of connections the server will hold at one time.  This
     *      should almost always be set to 1 (the default).
     *    (Integer) wind - The optional HTTBIND window value.  This is the
     *      allowed range of request ids that are valid.  The default is 5.
     */
    attach: function (jid, sid, rid, callback, wait, hold, wind)
    {
        this._proto._attach(jid, sid, rid, callback, wait, hold, wind);
    },

    /** Function: xmlInput
     *  User overrideable function that receives XML data coming into the
     *  connection.
     *
     *  The default function does nothing.  User code can override this with
     *  > Strophe.Connection.xmlInput = function (elem) {
     *  >   (user code)
     *  > };
     *
     *  Due to limitations of current Browsers' XML-Parsers the opening and closing
     *  <stream> tag for WebSocket-Connoctions will be passed as selfclosing here.
     *
     *  BOSH-Connections will have all stanzas wrapped in a <body> tag. See
     *  <Strophe.Bosh.strip> if you want to strip this tag.
     *
     *  Parameters:
     *    (XMLElement) elem - The XML data received by the connection.
     */
    /* jshint unused:false */
    xmlInput: function (elem)
    {
        return;
    },
    /* jshint unused:true */

    /** Function: xmlOutput
     *  User overrideable function that receives XML data sent to the
     *  connection.
     *
     *  The default function does nothing.  User code can override this with
     *  > Strophe.Connection.xmlOutput = function (elem) {
     *  >   (user code)
     *  > };
     *
     *  Due to limitations of current Browsers' XML-Parsers the opening and closing
     *  <stream> tag for WebSocket-Connoctions will be passed as selfclosing here.
     *
     *  BOSH-Connections will have all stanzas wrapped in a <body> tag. See
     *  <Strophe.Bosh.strip> if you want to strip this tag.
     *
     *  Parameters:
     *    (XMLElement) elem - The XMLdata sent by the connection.
     */
    /* jshint unused:false */
    xmlOutput: function (elem)
    {
        return;
    },
    /* jshint unused:true */

    /** Function: rawInput
     *  User overrideable function that receives raw data coming into the
     *  connection.
     *
     *  The default function does nothing.  User code can override this with
     *  > Strophe.Connection.rawInput = function (data) {
     *  >   (user code)
     *  > };
     *
     *  Parameters:
     *    (String) data - The data received by the connection.
     */
    /* jshint unused:false */
    rawInput: function (data)
    {
        return;
    },
    /* jshint unused:true */

    /** Function: rawOutput
     *  User overrideable function that receives raw data sent to the
     *  connection.
     *
     *  The default function does nothing.  User code can override this with
     *  > Strophe.Connection.rawOutput = function (data) {
     *  >   (user code)
     *  > };
     *
     *  Parameters:
     *    (String) data - The data sent by the connection.
     */
    /* jshint unused:false */
    rawOutput: function (data)
    {
        return;
    },
    /* jshint unused:true */

    /** Function: send
     *  Send a stanza.
     *
     *  This function is called to push data onto the send queue to
     *  go out over the wire.  Whenever a request is sent to the BOSH
     *  server, all pending data is sent and the queue is flushed.
     *
     *  Parameters:
     *    (XMLElement |
     *     [XMLElement] |
     *     Strophe.Builder) elem - The stanza to send.
     */
    send: function (elem)
    {
        if (elem === null) { return ; }
        if (typeof(elem.sort) === "function") {
            for (var i = 0; i < elem.length; i++) {
                this._queueData(elem[i]);
            }
        } else if (typeof(elem.tree) === "function") {
            this._queueData(elem.tree());
        } else {
            this._queueData(elem);
        }

        this._proto._send();
    },

    /** Function: flush
     *  Immediately send any pending outgoing data.
     *
     *  Normally send() queues outgoing data until the next idle period
     *  (100ms), which optimizes network use in the common cases when
     *  several send()s are called in succession. flush() can be used to
     *  immediately send all pending data.
     */
    flush: function ()
    {
        // cancel the pending idle period and run the idle function
        // immediately
        clearTimeout(this._idleTimeout);
        this._onIdle();
    },

    /** Function: sendIQ
     *  Helper function to send IQ stanzas.
     *
     *  Parameters:
     *    (XMLElement) elem - The stanza to send.
     *    (Function) callback - The callback function for a successful request.
     *    (Function) errback - The callback function for a failed or timed
     *      out request.  On timeout, the stanza will be null.
     *    (Integer) timeout - The time specified in milliseconds for a
     *      timeout to occur.
     *
     *  Returns:
     *    The id used to send the IQ.
    */
    sendIQ: function(elem, callback, errback, timeout) {
        var timeoutHandler = null;
        var that = this;

        if (typeof(elem.tree) === "function") {
            elem = elem.tree();
        }
        var id = elem.getAttribute('id');

        // inject id if not found
        if (!id) {
            id = this.getUniqueId("sendIQ");
            elem.setAttribute("id", id);
        }

        var handler = this.addHandler(function (stanza) {
            // remove timeout handler if there is one
            if (timeoutHandler) {
                that.deleteTimedHandler(timeoutHandler);
            }

            var iqtype = stanza.getAttribute('type');
            if (iqtype == 'result') {
                if (callback) {
                    callback(stanza);
                }
            } else if (iqtype == 'error') {
                if (errback) {
                    errback(stanza);
                }
            } else {
                throw {
                    name: "StropheError",
            message: "Got bad IQ type of " + iqtype
                };
            }
        }, null, 'iq', null, id);

        // if timeout specified, setup timeout handler.
        if (timeout) {
            timeoutHandler = this.addTimedHandler(timeout, function () {
                // get rid of normal handler
                that.deleteHandler(handler);

                // call errback on timeout with null stanza
                if (errback) {
                    errback(null);
                }
                return false;
            });
        }

        this.send(elem);

        return id;
    },

    /** PrivateFunction: _queueData
     *  Queue outgoing data for later sending.  Also ensures that the data
     *  is a DOMElement.
     */
    _queueData: function (element) {
        if (element === null ||
            !element.tagName ||
            !element.childNodes) {
            throw {
                name: "StropheError",
                message: "Cannot queue non-DOMElement."
            };
        }

        this._data.push(element);
    },

    /** PrivateFunction: _sendRestart
     *  Send an xmpp:restart stanza.
     */
    _sendRestart: function ()
    {
        this._data.push("restart");

        this._proto._sendRestart();

        this._idleTimeout = setTimeout(this._onIdle.bind(this), 100);
    },

    /** Function: addTimedHandler
     *  Add a timed handler to the connection.
     *
     *  This function adds a timed handler.  The provided handler will
     *  be called every period milliseconds until it returns false,
     *  the connection is terminated, or the handler is removed.  Handlers
     *  that wish to continue being invoked should return true.
     *
     *  Because of method binding it is necessary to save the result of
     *  this function if you wish to remove a handler with
     *  deleteTimedHandler().
     *
     *  Note that user handlers are not active until authentication is
     *  successful.
     *
     *  Parameters:
     *    (Integer) period - The period of the handler.
     *    (Function) handler - The callback function.
     *
     *  Returns:
     *    A reference to the handler that can be used to remove it.
     */
    addTimedHandler: function (period, handler)
    {
        var thand = new Strophe.TimedHandler(period, handler);
        this.addTimeds.push(thand);
        return thand;
    },

    /** Function: deleteTimedHandler
     *  Delete a timed handler for a connection.
     *
     *  This function removes a timed handler from the connection.  The
     *  handRef parameter is *not* the function passed to addTimedHandler(),
     *  but is the reference returned from addTimedHandler().
     *
     *  Parameters:
     *    (Strophe.TimedHandler) handRef - The handler reference.
     */
    deleteTimedHandler: function (handRef)
    {
        // this must be done in the Idle loop so that we don't change
        // the handlers during iteration
        this.removeTimeds.push(handRef);
    },

    /** Function: addHandler
     *  Add a stanza handler for the connection.
     *
     *  This function adds a stanza handler to the connection.  The
     *  handler callback will be called for any stanza that matches
     *  the parameters.  Note that if multiple parameters are supplied,
     *  they must all match for the handler to be invoked.
     *
     *  The handler will receive the stanza that triggered it as its argument.
     *  The handler should return true if it is to be invoked again;
     *  returning false will remove the handler after it returns.
     *
     *  As a convenience, the ns parameters applies to the top level element
     *  and also any of its immediate children.  This is primarily to make
     *  matching /iq/query elements easy.
     *
     *  The options argument contains handler matching flags that affect how
     *  matches are determined. Currently the only flag is matchBare (a
     *  boolean). When matchBare is true, the from parameter and the from
     *  attribute on the stanza will be matched as bare JIDs instead of
     *  full JIDs. To use this, pass {matchBare: true} as the value of
     *  options. The default value for matchBare is false.
     *
     *  The return value should be saved if you wish to remove the handler
     *  with deleteHandler().
     *
     *  Parameters:
     *    (Function) handler - The user callback.
     *    (String) ns - The namespace to match.
     *    (String) name - The stanza name to match.
     *    (String) type - The stanza type attribute to match.
     *    (String) id - The stanza id attribute to match.
     *    (String) from - The stanza from attribute to match.
     *    (String) options - The handler options
     *
     *  Returns:
     *    A reference to the handler that can be used to remove it.
     */
    addHandler: function (handler, ns, name, type, id, from, options)
    {
        var hand = new Strophe.Handler(handler, ns, name, type, id, from, options);
        this.addHandlers.push(hand);
        return hand;
    },

    /** Function: deleteHandler
     *  Delete a stanza handler for a connection.
     *
     *  This function removes a stanza handler from the connection.  The
     *  handRef parameter is *not* the function passed to addHandler(),
     *  but is the reference returned from addHandler().
     *
     *  Parameters:
     *    (Strophe.Handler) handRef - The handler reference.
     */
    deleteHandler: function (handRef)
    {
        // this must be done in the Idle loop so that we don't change
        // the handlers during iteration
        this.removeHandlers.push(handRef);
    },

    /** Function: disconnect
     *  Start the graceful disconnection process.
     *
     *  This function starts the disconnection process.  This process starts
     *  by sending unavailable presence and sending BOSH body of type
     *  terminate.  A timeout handler makes sure that disconnection happens
     *  even if the BOSH server does not respond.
     *
     *  The user supplied connection callback will be notified of the
     *  progress as this process happens.
     *
     *  Parameters:
     *    (String) reason - The reason the disconnect is occuring.
     */
    disconnect: function (reason)
    {
        this._changeConnectStatus(Strophe.Status.DISCONNECTING, reason);

        Strophe.info("Disconnect was called because: " + reason);
        if (this.connected) {
            var pres = false;
            this.disconnecting = true;
            if (this.authenticated) {
                pres = $pres({
                    xmlns: Strophe.NS.CLIENT,
                    type: 'unavailable'
                });
            }
            // setup timeout handler
            this._disconnectTimeout = this._addSysTimedHandler(
                3000, this._onDisconnectTimeout.bind(this));
            this._proto._disconnect(pres);
        }
    },

    /** PrivateFunction: _changeConnectStatus
     *  _Private_ helper function that makes sure plugins and the user's
     *  callback are notified of connection status changes.
     *
     *  Parameters:
     *    (Integer) status - the new connection status, one of the values
     *      in Strophe.Status
     *    (String) condition - the error condition or null
     */
    _changeConnectStatus: function (status, condition)
    {
        // notify all plugins listening for status changes
        for (var k in Strophe._connectionPlugins) {
            if (Strophe._connectionPlugins.hasOwnProperty(k)) {
                var plugin = this[k];
                if (plugin.statusChanged) {
                    try {
                        plugin.statusChanged(status, condition);
                    } catch (err) {
                        Strophe.error("" + k + " plugin caused an exception " +
                                      "changing status: " + err);
                    }
                }
            }
        }

        // notify the user's callback
        if (this.connect_callback) {
            try {
                this.connect_callback(status, condition);
            } catch (e) {
                Strophe.error("User connection callback caused an " +
                              "exception: " + e);
            }
        }
    },

    /** PrivateFunction: _doDisconnect
     *  _Private_ function to disconnect.
     *
     *  This is the last piece of the disconnection logic.  This resets the
     *  connection and alerts the user's connection callback.
     */
    _doDisconnect: function ()
    {
        // Cancel Disconnect Timeout
        if (this._disconnectTimeout !== null) {
            this.deleteTimedHandler(this._disconnectTimeout);
            this._disconnectTimeout = null;
        }

        Strophe.info("_doDisconnect was called");
        this._proto._doDisconnect();

        this.authenticated = false;
        this.disconnecting = false;

        // delete handlers
        this.handlers = [];
        this.timedHandlers = [];
        this.removeTimeds = [];
        this.removeHandlers = [];
        this.addTimeds = [];
        this.addHandlers = [];

        // tell the parent we disconnected
        this._changeConnectStatus(Strophe.Status.DISCONNECTED, null);
        this.connected = false;
    },

    /** PrivateFunction: _dataRecv
     *  _Private_ handler to processes incoming data from the the connection.
     *
     *  Except for _connect_cb handling the initial connection request,
     *  this function handles the incoming data for all requests.  This
     *  function also fires stanza handlers that match each incoming
     *  stanza.
     *
     *  Parameters:
     *    (Strophe.Request) req - The request that has data ready.
     *    (string) req - The stanza a raw string (optiona).
     */
    _dataRecv: function (req, raw)
    {
        Strophe.info("_dataRecv called");
        var elem = this._proto._reqToData(req);
        if (elem === null) { return; }

        if (this.xmlInput !== Strophe.Connection.prototype.xmlInput) {
            if (elem.nodeName === this._proto.strip && elem.childNodes.length) {
                this.xmlInput(elem.childNodes[0]);
            } else {
                this.xmlInput(elem);
            }
        }
        if (this.rawInput !== Strophe.Connection.prototype.rawInput) {
            if (raw) {
                this.rawInput(raw);
            } else {
                this.rawInput(Strophe.serialize(elem));
            }
        }

        // remove handlers scheduled for deletion
        var i, hand;
        while (this.removeHandlers.length > 0) {
            hand = this.removeHandlers.pop();
            i = this.handlers.indexOf(hand);
            if (i >= 0) {
                this.handlers.splice(i, 1);
            }
        }

        // add handlers scheduled for addition
        while (this.addHandlers.length > 0) {
            this.handlers.push(this.addHandlers.pop());
        }

        // handle graceful disconnect
        if (this.disconnecting && this._proto._emptyQueue()) {
            this._doDisconnect();
            return;
        }

        var typ = elem.getAttribute("type");
        var cond, conflict;
        if (typ !== null && typ == "terminate") {
            // Don't process stanzas that come in after disconnect
            if (this.disconnecting) {
                return;
            }

            // an error occurred
            cond = elem.getAttribute("condition");
            conflict = elem.getElementsByTagName("conflict");
            if (cond !== null) {
                if (cond == "remote-stream-error" && conflict.length > 0) {
                    cond = "conflict";
                }
                this._changeConnectStatus(Strophe.Status.CONNFAIL, cond);
            } else {
                this._changeConnectStatus(Strophe.Status.CONNFAIL, "unknown");
            }
            this.disconnect('unknown stream-error');
            return;
        }

        // send each incoming stanza through the handler chain
        var that = this;
        Strophe.forEachChild(elem, null, function (child) {
            var i, newList;
            // process handlers
            newList = that.handlers;
            that.handlers = [];
            for (i = 0; i < newList.length; i++) {
                var hand = newList[i];
                // encapsulate 'handler.run' not to lose the whole handler list if
                // one of the handlers throws an exception
                try {
                    if (hand.isMatch(child) &&
                        (that.authenticated || !hand.user)) {
                        if (hand.run(child)) {
                            that.handlers.push(hand);
                        }
                    } else {
                        that.handlers.push(hand);
                    }
                } catch(e) {
                    // if the handler throws an exception, we consider it as false
                    Strophe.warn('Removing Strophe handlers due to uncaught exception: ' + e.message);
                }
            }
        });
    },


    /** Attribute: mechanisms
     *  SASL Mechanisms available for Conncection.
     */
    mechanisms: {},

    /** PrivateFunction: _connect_cb
     *  _Private_ handler for initial connection request.
     *
     *  This handler is used to process the initial connection request
     *  response from the BOSH server. It is used to set up authentication
     *  handlers and start the authentication process.
     *
     *  SASL authentication will be attempted if available, otherwise
     *  the code will fall back to legacy authentication.
     *
     *  Parameters:
     *    (Strophe.Request) req - The current request.
     *    (Function) _callback - low level (xmpp) connect callback function.
     *      Useful for plugins with their own xmpp connect callback (when their)
     *      want to do something special).
     */
    _connect_cb: function (req, _callback, raw)
    {
        Strophe.info("_connect_cb was called");

        this.connected = true;

        var bodyWrap = this._proto._reqToData(req);
        if (!bodyWrap) { return; }

        if (this.xmlInput !== Strophe.Connection.prototype.xmlInput) {
            if (bodyWrap.nodeName === this._proto.strip && bodyWrap.childNodes.length) {
                this.xmlInput(bodyWrap.childNodes[0]);
            } else {
                this.xmlInput(bodyWrap);
            }
        }
        if (this.rawInput !== Strophe.Connection.prototype.rawInput) {
            if (raw) {
                this.rawInput(raw);
            } else {
                this.rawInput(Strophe.serialize(bodyWrap));
            }
        }

        var conncheck = this._proto._connect_cb(bodyWrap);
        if (conncheck === Strophe.Status.CONNFAIL) {
            return;
        }

        this._authentication.sasl_scram_sha1 = false;
        this._authentication.sasl_plain = false;
        this._authentication.sasl_digest_md5 = false;
        this._authentication.sasl_anonymous = false;

        this._authentication.legacy_auth = false;

        // Check for the stream:features tag
        var hasFeatures = bodyWrap.getElementsByTagName("stream:features").length > 0;
        if (!hasFeatures) {
            hasFeatures = bodyWrap.getElementsByTagName("features").length > 0;
        }
        var mechanisms = bodyWrap.getElementsByTagName("mechanism");
        var matched = [];
        var i, mech, found_authentication = false;
        if (!hasFeatures) {
            this._proto._no_auth_received(_callback);
            return;
        }
        if (mechanisms.length > 0) {
            for (i = 0; i < mechanisms.length; i++) {
                mech = Strophe.getText(mechanisms[i]);
                if (this.mechanisms[mech]) matched.push(this.mechanisms[mech]);
            }
        }
        this._authentication.legacy_auth =
            bodyWrap.getElementsByTagName("auth").length > 0;
        found_authentication = this._authentication.legacy_auth ||
            matched.length > 0;
        if (!found_authentication) {
            this._proto._no_auth_received(_callback);
            return;
        }
        if (this.do_authentication !== false)
            this.authenticate(matched);
    },

    /** Function: authenticate
     * Set up authentication
     *
     *  Contiunues the initial connection request by setting up authentication
     *  handlers and start the authentication process.
     *
     *  SASL authentication will be attempted if available, otherwise
     *  the code will fall back to legacy authentication.
     *
     */
    authenticate: function (matched)
    {
      var i;
      // Sorting matched mechanisms according to priority.
      for (i = 0; i < matched.length - 1; ++i) {
        var higher = i;
        for (var j = i + 1; j < matched.length; ++j) {
          if (matched[j].prototype.priority > matched[higher].prototype.priority) {
            higher = j;
          }
        }
        if (higher != i) {
          var swap = matched[i];
          matched[i] = matched[higher];
          matched[higher] = swap;
        }
      }

      // run each mechanism
      var mechanism_found = false;
      for (i = 0; i < matched.length; ++i) {
        if (!matched[i].test(this)) continue;

        this._sasl_success_handler = this._addSysHandler(
          this._sasl_success_cb.bind(this), null,
          "success", null, null);
        this._sasl_failure_handler = this._addSysHandler(
          this._sasl_failure_cb.bind(this), null,
          "failure", null, null);
        this._sasl_challenge_handler = this._addSysHandler(
          this._sasl_challenge_cb.bind(this), null,
          "challenge", null, null);

        this._sasl_mechanism = new matched[i]();
        this._sasl_mechanism.onStart(this);

        var request_auth_exchange = $build("auth", {
          xmlns: Strophe.NS.SASL,
          mechanism: this._sasl_mechanism.name
        });

        if (this._sasl_mechanism.isClientFirst) {
          var response = this._sasl_mechanism.onChallenge(this, null);
          request_auth_exchange.t(Base64.encode(response));
        }

        this.send(request_auth_exchange.tree());

        mechanism_found = true;
        break;
      }

      if (!mechanism_found) {
        // if none of the mechanism worked
        if (Strophe.getNodeFromJid(this.jid) === null) {
            // we don't have a node, which is required for non-anonymous
            // client connections
            this._changeConnectStatus(Strophe.Status.CONNFAIL,
                                      'x-strophe-bad-non-anon-jid');
            this.disconnect('x-strophe-bad-non-anon-jid');
        } else {
          // fall back to legacy authentication
          this._changeConnectStatus(Strophe.Status.AUTHENTICATING, null);
          this._addSysHandler(this._auth1_cb.bind(this), null, null,
                              null, "_auth_1");

          this.send($iq({
            type: "get",
            to: this.domain,
            id: "_auth_1"
          }).c("query", {
            xmlns: Strophe.NS.AUTH
          }).c("username", {}).t(Strophe.getNodeFromJid(this.jid)).tree());
        }
      }

    },

    _sasl_challenge_cb: function(elem) {
      var challenge = Base64.decode(Strophe.getText(elem));
      var response = this._sasl_mechanism.onChallenge(this, challenge);

      var stanza = $build('response', {
          xmlns: Strophe.NS.SASL
      });
      if (response !== "") {
        stanza.t(Base64.encode(response));
      }
      this.send(stanza.tree());

      return true;
    },

    /** PrivateFunction: _auth1_cb
     *  _Private_ handler for legacy authentication.
     *
     *  This handler is called in response to the initial <iq type='get'/>
     *  for legacy authentication.  It builds an authentication <iq/> and
     *  sends it, creating a handler (calling back to _auth2_cb()) to
     *  handle the result
     *
     *  Parameters:
     *    (XMLElement) elem - The stanza that triggered the callback.
     *
     *  Returns:
     *    false to remove the handler.
     */
    /* jshint unused:false */
    _auth1_cb: function (elem)
    {
        // build plaintext auth iq
        var iq = $iq({type: "set", id: "_auth_2"})
            .c('query', {xmlns: Strophe.NS.AUTH})
            .c('username', {}).t(Strophe.getNodeFromJid(this.jid))
            .up()
            .c('password').t(this.pass);

        if (!Strophe.getResourceFromJid(this.jid)) {
            // since the user has not supplied a resource, we pick
            // a default one here.  unlike other auth methods, the server
            // cannot do this for us.
            this.jid = Strophe.getBareJidFromJid(this.jid) + '/strophe';
        }
        iq.up().c('resource', {}).t(Strophe.getResourceFromJid(this.jid));

        this._addSysHandler(this._auth2_cb.bind(this), null,
                            null, null, "_auth_2");

        this.send(iq.tree());

        return false;
    },
    /* jshint unused:true */

    /** PrivateFunction: _sasl_success_cb
     *  _Private_ handler for succesful SASL authentication.
     *
     *  Parameters:
     *    (XMLElement) elem - The matching stanza.
     *
     *  Returns:
     *    false to remove the handler.
     */
    _sasl_success_cb: function (elem)
    {
        if (this._sasl_data["server-signature"]) {
            var serverSignature;
            var success = Base64.decode(Strophe.getText(elem));
            var attribMatch = /([a-z]+)=([^,]+)(,|$)/;
            var matches = success.match(attribMatch);
            if (matches[1] == "v") {
                serverSignature = matches[2];
            }

            if (serverSignature != this._sasl_data["server-signature"]) {
              // remove old handlers
              this.deleteHandler(this._sasl_failure_handler);
              this._sasl_failure_handler = null;
              if (this._sasl_challenge_handler) {
                this.deleteHandler(this._sasl_challenge_handler);
                this._sasl_challenge_handler = null;
              }

              this._sasl_data = {};
              return this._sasl_failure_cb(null);
            }
        }

        Strophe.info("SASL authentication succeeded.");

        if(this._sasl_mechanism)
          this._sasl_mechanism.onSuccess();

        // remove old handlers
        this.deleteHandler(this._sasl_failure_handler);
        this._sasl_failure_handler = null;
        if (this._sasl_challenge_handler) {
            this.deleteHandler(this._sasl_challenge_handler);
            this._sasl_challenge_handler = null;
        }

        this._addSysHandler(this._sasl_auth1_cb.bind(this), null,
                            "stream:features", null, null);

        // we must send an xmpp:restart now
        this._sendRestart();

        return false;
    },

    /** PrivateFunction: _sasl_auth1_cb
     *  _Private_ handler to start stream binding.
     *
     *  Parameters:
     *    (XMLElement) elem - The matching stanza.
     *
     *  Returns:
     *    false to remove the handler.
     */
    _sasl_auth1_cb: function (elem)
    {
        // save stream:features for future usage
        this.features = elem;

        var i, child;

        for (i = 0; i < elem.childNodes.length; i++) {
            child = elem.childNodes[i];
            if (child.nodeName == 'bind') {
                this.do_bind = true;
            }

            if (child.nodeName == 'session') {
                this.do_session = true;
            }
        }

        if (!this.do_bind) {
            this._changeConnectStatus(Strophe.Status.AUTHFAIL, null);
            return false;
        } else {
            this._addSysHandler(this._sasl_bind_cb.bind(this), null, null,
                                null, "_bind_auth_2");

            var resource = Strophe.getResourceFromJid(this.jid);
            if (resource) {
                this.send($iq({type: "set", id: "_bind_auth_2"})
                          .c('bind', {xmlns: Strophe.NS.BIND})
                          .c('resource', {}).t(resource).tree());
            } else {
                this.send($iq({type: "set", id: "_bind_auth_2"})
                          .c('bind', {xmlns: Strophe.NS.BIND})
                          .tree());
            }
        }

        return false;
    },

    /** PrivateFunction: _sasl_bind_cb
     *  _Private_ handler for binding result and session start.
     *
     *  Parameters:
     *    (XMLElement) elem - The matching stanza.
     *
     *  Returns:
     *    false to remove the handler.
     */
    _sasl_bind_cb: function (elem)
    {
        if (elem.getAttribute("type") == "error") {
            Strophe.info("SASL binding failed.");
            var conflict = elem.getElementsByTagName("conflict"), condition;
            if (conflict.length > 0) {
                condition = 'conflict';
            }
            this._changeConnectStatus(Strophe.Status.AUTHFAIL, condition);
            return false;
        }

        // TODO - need to grab errors
        var bind = elem.getElementsByTagName("bind");
        var jidNode;
        if (bind.length > 0) {
            // Grab jid
            jidNode = bind[0].getElementsByTagName("jid");
            if (jidNode.length > 0) {
                this.jid = Strophe.getText(jidNode[0]);

                if (this.do_session) {
                    this._addSysHandler(this._sasl_session_cb.bind(this),
                                        null, null, null, "_session_auth_2");

                    this.send($iq({type: "set", id: "_session_auth_2"})
                                  .c('session', {xmlns: Strophe.NS.SESSION})
                                  .tree());
                } else {
                    this.authenticated = true;
                    this._changeConnectStatus(Strophe.Status.CONNECTED, null);
                }
            }
        } else {
            Strophe.info("SASL binding failed.");
            this._changeConnectStatus(Strophe.Status.AUTHFAIL, null);
            return false;
        }
    },

    /** PrivateFunction: _sasl_session_cb
     *  _Private_ handler to finish successful SASL connection.
     *
     *  This sets Connection.authenticated to true on success, which
     *  starts the processing of user handlers.
     *
     *  Parameters:
     *    (XMLElement) elem - The matching stanza.
     *
     *  Returns:
     *    false to remove the handler.
     */
    _sasl_session_cb: function (elem)
    {
        if (elem.getAttribute("type") == "result") {
            this.authenticated = true;
            this._changeConnectStatus(Strophe.Status.CONNECTED, null);
        } else if (elem.getAttribute("type") == "error") {
            Strophe.info("Session creation failed.");
            this._changeConnectStatus(Strophe.Status.AUTHFAIL, null);
            return false;
        }

        return false;
    },

    /** PrivateFunction: _sasl_failure_cb
     *  _Private_ handler for SASL authentication failure.
     *
     *  Parameters:
     *    (XMLElement) elem - The matching stanza.
     *
     *  Returns:
     *    false to remove the handler.
     */
    /* jshint unused:false */
    _sasl_failure_cb: function (elem)
    {
        // delete unneeded handlers
        if (this._sasl_success_handler) {
            this.deleteHandler(this._sasl_success_handler);
            this._sasl_success_handler = null;
        }
        if (this._sasl_challenge_handler) {
            this.deleteHandler(this._sasl_challenge_handler);
            this._sasl_challenge_handler = null;
        }

        if(this._sasl_mechanism)
          this._sasl_mechanism.onFailure();
        this._changeConnectStatus(Strophe.Status.AUTHFAIL, null);
        return false;
    },
    /* jshint unused:true */

    /** PrivateFunction: _auth2_cb
     *  _Private_ handler to finish legacy authentication.
     *
     *  This handler is called when the result from the jabber:iq:auth
     *  <iq/> stanza is returned.
     *
     *  Parameters:
     *    (XMLElement) elem - The stanza that triggered the callback.
     *
     *  Returns:
     *    false to remove the handler.
     */
    _auth2_cb: function (elem)
    {
        if (elem.getAttribute("type") == "result") {
            this.authenticated = true;
            this._changeConnectStatus(Strophe.Status.CONNECTED, null);
        } else if (elem.getAttribute("type") == "error") {
            this._changeConnectStatus(Strophe.Status.AUTHFAIL, null);
            this.disconnect('authentication failed');
        }

        return false;
    },

    /** PrivateFunction: _addSysTimedHandler
     *  _Private_ function to add a system level timed handler.
     *
     *  This function is used to add a Strophe.TimedHandler for the
     *  library code.  System timed handlers are allowed to run before
     *  authentication is complete.
     *
     *  Parameters:
     *    (Integer) period - The period of the handler.
     *    (Function) handler - The callback function.
     */
    _addSysTimedHandler: function (period, handler)
    {
        var thand = new Strophe.TimedHandler(period, handler);
        thand.user = false;
        this.addTimeds.push(thand);
        return thand;
    },

    /** PrivateFunction: _addSysHandler
     *  _Private_ function to add a system level stanza handler.
     *
     *  This function is used to add a Strophe.Handler for the
     *  library code.  System stanza handlers are allowed to run before
     *  authentication is complete.
     *
     *  Parameters:
     *    (Function) handler - The callback function.
     *    (String) ns - The namespace to match.
     *    (String) name - The stanza name to match.
     *    (String) type - The stanza type attribute to match.
     *    (String) id - The stanza id attribute to match.
     */
    _addSysHandler: function (handler, ns, name, type, id)
    {
        var hand = new Strophe.Handler(handler, ns, name, type, id);
        hand.user = false;
        this.addHandlers.push(hand);
        return hand;
    },

    /** PrivateFunction: _onDisconnectTimeout
     *  _Private_ timeout handler for handling non-graceful disconnection.
     *
     *  If the graceful disconnect process does not complete within the
     *  time allotted, this handler finishes the disconnect anyway.
     *
     *  Returns:
     *    false to remove the handler.
     */
    _onDisconnectTimeout: function ()
    {
        Strophe.info("_onDisconnectTimeout was called");

        this._proto._onDisconnectTimeout();

        // actually disconnect
        this._doDisconnect();

        return false;
    },

    /** PrivateFunction: _onIdle
     *  _Private_ handler to process events during idle cycle.
     *
     *  This handler is called every 100ms to fire timed handlers that
     *  are ready and keep poll requests going.
     */
    _onIdle: function ()
    {
        var i, thand, since, newList;

        // add timed handlers scheduled for addition
        // NOTE: we add before remove in the case a timed handler is
        // added and then deleted before the next _onIdle() call.
        while (this.addTimeds.length > 0) {
            this.timedHandlers.push(this.addTimeds.pop());
        }

        // remove timed handlers that have been scheduled for deletion
        while (this.removeTimeds.length > 0) {
            thand = this.removeTimeds.pop();
            i = this.timedHandlers.indexOf(thand);
            if (i >= 0) {
                this.timedHandlers.splice(i, 1);
            }
        }

        // call ready timed handlers
        var now = new Date().getTime();
        newList = [];
        for (i = 0; i < this.timedHandlers.length; i++) {
            thand = this.timedHandlers[i];
            if (this.authenticated || !thand.user) {
                since = thand.lastCalled + thand.period;
                if (since - now <= 0) {
                    if (thand.run()) {
                        newList.push(thand);
                    }
                } else {
                    newList.push(thand);
                }
            }
        }
        this.timedHandlers = newList;

        clearTimeout(this._idleTimeout);

        this._proto._onIdle();

        // reactivate the timer only if connected
        if (this.connected) {
            this._idleTimeout = setTimeout(this._onIdle.bind(this), 100);
        }
    }
};

if (callback) {
    callback(Strophe, $build, $msg, $iq, $pres);
}

/** Class: Strophe.SASLMechanism
 *
 *  encapsulates SASL authentication mechanisms.
 *
 *  User code may override the priority for each mechanism or disable it completely.
 *  See <priority> for information about changing priority and <test> for informatian on
 *  how to disable a mechanism.
 *
 *  By default, all mechanisms are enabled and the priorities are
 *
 *  SCRAM-SHA1 - 40
 *  DIGEST-MD5 - 30
 *  Plain - 20
 */

/**
 * PrivateConstructor: Strophe.SASLMechanism
 * SASL auth mechanism abstraction.
 *
 *  Parameters:
 *    (String) name - SASL Mechanism name.
 *    (Boolean) isClientFirst - If client should send response first without challenge.
 *    (Number) priority - Priority.
 *
 *  Returns:
 *    A new Strophe.SASLMechanism object.
 */
Strophe.SASLMechanism = function(name, isClientFirst, priority) {
  /** PrivateVariable: name
   *  Mechanism name.
   */
  this.name = name;
  /** PrivateVariable: isClientFirst
   *  If client sends response without initial server challenge.
   */
  this.isClientFirst = isClientFirst;
  /** Variable: priority
   *  Determines which <SASLMechanism> is chosen for authentication (Higher is better).
   *  Users may override this to prioritize mechanisms differently.
   *
   *  In the default configuration the priorities are
   *
   *  SCRAM-SHA1 - 40
   *  DIGEST-MD5 - 30
   *  Plain - 20
   *
   *  Example: (This will cause Strophe to choose the mechanism that the server sent first)
   *
   *  > Strophe.SASLMD5.priority = Strophe.SASLSHA1.priority;
   *
   *  See <SASL mechanisms> for a list of available mechanisms.
   *
   */
  this.priority = priority;
};

Strophe.SASLMechanism.prototype = {
  /**
   *  Function: test
   *  Checks if mechanism able to run.
   *  To disable a mechanism, make this return false;
   *
   *  To disable plain authentication run
   *  > Strophe.SASLPlain.test = function() {
   *  >   return false;
   *  > }
   *
   *  See <SASL mechanisms> for a list of available mechanisms.
   *
   *  Parameters:
   *    (Strophe.Connection) connection - Target Connection.
   *
   *  Returns:
   *    (Boolean) If mechanism was able to run.
   */
  /* jshint unused:false */
  test: function(connection) {
    return true;
  },
  /* jshint unused:true */

  /** PrivateFunction: onStart
   *  Called before starting mechanism on some connection.
   *
   *  Parameters:
   *    (Strophe.Connection) connection - Target Connection.
   */
  onStart: function(connection)
  {
    this._connection = connection;
  },

  /** PrivateFunction: onChallenge
   *  Called by protocol implementation on incoming challenge. If client is
   *  first (isClientFirst == true) challenge will be null on the first call.
   *
   *  Parameters:
   *    (Strophe.Connection) connection - Target Connection.
   *    (String) challenge - current challenge to handle.
   *
   *  Returns:
   *    (String) Mechanism response.
   */
  /* jshint unused:false */
  onChallenge: function(connection, challenge) {
    throw new Error("You should implement challenge handling!");
  },
  /* jshint unused:true */

  /** PrivateFunction: onFailure
   *  Protocol informs mechanism implementation about SASL failure.
   */
  onFailure: function() {
    this._connection = null;
  },

  /** PrivateFunction: onSuccess
   *  Protocol informs mechanism implementation about SASL success.
   */
  onSuccess: function() {
    this._connection = null;
  }
};

  /** Constants: SASL mechanisms
   *  Available authentication mechanisms
   *
   *  Strophe.SASLAnonymous - SASL Anonymous authentication.
   *  Strophe.SASLPlain - SASL Plain authentication.
   *  Strophe.SASLMD5 - SASL Digest-MD5 authentication
   *  Strophe.SASLSHA1 - SASL SCRAM-SHA1 authentication
   */

// Building SASL callbacks

/** PrivateConstructor: SASLAnonymous
 *  SASL Anonymous authentication.
 */
Strophe.SASLAnonymous = function() {};

Strophe.SASLAnonymous.prototype = new Strophe.SASLMechanism("ANONYMOUS", false, 10);

Strophe.SASLAnonymous.test = function(connection) {
  return connection.authcid === null;
};

Strophe.Connection.prototype.mechanisms[Strophe.SASLAnonymous.prototype.name] = Strophe.SASLAnonymous;

/** PrivateConstructor: SASLPlain
 *  SASL Plain authentication.
 */
Strophe.SASLPlain = function() {};

Strophe.SASLPlain.prototype = new Strophe.SASLMechanism("PLAIN", true, 20);

Strophe.SASLPlain.test = function(connection) {
  return connection.authcid !== null;
};

Strophe.SASLPlain.prototype.onChallenge = function(connection) {
  var auth_str = connection.authzid;
  auth_str = auth_str + "\u0000";
  auth_str = auth_str + connection.authcid;
  auth_str = auth_str + "\u0000";
  auth_str = auth_str + connection.pass;
  return auth_str;
};

Strophe.Connection.prototype.mechanisms[Strophe.SASLPlain.prototype.name] = Strophe.SASLPlain;

/** PrivateConstructor: SASLSHA1
 *  SASL SCRAM SHA 1 authentication.
 */
Strophe.SASLSHA1 = function() {};

/* TEST:
 * This is a simple example of a SCRAM-SHA-1 authentication exchange
 * when the client doesn't support channel bindings (username 'user' and
 * password 'pencil' are used):
 *
 * C: n,,n=user,r=fyko+d2lbbFgONRv9qkxdawL
 * S: r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,s=QSXCR+Q6sek8bf92,
 * i=4096
 * C: c=biws,r=fyko+d2lbbFgONRv9qkxdawL3rfcNHYJY1ZVvWVs7j,
 * p=v0X8v3Bz2T0CJGbJQyF0X+HI4Ts=
 * S: v=rmF9pqV8S7suAoZWja4dJRkFsKQ=
 *
 */

Strophe.SASLSHA1.prototype = new Strophe.SASLMechanism("SCRAM-SHA-1", true, 40);

Strophe.SASLSHA1.test = function(connection) {
  return connection.authcid !== null;
};

Strophe.SASLSHA1.prototype.onChallenge = function(connection, challenge, test_cnonce) {
  var cnonce = test_cnonce || MD5.hexdigest(Math.random() * 1234567890);

  var auth_str = "n=" + connection.authcid;
  auth_str += ",r=";
  auth_str += cnonce;

  connection._sasl_data.cnonce = cnonce;
  connection._sasl_data["client-first-message-bare"] = auth_str;

  auth_str = "n,," + auth_str;

  this.onChallenge = function (connection, challenge)
  {
    var nonce, salt, iter, Hi, U, U_old, i, k;
    var clientKey, serverKey, clientSignature;
    var responseText = "c=biws,";
    var authMessage = connection._sasl_data["client-first-message-bare"] + "," +
      challenge + ",";
    var cnonce = connection._sasl_data.cnonce;
    var attribMatch = /([a-z]+)=([^,]+)(,|$)/;

    while (challenge.match(attribMatch)) {
      var matches = challenge.match(attribMatch);
      challenge = challenge.replace(matches[0], "");
      switch (matches[1]) {
      case "r":
        nonce = matches[2];
        break;
      case "s":
        salt = matches[2];
        break;
      case "i":
        iter = matches[2];
        break;
      }
    }

    if (nonce.substr(0, cnonce.length) !== cnonce) {
      connection._sasl_data = {};
      return connection._sasl_failure_cb();
    }

    responseText += "r=" + nonce;
    authMessage += responseText;

    salt = Base64.decode(salt);
    salt += "\x00\x00\x00\x01";

    Hi = U_old = core_hmac_sha1(connection.pass, salt);
    for (i = 1; i < iter; i++) {
      U = core_hmac_sha1(connection.pass, binb2str(U_old));
      for (k = 0; k < 5; k++) {
        Hi[k] ^= U[k];
      }
      U_old = U;
    }
    Hi = binb2str(Hi);

    clientKey = core_hmac_sha1(Hi, "Client Key");
    serverKey = str_hmac_sha1(Hi, "Server Key");
    clientSignature = core_hmac_sha1(str_sha1(binb2str(clientKey)), authMessage);
    connection._sasl_data["server-signature"] = b64_hmac_sha1(serverKey, authMessage);

    for (k = 0; k < 5; k++) {
      clientKey[k] ^= clientSignature[k];
    }

    responseText += ",p=" + Base64.encode(binb2str(clientKey));

    return responseText;
  }.bind(this);

  return auth_str;
};

Strophe.Connection.prototype.mechanisms[Strophe.SASLSHA1.prototype.name] = Strophe.SASLSHA1;

/** PrivateConstructor: SASLMD5
 *  SASL DIGEST MD5 authentication.
 */
Strophe.SASLMD5 = function() {};

Strophe.SASLMD5.prototype = new Strophe.SASLMechanism("DIGEST-MD5", false, 30);

Strophe.SASLMD5.test = function(connection) {
  return connection.authcid !== null;
};

/** PrivateFunction: _quote
 *  _Private_ utility function to backslash escape and quote strings.
 *
 *  Parameters:
 *    (String) str - The string to be quoted.
 *
 *  Returns:
 *    quoted string
 */
Strophe.SASLMD5.prototype._quote = function (str)
  {
    return '"' + str.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    //" end string workaround for emacs
  };


Strophe.SASLMD5.prototype.onChallenge = function(connection, challenge, test_cnonce) {
  var attribMatch = /([a-z]+)=("[^"]+"|[^,"]+)(?:,|$)/;
  var cnonce = test_cnonce || MD5.hexdigest("" + (Math.random() * 1234567890));
  var realm = "";
  var host = null;
  var nonce = "";
  var qop = "";
  var matches;

  while (challenge.match(attribMatch)) {
    matches = challenge.match(attribMatch);
    challenge = challenge.replace(matches[0], "");
    matches[2] = matches[2].replace(/^"(.+)"$/, "$1");
    switch (matches[1]) {
    case "realm":
      realm = matches[2];
      break;
    case "nonce":
      nonce = matches[2];
      break;
    case "qop":
      qop = matches[2];
      break;
    case "host":
      host = matches[2];
      break;
    }
  }

  var digest_uri = connection.servtype + "/" + connection.domain;
  if (host !== null) {
    digest_uri = digest_uri + "/" + host;
  }

  var A1 = MD5.hash(connection.authcid +
                    ":" + realm + ":" + this._connection.pass) +
    ":" + nonce + ":" + cnonce;
  var A2 = 'AUTHENTICATE:' + digest_uri;

  var responseText = "";
  responseText += 'charset=utf-8,';
  responseText += 'username=' +
    this._quote(connection.authcid) + ',';
  responseText += 'realm=' + this._quote(realm) + ',';
  responseText += 'nonce=' + this._quote(nonce) + ',';
  responseText += 'nc=00000001,';
  responseText += 'cnonce=' + this._quote(cnonce) + ',';
  responseText += 'digest-uri=' + this._quote(digest_uri) + ',';
  responseText += 'response=' + MD5.hexdigest(MD5.hexdigest(A1) + ":" +
                                              nonce + ":00000001:" +
                                              cnonce + ":auth:" +
                                              MD5.hexdigest(A2)) + ",";
  responseText += 'qop=auth';

  this.onChallenge = function ()
  {
    return "";
  }.bind(this);

  return responseText;
};

Strophe.Connection.prototype.mechanisms[Strophe.SASLMD5.prototype.name] = Strophe.SASLMD5;

})(function () {
    window.Strophe = arguments[0];
    window.$build = arguments[1];
    window.$msg = arguments[2];
    window.$iq = arguments[3];
    window.$pres = arguments[4];
});

/*
    This program is distributed under the terms of the MIT license.
    Please see the LICENSE file for details.

    Copyright 2006-2008, OGG, LLC
*/

/* jshint undef: true, unused: true:, noarg: true, latedef: true */
/*global window, setTimeout, clearTimeout,
    XMLHttpRequest, ActiveXObject,
    Strophe, $build */


/** PrivateClass: Strophe.Request
 *  _Private_ helper class that provides a cross implementation abstraction
 *  for a BOSH related XMLHttpRequest.
 *
 *  The Strophe.Request class is used internally to encapsulate BOSH request
 *  information.  It is not meant to be used from user's code.
 */

/** PrivateConstructor: Strophe.Request
 *  Create and initialize a new Strophe.Request object.
 *
 *  Parameters:
 *    (XMLElement) elem - The XML data to be sent in the request.
 *    (Function) func - The function that will be called when the
 *      XMLHttpRequest readyState changes.
 *    (Integer) rid - The BOSH rid attribute associated with this request.
 *    (Integer) sends - The number of times this same request has been
 *      sent.
 */
Strophe.Request = function (elem, func, rid, sends)
{
    this.id = ++Strophe._requestId;
    this.xmlData = elem;
    this.data = Strophe.serialize(elem);
    // save original function in case we need to make a new request
    // from this one.
    this.origFunc = func;
    this.func = func;
    this.rid = rid;
    this.date = NaN;
    this.sends = sends || 0;
    this.abort = false;
    this.dead = null;

    this.age = function () {
        if (!this.date) { return 0; }
        var now = new Date();
        return (now - this.date) / 1000;
    };
    this.timeDead = function () {
        if (!this.dead) { return 0; }
        var now = new Date();
        return (now - this.dead) / 1000;
    };
    this.xhr = this._newXHR();
};

Strophe.Request.prototype = {
    /** PrivateFunction: getResponse
     *  Get a response from the underlying XMLHttpRequest.
     *
     *  This function attempts to get a response from the request and checks
     *  for errors.
     *
     *  Throws:
     *    "parsererror" - A parser error occured.
     *
     *  Returns:
     *    The DOM element tree of the response.
     */
    getResponse: function ()
    {
        var node = null;
        if (this.xhr.responseXML && this.xhr.responseXML.documentElement) {
            node = this.xhr.responseXML.documentElement;
            if (node.tagName == "parsererror") {
                Strophe.error("invalid response received");
                Strophe.error("responseText: " + this.xhr.responseText);
                Strophe.error("responseXML: " +
                              Strophe.serialize(this.xhr.responseXML));
                throw "parsererror";
            }
        } else if (this.xhr.responseText) {
            Strophe.error("invalid response received");
            Strophe.error("responseText: " + this.xhr.responseText);
            Strophe.error("responseXML: " +
                          Strophe.serialize(this.xhr.responseXML));
        }

        return node;
    },

    /** PrivateFunction: _newXHR
     *  _Private_ helper function to create XMLHttpRequests.
     *
     *  This function creates XMLHttpRequests across all implementations.
     *
     *  Returns:
     *    A new XMLHttpRequest.
     */
    _newXHR: function ()
    {
        var xhr = null;
        if (window.XMLHttpRequest) {
            xhr = new XMLHttpRequest();
            if (xhr.overrideMimeType) {
                xhr.overrideMimeType("text/xml");
            }
        } else if (window.ActiveXObject) {
            xhr = new ActiveXObject("Microsoft.XMLHTTP");
        }

        // use Function.bind() to prepend ourselves as an argument
        xhr.onreadystatechange = this.func.bind(null, this);

        return xhr;
    }
};

/** Class: Strophe.Bosh
 *  _Private_ helper class that handles BOSH Connections
 *
 *  The Strophe.Bosh class is used internally by Strophe.Connection
 *  to encapsulate BOSH sessions. It is not meant to be used from user's code.
 */

/** File: bosh.js
 *  A JavaScript library to enable BOSH in Strophejs.
 *
 *  this library uses Bidirectional-streams Over Synchronous HTTP (BOSH)
 *  to emulate a persistent, stateful, two-way connection to an XMPP server.
 *  More information on BOSH can be found in XEP 124.
 */

/** PrivateConstructor: Strophe.Bosh
 *  Create and initialize a Strophe.Bosh object.
 *
 *  Parameters:
 *    (Strophe.Connection) connection - The Strophe.Connection that will use BOSH.
 *
 *  Returns:
 *    A new Strophe.Bosh object.
 */
Strophe.Bosh = function(connection) {
    this._conn = connection;
    /* request id for body tags */
    this.rid = Math.floor(Math.random() * 4294967295);
    /* The current session ID. */
    this.sid = null;

    // default BOSH values
    this.hold = 1;
    this.wait = 60;
    this.window = 5;

    this._requests = [];
};

Strophe.Bosh.prototype = {
    /** Variable: strip
     *
     *  BOSH-Connections will have all stanzas wrapped in a <body> tag when
     *  passed to <Strophe.Connection.xmlInput> or <Strophe.Connection.xmlOutput>.
     *  To strip this tag, User code can set <Strophe.Bosh.strip> to "body":
     *
     *  > Strophe.Bosh.prototype.strip = "body";
     *
     *  This will enable stripping of the body tag in both
     *  <Strophe.Connection.xmlInput> and <Strophe.Connection.xmlOutput>.
     */
    strip: null,

    /** PrivateFunction: _buildBody
     *  _Private_ helper function to generate the <body/> wrapper for BOSH.
     *
     *  Returns:
     *    A Strophe.Builder with a <body/> element.
     */
    _buildBody: function ()
    {
        var bodyWrap = $build('body', {
            rid: this.rid++,
            xmlns: Strophe.NS.HTTPBIND
        });

        if (this.sid !== null) {
            bodyWrap.attrs({sid: this.sid});
        }

        return bodyWrap;
    },

    /** PrivateFunction: _reset
     *  Reset the connection.
     *
     *  This function is called by the reset function of the Strophe Connection
     */
    _reset: function ()
    {
        this.rid = Math.floor(Math.random() * 4294967295);
        this.sid = null;
    },

    /** PrivateFunction: _connect
     *  _Private_ function that initializes the BOSH connection.
     *
     *  Creates and sends the Request that initializes the BOSH connection.
     */
    _connect: function (wait, hold, route)
    {
        this.wait = wait || this.wait;
        this.hold = hold || this.hold;

        // build the body tag
        var body = this._buildBody().attrs({
            to: this._conn.domain,
            "xml:lang": "en",
            wait: this.wait,
            hold: this.hold,
            content: "text/xml; charset=utf-8",
            ver: "1.6",
            "xmpp:version": "1.0",
            "xmlns:xmpp": Strophe.NS.BOSH
        });

        if(route){
            body.attrs({
                route: route
            });
        }

        var _connect_cb = this._conn._connect_cb;

        this._requests.push(
            new Strophe.Request(body.tree(),
                                this._onRequestStateChange.bind(
                                    this, _connect_cb.bind(this._conn)),
                                body.tree().getAttribute("rid")));
        this._throttledRequestHandler();
    },

    /** PrivateFunction: _attach
     *  Attach to an already created and authenticated BOSH session.
     *
     *  This function is provided to allow Strophe to attach to BOSH
     *  sessions which have been created externally, perhaps by a Web
     *  application.  This is often used to support auto-login type features
     *  without putting user credentials into the page.
     *
     *  Parameters:
     *    (String) jid - The full JID that is bound by the session.
     *    (String) sid - The SID of the BOSH session.
     *    (String) rid - The current RID of the BOSH session.  This RID
     *      will be used by the next request.
     *    (Function) callback The connect callback function.
     *    (Integer) wait - The optional HTTPBIND wait value.  This is the
     *      time the server will wait before returning an empty result for
     *      a request.  The default setting of 60 seconds is recommended.
     *      Other settings will require tweaks to the Strophe.TIMEOUT value.
     *    (Integer) hold - The optional HTTPBIND hold value.  This is the
     *      number of connections the server will hold at one time.  This
     *      should almost always be set to 1 (the default).
     *    (Integer) wind - The optional HTTBIND window value.  This is the
     *      allowed range of request ids that are valid.  The default is 5.
     */
    _attach: function (jid, sid, rid, callback, wait, hold, wind)
    {
        this._conn.jid = jid;
        this.sid = sid;
        this.rid = rid;

        this._conn.connect_callback = callback;

        this._conn.domain = Strophe.getDomainFromJid(this._conn.jid);

        this._conn.authenticated = true;
        this._conn.connected = true;

        this.wait = wait || this.wait;
        this.hold = hold || this.hold;
        this.window = wind || this.window;

        this._conn._changeConnectStatus(Strophe.Status.ATTACHED, null);
    },

    /** PrivateFunction: _connect_cb
     *  _Private_ handler for initial connection request.
     *
     *  This handler is used to process the Bosh-part of the initial request.
     *  Parameters:
     *    (Strophe.Request) bodyWrap - The received stanza.
     */
    _connect_cb: function (bodyWrap)
    {
        var typ = bodyWrap.getAttribute("type");
        var cond, conflict;
        if (typ !== null && typ == "terminate") {
            // an error occurred
            Strophe.error("BOSH-Connection failed: " + cond);
            cond = bodyWrap.getAttribute("condition");
            conflict = bodyWrap.getElementsByTagName("conflict");
            if (cond !== null) {
                if (cond == "remote-stream-error" && conflict.length > 0) {
                    cond = "conflict";
                }
                this._conn._changeConnectStatus(Strophe.Status.CONNFAIL, cond);
            } else {
                this._conn._changeConnectStatus(Strophe.Status.CONNFAIL, "unknown");
            }
            this._conn._doDisconnect();
            return Strophe.Status.CONNFAIL;
        }

        // check to make sure we don't overwrite these if _connect_cb is
        // called multiple times in the case of missing stream:features
        if (!this.sid) {
            this.sid = bodyWrap.getAttribute("sid");
        }
        var wind = bodyWrap.getAttribute('requests');
        if (wind) { this.window = parseInt(wind, 10); }
        var hold = bodyWrap.getAttribute('hold');
        if (hold) { this.hold = parseInt(hold, 10); }
        var wait = bodyWrap.getAttribute('wait');
        if (wait) { this.wait = parseInt(wait, 10); }
    },

    /** PrivateFunction: _disconnect
     *  _Private_ part of Connection.disconnect for Bosh
     *
     *  Parameters:
     *    (Request) pres - This stanza will be sent before disconnecting.
     */
    _disconnect: function (pres)
    {
        this._sendTerminate(pres);
    },

    /** PrivateFunction: _doDisconnect
     *  _Private_ function to disconnect.
     *
     *  Resets the SID and RID.
     */
    _doDisconnect: function ()
    {
        this.sid = null;
        this.rid = Math.floor(Math.random() * 4294967295);
    },

    /** PrivateFunction: _emptyQueue
     * _Private_ function to check if the Request queue is empty.
     *
     *  Returns:
     *    True, if there are no Requests queued, False otherwise.
     */
    _emptyQueue: function ()
    {
        return this._requests.length === 0;
    },

    /** PrivateFunction: _hitError
     *  _Private_ function to handle the error count.
     *
     *  Requests are resent automatically until their error count reaches
     *  5.  Each time an error is encountered, this function is called to
     *  increment the count and disconnect if the count is too high.
     *
     *  Parameters:
     *    (Integer) reqStatus - The request status.
     */
    _hitError: function (reqStatus)
    {
        this.errors++;
        Strophe.warn("request errored, status: " + reqStatus +
                     ", number of errors: " + this.errors);
        if (this.errors > 4) {
            this._onDisconnectTimeout();
        }
    },

    /** PrivateFunction: _no_auth_received
     *
     * Called on stream start/restart when no stream:features
     * has been received and sends a blank poll request.
     */
    _no_auth_received: function (_callback)
    {
        if (_callback) {
            _callback = _callback.bind(this._conn);
        } else {
            _callback = this._conn._connect_cb.bind(this._conn);
        }
        var body = this._buildBody();
        this._requests.push(
                new Strophe.Request(body.tree(),
                    this._onRequestStateChange.bind(
                        this, _callback.bind(this._conn)),
                    body.tree().getAttribute("rid")));
        this._throttledRequestHandler();
    },

    /** PrivateFunction: _onDisconnectTimeout
     *  _Private_ timeout handler for handling non-graceful disconnection.
     *
     *  Cancels all remaining Requests and clears the queue.
     */
    _onDisconnectTimeout: function ()
    {
        var req;
        while (this._requests.length > 0) {
            req = this._requests.pop();
            req.abort = true;
            req.xhr.abort();
            // jslint complains, but this is fine. setting to empty func
            // is necessary for IE6
            req.xhr.onreadystatechange = function () {}; // jshint ignore:line
        }
    },

    /** PrivateFunction: _onIdle
     *  _Private_ handler called by Strophe.Connection._onIdle
     *
     *  Sends all queued Requests or polls with empty Request if there are none.
     */
    _onIdle: function () {
        var data = this._conn._data;

        // if no requests are in progress, poll
        if (this._conn.authenticated && this._requests.length === 0 &&
            data.length === 0 && !this._conn.disconnecting) {
            Strophe.info("no requests during idle cycle, sending " +
                         "blank request");
            data.push(null);
        }

        if (this._requests.length < 2 && data.length > 0 &&
            !this._conn.paused) {
            var body = this._buildBody();
            for (var i = 0; i < data.length; i++) {
                if (data[i] !== null) {
                    if (data[i] === "restart") {
                        body.attrs({
                            to: this._conn.domain,
                            "xml:lang": "en",
                            "xmpp:restart": "true",
                            "xmlns:xmpp": Strophe.NS.BOSH
                        });
                    } else {
                        body.cnode(data[i]).up();
                    }
                }
            }
            delete this._conn._data;
            this._conn._data = [];
            this._requests.push(
                new Strophe.Request(body.tree(),
                                    this._onRequestStateChange.bind(
                                        this, this._conn._dataRecv.bind(this._conn)),
                                    body.tree().getAttribute("rid")));
            this._processRequest(this._requests.length - 1);
        }

        if (this._requests.length > 0) {
            var time_elapsed = this._requests[0].age();
            if (this._requests[0].dead !== null) {
                if (this._requests[0].timeDead() >
                    Math.floor(Strophe.SECONDARY_TIMEOUT * this.wait)) {
                    this._throttledRequestHandler();
                }
            }

            if (time_elapsed > Math.floor(Strophe.TIMEOUT * this.wait)) {
                Strophe.warn("Request " +
                             this._requests[0].id +
                             " timed out, over " + Math.floor(Strophe.TIMEOUT * this.wait) +
                             " seconds since last activity");
                this._throttledRequestHandler();
            }
        }
    },

    /** PrivateFunction: _onRequestStateChange
     *  _Private_ handler for Strophe.Request state changes.
     *
     *  This function is called when the XMLHttpRequest readyState changes.
     *  It contains a lot of error handling logic for the many ways that
     *  requests can fail, and calls the request callback when requests
     *  succeed.
     *
     *  Parameters:
     *    (Function) func - The handler for the request.
     *    (Strophe.Request) req - The request that is changing readyState.
     */
    _onRequestStateChange: function (func, req)
    {
        Strophe.debug("request id " + req.id +
                      "." + req.sends + " state changed to " +
                      req.xhr.readyState);

        if (req.abort) {
            req.abort = false;
            return;
        }

        // request complete
        var reqStatus;
        if (req.xhr.readyState == 4) {
            reqStatus = 0;
            try {
                reqStatus = req.xhr.status;
            } catch (e) {
                // ignore errors from undefined status attribute.  works
                // around a browser bug
            }

            if (typeof(reqStatus) == "undefined") {
                reqStatus = 0;
            }

            if (this.disconnecting) {
                if (reqStatus >= 400) {
                    this._hitError(reqStatus);
                    return;
                }
            }

            var reqIs0 = (this._requests[0] == req);
            var reqIs1 = (this._requests[1] == req);

            if ((reqStatus > 0 && reqStatus < 500) || req.sends > 5) {
                // remove from internal queue
                this._removeRequest(req);
                Strophe.debug("request id " +
                              req.id +
                              " should now be removed");
            }

            // request succeeded
            if (reqStatus == 200) {
                // if request 1 finished, or request 0 finished and request
                // 1 is over Strophe.SECONDARY_TIMEOUT seconds old, we need to
                // restart the other - both will be in the first spot, as the
                // completed request has been removed from the queue already
                if (reqIs1 ||
                    (reqIs0 && this._requests.length > 0 &&
                     this._requests[0].age() > Math.floor(Strophe.SECONDARY_TIMEOUT * this.wait))) {
                    this._restartRequest(0);
                }
                // call handler
                Strophe.debug("request id " +
                              req.id + "." +
                              req.sends + " got 200");
                func(req);
                this.errors = 0;
            } else {
                Strophe.error("request id " +
                              req.id + "." +
                              req.sends + " error " + reqStatus +
                              " happened");
                if (reqStatus === 0 ||
                    (reqStatus >= 400 && reqStatus < 600) ||
                    reqStatus >= 12000) {
                    this._hitError(reqStatus);
                    if (reqStatus >= 400 && reqStatus < 500) {
                        this._conn._changeConnectStatus(Strophe.Status.DISCONNECTING,
                                                  null);
                        this._conn._doDisconnect();
                    }
                }
            }

            if (!((reqStatus > 0 && reqStatus < 500) ||
                  req.sends > 5)) {
                this._throttledRequestHandler();
            }
        }
    },

    /** PrivateFunction: _processRequest
     *  _Private_ function to process a request in the queue.
     *
     *  This function takes requests off the queue and sends them and
     *  restarts dead requests.
     *
     *  Parameters:
     *    (Integer) i - The index of the request in the queue.
     */
    _processRequest: function (i)
    {
        var self = this;
        var req = this._requests[i];
        var reqStatus = -1;

        try {
            if (req.xhr.readyState == 4) {
                reqStatus = req.xhr.status;
            }
        } catch (e) {
            Strophe.error("caught an error in _requests[" + i +
                          "], reqStatus: " + reqStatus);
        }

        if (typeof(reqStatus) == "undefined") {
            reqStatus = -1;
        }

        // make sure we limit the number of retries
        if (req.sends > this.maxRetries) {
            this._onDisconnectTimeout();
            return;
        }

        var time_elapsed = req.age();
        var primaryTimeout = (!isNaN(time_elapsed) &&
                              time_elapsed > Math.floor(Strophe.TIMEOUT * this.wait));
        var secondaryTimeout = (req.dead !== null &&
                                req.timeDead() > Math.floor(Strophe.SECONDARY_TIMEOUT * this.wait));
        var requestCompletedWithServerError = (req.xhr.readyState == 4 &&
                                               (reqStatus < 1 ||
                                                reqStatus >= 500));
        if (primaryTimeout || secondaryTimeout ||
            requestCompletedWithServerError) {
            if (secondaryTimeout) {
                Strophe.error("Request " +
                              this._requests[i].id +
                              " timed out (secondary), restarting");
            }
            req.abort = true;
            req.xhr.abort();
            // setting to null fails on IE6, so set to empty function
            req.xhr.onreadystatechange = function () {};
            this._requests[i] = new Strophe.Request(req.xmlData,
                                                    req.origFunc,
                                                    req.rid,
                                                    req.sends);
            req = this._requests[i];
        }

        if (req.xhr.readyState === 0) {
            Strophe.debug("request id " + req.id +
                          "." + req.sends + " posting");

            try {
                req.xhr.open("POST", this._conn.service, this._conn.options.sync ? false : true);
            } catch (e2) {
                Strophe.error("XHR open failed.");
                if (!this._conn.connected) {
                    this._conn._changeConnectStatus(Strophe.Status.CONNFAIL,
                                              "bad-service");
                }
                this._conn.disconnect();
                return;
            }

            // Fires the XHR request -- may be invoked immediately
            // or on a gradually expanding retry window for reconnects
            var sendFunc = function () {
                req.date = new Date();
                if (self._conn.options.customHeaders){
                    var headers = self._conn.options.customHeaders;
                    for (var header in headers) {
                        if (headers.hasOwnProperty(header)) {
                            req.xhr.setRequestHeader(header, headers[header]);
                        }
                    }
                }
                req.xhr.send(req.data);
            };

            // Implement progressive backoff for reconnects --
            // First retry (send == 1) should also be instantaneous
            if (req.sends > 1) {
                // Using a cube of the retry number creates a nicely
                // expanding retry window
                var backoff = Math.min(Math.floor(Strophe.TIMEOUT * this.wait),
                                       Math.pow(req.sends, 3)) * 1000;
                setTimeout(sendFunc, backoff);
            } else {
                sendFunc();
            }

            req.sends++;

            if (this._conn.xmlOutput !== Strophe.Connection.prototype.xmlOutput) {
                if (req.xmlData.nodeName === this.strip && req.xmlData.childNodes.length) {
                    this._conn.xmlOutput(req.xmlData.childNodes[0]);
                } else {
                    this._conn.xmlOutput(req.xmlData);
                }
            }
            if (this._conn.rawOutput !== Strophe.Connection.prototype.rawOutput) {
                this._conn.rawOutput(req.data);
            }
        } else {
            Strophe.debug("_processRequest: " +
                          (i === 0 ? "first" : "second") +
                          " request has readyState of " +
                          req.xhr.readyState);
        }
    },

    /** PrivateFunction: _removeRequest
     *  _Private_ function to remove a request from the queue.
     *
     *  Parameters:
     *    (Strophe.Request) req - The request to remove.
     */
    _removeRequest: function (req)
    {
        Strophe.debug("removing request");

        var i;
        for (i = this._requests.length - 1; i >= 0; i--) {
            if (req == this._requests[i]) {
                this._requests.splice(i, 1);
            }
        }

        // IE6 fails on setting to null, so set to empty function
        req.xhr.onreadystatechange = function () {};

        this._throttledRequestHandler();
    },

    /** PrivateFunction: _restartRequest
     *  _Private_ function to restart a request that is presumed dead.
     *
     *  Parameters:
     *    (Integer) i - The index of the request in the queue.
     */
    _restartRequest: function (i)
    {
        var req = this._requests[i];
        if (req.dead === null) {
            req.dead = new Date();
        }

        this._processRequest(i);
    },

    /** PrivateFunction: _reqToData
     * _Private_ function to get a stanza out of a request.
     *
     * Tries to extract a stanza out of a Request Object.
     * When this fails the current connection will be disconnected.
     *
     *  Parameters:
     *    (Object) req - The Request.
     *
     *  Returns:
     *    The stanza that was passed.
     */
    _reqToData: function (req)
    {
        try {
            return req.getResponse();
        } catch (e) {
            if (e != "parsererror") { throw e; }
            this._conn.disconnect("strophe-parsererror");
        }
    },

    /** PrivateFunction: _sendTerminate
     *  _Private_ function to send initial disconnect sequence.
     *
     *  This is the first step in a graceful disconnect.  It sends
     *  the BOSH server a terminate body and includes an unavailable
     *  presence if authentication has completed.
     */
    _sendTerminate: function (pres)
    {
        Strophe.info("_sendTerminate was called");
        var body = this._buildBody().attrs({type: "terminate"});

        if (pres) {
            body.cnode(pres.tree());
        }

        var req = new Strophe.Request(body.tree(),
                                      this._onRequestStateChange.bind(
                                          this, this._conn._dataRecv.bind(this._conn)),
                                      body.tree().getAttribute("rid"));

        this._requests.push(req);
        this._throttledRequestHandler();
    },

    /** PrivateFunction: _send
     *  _Private_ part of the Connection.send function for BOSH
     *
     * Just triggers the RequestHandler to send the messages that are in the queue
     */
    _send: function () {
        clearTimeout(this._conn._idleTimeout);
        this._throttledRequestHandler();
        this._conn._idleTimeout = setTimeout(this._conn._onIdle.bind(this._conn), 100);
    },

    /** PrivateFunction: _sendRestart
     *
     *  Send an xmpp:restart stanza.
     */
    _sendRestart: function ()
    {
        this._throttledRequestHandler();
        clearTimeout(this._conn._idleTimeout);
    },

    /** PrivateFunction: _throttledRequestHandler
     *  _Private_ function to throttle requests to the connection window.
     *
     *  This function makes sure we don't send requests so fast that the
     *  request ids overflow the connection window in the case that one
     *  request died.
     */
    _throttledRequestHandler: function ()
    {
        if (!this._requests) {
            Strophe.debug("_throttledRequestHandler called with " +
                          "undefined requests");
        } else {
            Strophe.debug("_throttledRequestHandler called with " +
                          this._requests.length + " requests");
        }

        if (!this._requests || this._requests.length === 0) {
            return;
        }

        if (this._requests.length > 0) {
            this._processRequest(0);
        }

        if (this._requests.length > 1 &&
            Math.abs(this._requests[0].rid -
                     this._requests[1].rid) < this.window) {
            this._processRequest(1);
        }
    }
};

/*
    This program is distributed under the terms of the MIT license.
    Please see the LICENSE file for details.

    Copyright 2006-2008, OGG, LLC
*/

/* jshint undef: true, unused: true:, noarg: true, latedef: true */
/*global document, window, clearTimeout, WebSocket,
    DOMParser, Strophe, $build */

/** Class: Strophe.WebSocket
 *  _Private_ helper class that handles WebSocket Connections
 *
 *  The Strophe.WebSocket class is used internally by Strophe.Connection
 *  to encapsulate WebSocket sessions. It is not meant to be used from user's code.
 */

/** File: websocket.js
 *  A JavaScript library to enable XMPP over Websocket in Strophejs.
 *
 *  This file implements XMPP over WebSockets for Strophejs.
 *  If a Connection is established with a Websocket url (ws://...)
 *  Strophe will use WebSockets.
 *  For more information on XMPP-over WebSocket see this RFC draft:
 *  http://tools.ietf.org/html/draft-ietf-xmpp-websocket-00
 *
 *  WebSocket support implemented by Andreas Guth (andreas.guth@rwth-aachen.de)
 */

/** PrivateConstructor: Strophe.Websocket
 *  Create and initialize a Strophe.WebSocket object.
 *  Currently only sets the connection Object.
 *
 *  Parameters:
 *    (Strophe.Connection) connection - The Strophe.Connection that will use WebSockets.
 *
 *  Returns:
 *    A new Strophe.WebSocket object.
 */
Strophe.Websocket = function(connection) {
    this._conn = connection;
    this.strip = "stream:stream";

    var service = connection.service;
    if (service.indexOf("ws:") !== 0 && service.indexOf("wss:") !== 0) {
        // If the service is not an absolute URL, assume it is a path and put the absolute
        // URL together from options, current URL and the path.
        var new_service = "";

        if (connection.options.protocol === "ws" && window.location.protocol !== "https:") {
            new_service += "ws";
        } else {
            new_service += "wss";
        }

        new_service += "://" + window.location.host;

        if (service.indexOf("/") !== 0) {
            new_service += window.location.pathname + service;
        } else {
            new_service += service;
        }

        connection.service = new_service;
    }
};

Strophe.Websocket.prototype = {
    /** PrivateFunction: _buildStream
     *  _Private_ helper function to generate the <stream> start tag for WebSockets
     *
     *  Returns:
     *    A Strophe.Builder with a <stream> element.
     */
    _buildStream: function ()
    {
        return $build("stream:stream", {
            "to": this._conn.domain,
            "xmlns": Strophe.NS.CLIENT,
            "xmlns:stream": Strophe.NS.STREAM,
            "version": '1.0'
        });
    },

    /** PrivateFunction: _check_streamerror
     * _Private_ checks a message for stream:error
     *
     *  Parameters:
     *    (Strophe.Request) bodyWrap - The received stanza.
     *    connectstatus - The ConnectStatus that will be set on error.
     *  Returns:
     *     true if there was a streamerror, false otherwise.
     */
    _check_streamerror: function (bodyWrap, connectstatus) {
        var errors = bodyWrap.getElementsByTagName("stream:error");
        if (errors.length === 0) {
            return false;
        }
        var error = errors[0];

        var condition = "";
        var text = "";

        var ns = "urn:ietf:params:xml:ns:xmpp-streams";
        for (var i = 0; i < error.childNodes.length; i++) {
            var e = error.childNodes[i];
            if (e.getAttribute("xmlns") !== ns) {
                break;
            } if (e.nodeName === "text") {
                text = e.textContent;
            } else {
                condition = e.nodeName;
            }
        }

        var errorString = "WebSocket stream error: ";

        if (condition) {
            errorString += condition;
        } else {
            errorString += "unknown";
        }

        if (text) {
            errorString += " - " + condition;
        }

        Strophe.error(errorString);

        // close the connection on stream_error
        this._conn._changeConnectStatus(connectstatus, condition);
        this._conn._doDisconnect();
        return true;
    },

    /** PrivateFunction: _reset
     *  Reset the connection.
     *
     *  This function is called by the reset function of the Strophe Connection.
     *  Is not needed by WebSockets.
     */
    _reset: function ()
    {
        return;
    },

    /** PrivateFunction: _connect
     *  _Private_ function called by Strophe.Connection.connect
     *
     *  Creates a WebSocket for a connection and assigns Callbacks to it.
     *  Does nothing if there already is a WebSocket.
     */
    _connect: function () {
        // Ensure that there is no open WebSocket from a previous Connection.
        this._closeSocket();

        // Create the new WobSocket
        this.socket = new WebSocket(this._conn.service, "xmpp");
        this.socket.onopen = this._onOpen.bind(this);
        this.socket.onerror = this._onError.bind(this);
        this.socket.onclose = this._onClose.bind(this);
        this.socket.onmessage = this._connect_cb_wrapper.bind(this);
    },

    /** PrivateFunction: _connect_cb
     *  _Private_ function called by Strophe.Connection._connect_cb
     *
     * checks for stream:error
     *
     *  Parameters:
     *    (Strophe.Request) bodyWrap - The received stanza.
     */
    _connect_cb: function(bodyWrap) {
        var error = this._check_streamerror(bodyWrap, Strophe.Status.CONNFAIL);
        if (error) {
            return Strophe.Status.CONNFAIL;
        }
    },

    /** PrivateFunction: _handleStreamStart
     * _Private_ function that checks the opening stream:stream tag for errors.
     *
     * Disconnects if there is an error and returns false, true otherwise.
     *
     *  Parameters:
     *    (Node) message - Stanza containing the stream:stream.
     */
    _handleStreamStart: function(message) {
        var error = false;
        // Check for errors in the stream:stream tag
        var ns = message.getAttribute("xmlns");
        if (typeof ns !== "string") {
            error = "Missing xmlns in stream:stream";
        } else if (ns !== Strophe.NS.CLIENT) {
            error = "Wrong xmlns in stream:stream: " + ns;
        }

        var ns_stream = message.namespaceURI;
        if (typeof ns_stream !== "string") {
            error = "Missing xmlns:stream in stream:stream";
        } else if (ns_stream !== Strophe.NS.STREAM) {
            error = "Wrong xmlns:stream in stream:stream: " + ns_stream;
        }

        var ver = message.getAttribute("version");
        if (typeof ver !== "string") {
            error = "Missing version in stream:stream";
        } else if (ver !== "1.0") {
            error = "Wrong version in stream:stream: " + ver;
        }

        if (error) {
            this._conn._changeConnectStatus(Strophe.Status.CONNFAIL, error);
            this._conn._doDisconnect();
            return false;
        }

        return true;
    },

    /** PrivateFunction: _connect_cb_wrapper
     * _Private_ function that handles the first connection messages.
     *
     * On receiving an opening stream tag this callback replaces itself with the real
     * message handler. On receiving a stream error the connection is terminated.
     */
    _connect_cb_wrapper: function(message) {
        if (message.data.indexOf("<stream:stream ") === 0 || message.data.indexOf("<?xml") === 0) {
            // Strip the XML Declaration, if there is one
            var data = message.data.replace(/^(<\?.*?\?>\s*)*/, "");
            if (data === '') return;

            //Make the initial stream:stream selfclosing to parse it without a SAX parser.
            data = message.data.replace(/<stream:stream (.*[^\/])>/, "<stream:stream $1/>");

            var streamStart = new DOMParser().parseFromString(data, "text/xml").documentElement;
            this._conn.xmlInput(streamStart);
            this._conn.rawInput(message.data);

            //_handleStreamSteart will check for XML errors and disconnect on error
            if (this._handleStreamStart(streamStart)) {

                //_connect_cb will check for stream:error and disconnect on error
                this._connect_cb(streamStart);

                // ensure received stream:stream is NOT selfclosing and save it for following messages
                this.streamStart = message.data.replace(/^<stream:(.*)\/>$/, "<stream:$1>");
            }
        } else if (message.data === "</stream:stream>") {
            this._conn.rawInput(message.data);
            this._conn.xmlInput(document.createElement("stream:stream"));
            this._conn._changeConnectStatus(Strophe.Status.CONNFAIL, "Received closing stream");
            this._conn._doDisconnect();
            return;
        } else {
            var string = this._streamWrap(message.data);
            var elem = new DOMParser().parseFromString(string, "text/xml").documentElement;
            this.socket.onmessage = this._onMessage.bind(this);
            this._conn._connect_cb(elem, null, message.data);
        }
    },

    /** PrivateFunction: _disconnect
     *  _Private_ function called by Strophe.Connection.disconnect
     *
     *  Disconnects and sends a last stanza if one is given
     *
     *  Parameters:
     *    (Request) pres - This stanza will be sent before disconnecting.
     */
    _disconnect: function (pres)
    {
        if (this.socket.readyState !== WebSocket.CLOSED) {
            if (pres) {
                this._conn.send(pres);
            }
            var close = '</stream:stream>';
            this._conn.xmlOutput(document.createElement("stream:stream"));
            this._conn.rawOutput(close);
            try {
                this.socket.send(close);
            } catch (e) {
                Strophe.info("Couldn't send closing stream tag.");
            }
        }

        this._conn._doDisconnect();
    },

    /** PrivateFunction: _doDisconnect
     *  _Private_ function to disconnect.
     *
     *  Just closes the Socket for WebSockets
     */
    _doDisconnect: function ()
    {
        Strophe.info("WebSockets _doDisconnect was called");
        this._closeSocket();
    },

    /** PrivateFunction _streamWrap
     *  _Private_ helper function to wrap a stanza in a <stream> tag.
     *  This is used so Strophe can process stanzas from WebSockets like BOSH
     */
    _streamWrap: function (stanza)
    {
        return this.streamStart + stanza + '</stream:stream>';
    },


    /** PrivateFunction: _closeSocket
     *  _Private_ function to close the WebSocket.
     *
     *  Closes the socket if it is still open and deletes it
     */
    _closeSocket: function ()
    {
        if (this.socket) { try {
            this.socket.close();
        } catch (e) {} }
        this.socket = null;
    },

    /** PrivateFunction: _emptyQueue
     * _Private_ function to check if the message queue is empty.
     *
     *  Returns:
     *    True, because WebSocket messages are send immediately after queueing.
     */
    _emptyQueue: function ()
    {
        return true;
    },

    /** PrivateFunction: _onClose
     * _Private_ function to handle websockets closing.
     *
     * Nothing to do here for WebSockets
     */
    _onClose: function() {
        if(this._conn.connected && !this._conn.disconnecting) {
            Strophe.error("Websocket closed unexcectedly");
            this._conn._doDisconnect();
        } else {
            Strophe.info("Websocket closed");
        }
    },

    /** PrivateFunction: _no_auth_received
     *
     * Called on stream start/restart when no stream:features
     * has been received.
     */
    _no_auth_received: function (_callback)
    {
        Strophe.error("Server did not send any auth methods");
        this._conn._changeConnectStatus(Strophe.Status.CONNFAIL, "Server did not send any auth methods");
        if (_callback) {
            _callback = _callback.bind(this._conn);
            _callback();
        }
        this._conn._doDisconnect();
    },

    /** PrivateFunction: _onDisconnectTimeout
     *  _Private_ timeout handler for handling non-graceful disconnection.
     *
     *  This does nothing for WebSockets
     */
    _onDisconnectTimeout: function () {},

    /** PrivateFunction: _onError
     * _Private_ function to handle websockets errors.
     *
     * Parameters:
     * (Object) error - The websocket error.
     */
    _onError: function(error) {
        Strophe.error("Websocket error " + error);
        this._conn._changeConnectStatus(Strophe.Status.CONNFAIL, "The WebSocket connection could not be established was disconnected.");
        this._disconnect();
    },

    /** PrivateFunction: _onIdle
     *  _Private_ function called by Strophe.Connection._onIdle
     *
     *  sends all queued stanzas
     */
    _onIdle: function () {
        var data = this._conn._data;
        if (data.length > 0 && !this._conn.paused) {
            for (var i = 0; i < data.length; i++) {
                if (data[i] !== null) {
                    var stanza, rawStanza;
                    if (data[i] === "restart") {
                        stanza = this._buildStream();
                        rawStanza = this._removeClosingTag(stanza);
                        stanza = stanza.tree();
                    } else {
                        stanza = data[i];
                        rawStanza = Strophe.serialize(stanza);
                    }
                    this._conn.xmlOutput(stanza);
                    this._conn.rawOutput(rawStanza);
                    this.socket.send(rawStanza);
                }
            }
            this._conn._data = [];
        }
    },

    /** PrivateFunction: _onMessage
     * _Private_ function to handle websockets messages.
     *
     * This function parses each of the messages as if they are full documents. [TODO : We may actually want to use a SAX Push parser].
     *
     * Since all XMPP traffic starts with "<stream:stream version='1.0' xml:lang='en' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' id='3697395463' from='SERVER'>"
     * The first stanza will always fail to be parsed...
     * Addtionnaly, the seconds stanza will always be a <stream:features> with the stream NS defined in the previous stanza... so we need to 'force' the inclusion of the NS in this stanza!
     *
     * Parameters:
     * (string) message - The websocket message.
     */
    _onMessage: function(message) {
        var elem, data;
        // check for closing stream
        if (message.data === "</stream:stream>") {
            var close = "</stream:stream>";
            this._conn.rawInput(close);
            this._conn.xmlInput(document.createElement("stream:stream"));
            if (!this._conn.disconnecting) {
                this._conn._doDisconnect();
            }
            return;
        } else if (message.data.search("<stream:stream ") === 0) {
            //Make the initial stream:stream selfclosing to parse it without a SAX parser.
            data = message.data.replace(/<stream:stream (.*[^\/])>/, "<stream:stream $1/>");
            elem = new DOMParser().parseFromString(data, "text/xml").documentElement;

            if (!this._handleStreamStart(elem)) {
                return;
            }
        } else {
            data = this._streamWrap(message.data);
            elem = new DOMParser().parseFromString(data, "text/xml").documentElement;
        }

        if (this._check_streamerror(elem, Strophe.Status.ERROR)) {
            return;
        }

        //handle unavailable presence stanza before disconnecting
        if (this._conn.disconnecting &&
                elem.firstChild.nodeName === "presence" &&
                elem.firstChild.getAttribute("type") === "unavailable") {
            this._conn.xmlInput(elem);
            this._conn.rawInput(Strophe.serialize(elem));
            // if we are already disconnecting we will ignore the unavailable stanza and
            // wait for the </stream:stream> tag before we close the connection
            return;
        }
        this._conn._dataRecv(elem, message.data);
    },

    /** PrivateFunction: _onOpen
     * _Private_ function to handle websockets connection setup.
     *
     * The opening stream tag is sent here.
     */
    _onOpen: function() {
        Strophe.info("Websocket open");
        var start = this._buildStream();
        this._conn.xmlOutput(start.tree());

        var startString = this._removeClosingTag(start);
        this._conn.rawOutput(startString);
        this.socket.send(startString);
    },

    /** PrivateFunction: _removeClosingTag
     *  _Private_ function to Make the first <stream:stream> non-selfclosing
     *
     *  Parameters:
     *      (Object) elem - The <stream:stream> tag.
     *
     *  Returns:
     *      The stream:stream tag as String
     */
    _removeClosingTag: function(elem) {
        var string = Strophe.serialize(elem);
        string = string.replace(/<(stream:stream .*[^\/])\/>$/, "<$1>");
        return string;
    },

    /** PrivateFunction: _reqToData
     * _Private_ function to get a stanza out of a request.
     *
     * WebSockets don't use requests, so the passed argument is just returned.
     *
     *  Parameters:
     *    (Object) stanza - The stanza.
     *
     *  Returns:
     *    The stanza that was passed.
     */
    _reqToData: function (stanza)
    {
        return stanza;
    },

    /** PrivateFunction: _send
     *  _Private_ part of the Connection.send function for WebSocket
     *
     * Just flushes the messages that are in the queue
     */
    _send: function () {
        this._conn.flush();
    },

    /** PrivateFunction: _sendRestart
     *
     *  Send an xmpp:restart stanza.
     */
    _sendRestart: function ()
    {
        clearTimeout(this._conn._idleTimeout);
        this._conn._onIdle.bind(this._conn)();
    }
};

return root.Strophe = Strophe;
  }).apply(root, arguments);
});
}(this));

/*jshint strict: false */
/*jshint unused: false */
define('modules/xmpp/xmppStrophe',[
    'promise',
    'strophe',
    'core/auth',
    'core/user',
    'core/events',
    'core/urls',
    'core/logger',
], function(Promise, Strophe, auth, user, events, urls, logger) {

    /**
     * xmpp module
     * @module module:xmpp
     * @memberof module:Origin
     */
    var clientResource = '';
    var connected = false;
    var connection = null;
    var connectionStatus = Strophe.Status.DISCONNECTED;
    var subStateMap = {
        none: 'NONE',
        to: 'TO',
        from: 'FROM',
        both: 'BOTH',
        remove: 'REMOVE'
    };

    var presenceStateMap = {
        unavailable: 'UNAVAILABLE',
        subscribe: 'SUBSCRIBE',
        subscribed: 'SUBSCRIBED',
        unsubscribe: 'UNSUBSCRIBE',
        unsubscribed: 'UNSUBSCRIBED',
        probe: 'PROBE',
        error: 'ERROR'
    };

    var showStateMap = {
        online: 'ONLINE',
        away: 'AWAY',
        chat: 'CHAT',
        dnd: 'DND',
        xa: 'XA'
    };

    window.onunload = function() {
        disconnectSync();
    };
    
    // TR This could/should be moved into a factory such as RosterDataFactory. For now I'll
    // put it here, as this is currently handled on the client-side for the Jingle XMPP implementation
    var blockList = {};
    var blockListLoaded = false;
    
    function enableCarbonCopy() {
        // Enable carbon copy
        var iq = $iq({
                type: 'set',
                xmlns: Strophe.NS.ROSTER,
                from: user.publicObjs.userPid() + '@' + urls.endPoints.xmppConfig.domain + '/' + clientResource
            })
            .c('enable', {
                xmlns: 'urn:xmpp:carbons:2'
            });
        connection.sendIQ(iq);
    }
    
    //disconnect synchronously(i.e. serially)
    function disconnectSync() {
        if (connection) {
            connection.flush();
            connection.options.sync = true;
            connection.disconnect();
        }
    }

    function onConnect(status) {
        connectionStatus = status;
        switch (status) {
            case Strophe.Status.CONNECTING:
                logger.log('[Strophe-Conn] Connecting');
                break;
                /* jshint ignore:start */
            case Strophe.Status.CONNECTED:
                connected = true;
                events.fire(events.XMPP_CONNECTED);
                //don't automatically do this -- integrator should do this on demand
                //publicObjs.xmpp.updatePresence();
                logger.log('[Strophe-Conn] Connected');
                enableCarbonCopy();
                /* jshint ignore:end */
                //fall through on purpose
            case Strophe.Status.ATTACHED:
                logger.log('[Strophe-Conn] Attached');
                break;

            case Strophe.Status.DISCONNECTING:
                logger.log('[Strophe-Conn] Disconnecting');
                break;

            case Strophe.Status.DISCONNECTED:
                connected = false;
                logger.log('[Strophe-Conn] Disconnected');
                break;

            case Strophe.Status.AUTHFAIL:
                logger.log('[Strophe-Conn] Authfail');
                break;

            case Strophe.Status.AUTHENTICATING:
                logger.log('[Strophe-Conn] Authenticating');
                break;

            case Strophe.Status.ERROR:
            case Strophe.Status.CONNFAIL:
                logger.log('[Strophe-Conn] Error/Connfail: (' + status + ')');
                break;

            default:
                logger.log('[Strophe-Conn] Should not be here');
                break;
        }

    }

    function parseGameActivity(presence) {
        var gameActivityInfo = {};
        var presenceType = presence.getAttribute('type'); 
        var activityElement = presence.querySelector('activity');
        if (activityElement && presenceStateMap[presenceType] !== presenceStateMap.unavailable) {
            //title;productId; JOINABLE/JOINABLE_INVITE_ONLY/INGAME;twitchPresence;gamePresence;multiplayerId;groupName;groupId
            var gameActivityStr = activityElement.textContent;
            var splitStrArray = gameActivityStr.split(';');
            var activitylen = splitStrArray.length;

            if (activitylen > 0) {
                gameActivityInfo.title = splitStrArray[0];
            }
            if (activitylen > 1) {
                gameActivityInfo.productId = splitStrArray[1];
            }
            if (activitylen > 2) {
                gameActivityInfo.joinable = (splitStrArray[2] === 'JOINABLE');
            }
            if (activitylen > 3) {
                gameActivityInfo.twitchPresence = splitStrArray[3];
            }
            if (activitylen > 4) {
                gameActivityInfo.gamePresence = splitStrArray[4];
            }
            if (activitylen > 5) {
                gameActivityInfo.multiplayerId = splitStrArray[5];
            }
            if (activitylen > 6) {
                gameActivityInfo.groupName = splitStrArray[6];
            }
            if (activitylen > 7) {
                gameActivityInfo.groupId = splitStrArray[7];
            }
            if (activitylen > 8) {
                gameActivityInfo.richPresence = splitStrArray[8];
            }
            // 9.X presence compatibility
            var presenceStatus = presence.querySelector('status'); 
            if(!!presenceStatus && !!gameActivityInfo.title && !gameActivityInfo.richPresence) {
                var richStatus = presenceStatus.textContent;
                gameActivityInfo.richPresence = richStatus.replace(gameActivityInfo.title, '');
            }
        }
        return gameActivityInfo;
    }

    function onPresence(presence) {
        //logger.log(presence);
        var presenceType = presence.getAttribute('type'); // unavailable, subscribed, etc...
        var from = presence.getAttribute('from'); // the jabber_id of the contact
        var to = presence.getAttribute('to'); // the jabber_id of the contact

        var jid = '';
        var nick = '';
        var itemElement = presence.getElementsByTagName('item');
        if (itemElement.length > 0) {
            var itemIndex = 0;
            while (itemIndex < itemElement.length) {
                jid = itemElement[itemIndex].getAttribute('jid');
                nick = itemElement[itemIndex].getAttribute('nick');

                if (jid === null || nick === null) {
                    itemIndex++;
                } else {
                    break;
                }
            }
        }

        var showElement = presence.querySelector('show');
        var show = null;
        var resource = Strophe.getResourceFromJid(from);
        var userId = Strophe.getNodeFromJid(from);
        var remoteOn = true;
        var presenceOut = presenceStateMap.available;
        var showOut = showStateMap.online;

        //check for gameactivity
        var gameActivityInfo = parseGameActivity(presence);
	
	var groupActivityInfo = {
	    groupId: gameActivityInfo.groupId,
	    groupName: gameActivityInfo.groupName
	};		
        //check to see if we detect an Origin Client
        if ((userId === user.publicObjs.userPid().toString()) && (resource.indexOf('origin') !== -1)) {
            clientResource = resource;
            if (presenceType === presenceStateMap.unavailable) {
                remoteOn = false;
                logger.log('disconnected from Origin Client');
            } else {
                remoteOn = true;
                logger.log('connected to Origin Client');
            }
            events.fire(events.priv.REMOTE_CLIENT_AVAILABLE, remoteOn);
        }


        if (showElement) {
            show = showElement.textContent;
            if (show) {
                showOut = showStateMap[show];
            }
        }

        if (presenceType) {
            presenceOut = presenceStateMap[presenceType];
        }

        //we run this off of the event loop otherwise all exceptions get swallowed up by strophe
        setTimeout(function() {
            events.fire(events.XMPP_PRESENCECHANGED, {
                jid: from,
                presenceType: presenceOut,
                show: showOut,
                gameActivity: gameActivityInfo,
                groupActivity: groupActivityInfo,
                to: to,
                from: jid, //TR 'from' and 'jid' are mismatched, perhaps this should be fixed up
                nick: nick
            });
        }, 0);
        return true;
    }

    function onMessage(msg) {
        var from = msg.getAttribute('from');
        var to = msg.getAttribute('to');
        var type = msg.getAttribute('type');
        var elems = msg.getElementsByTagName('body');
        var active = msg.getElementsByTagName('active');
        var inactive = msg.getElementsByTagName('inactive');
        var gone = msg.getElementsByTagName('gone');
        var composing = msg.getElementsByTagName('composing');
        var paused = msg.getElementsByTagName('paused');
        var userId = from.substring(0, from.indexOf('/'));
        var messageBody, chatState;

        // Handle carbon copy messages
        var sent = msg.getElementsByTagName('sent');
        if (sent.length) {
            var forwarded = sent[0].getElementsByTagName('forwarded');
            if (forwarded.length) {
                var message = forwarded[0].getElementsByTagName('message');
                if (message.length) {
                    onMessage(message[0]);
                    // we must return true to keep the handler alive.
                    // returning false would remove it after it finishes.
                    return true;
                }

            }
        }

        setTimeout(function() {
            var msgObject = {};
            if ((type === 'chat' || type === 'groupchat') && elems.length > 0) {
                if (active.length) {
                    chatState = 'ACTIVE';
                } else
                if (inactive.length) {
                    chatState = 'INACTIVE';
                } else
                if (gone.length) {
                    chatState = 'GONE';
                } else
                if (composing.length) {
                    chatState = 'COMPOSING';
                } else
                if (paused.length) {
                    chatState = 'PAUSED';
                }
                messageBody = Strophe.getText(elems[0]);

                events.fire(events.XMPP_INCOMINGMSG, {
                    jid: userId,
                    msgBody: messageBody,
                    chatState: chatState,
                    time: Date.now(),
                    from: from,
                    to: to
                });
            } else {
                messageBody = Strophe.getText(elems[0]).replace(/&quot;/g, '"');
                if (type !== 'origin-action') {
                    msgObject = JSON.parse(messageBody);
                    if (type === 'origin-response-fromclient' && elems.length > 0) {
                        events.fire(events.priv.REMOTE_CONFIRMATION_FROM_CLIENT, msgObject);
                    } else if (type === 'origin-action-fromclient' && elems.length > 0) {
                        events.fire(events.priv.REMOTE_STATUS_UPDATE_FROM_CLIENT, msgObject);
                    } else if (type === 'origin-init' && elems.length > 0) {
                        events.fire(events.priv.REMOTE_STATUS_GAMELISTUPDATED, msgObject);
                        events.fire(events.priv.REMOTE_STATUS_UPDATE, msgObject);
                    } else if (type === 'origin-cq-status' && elems.length > 0) {
                        events.fire(events.priv.REMOTE_STATUS_CQ, msgObject);
                    }
                }
            }
        }, 0);

        // we must return true to keep the handler alive.
        // returning false would remove it after it finishes.
        return true;

    }

    function onStreamError(msg) {
        var isConflict = msg.getElementsByTagName('conflict').length;
        if (isConflict) {
            events.fire(events.XMPP_USERCONFLICT);
        }
    }

    function onRosterChanged(iq) {

        logger.log(iq);
        var item = iq.querySelector('item');
        var userId = item.getAttribute('jid');
        var subscription = item.getAttribute('subscription');
        var subReqSent = item.getAttribute('ask') === 'subscribe';
        var subOut = subStateMap.none;

        if (subscription) {
            subOut = subStateMap[subscription];
        }

        events.fire(events.XMPP_ROSTERCHANGED, {
            jid: userId,
            subState: subOut,
            subReqSent: subReqSent
        });

        // acknowledge receipt
        connection.send($iq({
            type: 'result',
            id: iq.getAttribute('id')
        }));
        return true;
    }
    
    function onBlockListPush(iq) {
        // If this is the global privacy list push, then reload block list
        var list = iq.querySelector('list[name=\'global\']');
        if (!!list) {
            loadBlockListPriv();            
        }
        
    }
    
    function registerHandlers() {
        connection.addHandler(onRosterChanged, Strophe.NS.ROSTER, 'iq', 'set');
        connection.addHandler(onPresence, null, 'presence');
        connection.addHandler(onMessage, null, 'message');
        connection.addHandler(onStreamError, null, 'stream:error');
        connection.addHandler(onBlockListPush, 'jabber:iq:privacy', 'iq', 'set');
    }

    function setupStropheConnection(jid, accessToken) {
        logger.log('orig:' + urls.endPoints.xmppConfig.wsHost);

        connection = new Strophe.Connection(urls.endPoints.xmppConfig.wsScheme + '://' + urls.endPoints.xmppConfig.wsHost + ':' + urls.endPoints.xmppConfig.wsPort);

        connection.rawInput = logIncoming;
        connection.rawOutput = logOutgoing;
        connection.connect(jid, accessToken, onConnect);
        registerHandlers();
    }

    function connect(jid, accessToken) {
        var xmlHttp = null;

        if (urls.endPoints.xmppConfig.wsHost === '') {
            xmlHttp = new XMLHttpRequest();
            //            xmlHttp.open('GET', urls.endPoints.xmppConfig.redirectorUrl + jid, false);
            xmlHttp.open('GET', urls.endPoints.xmppConfig.redirectorUrl + jid, true);

            xmlHttp.onload = function() {
                if (xmlHttp.status === 200) {

                    urls.endPoints.xmppConfig.wsHost = xmlHttp.getResponseHeader('Content-Location');
                    setupStropheConnection(jid, accessToken);
                } else {
                    logger.log('XMPPstrophe- connect error: ', xmlHttp.status, ', ', xmlHttp.statusText);
                }
            };

            // Handle network errors
            xmlHttp.onerror = function() {
                logger.log('XMPPstrophe- connect error: -1');
            };

            xmlHttp.send(null);
        } else {
            setupStropheConnection(jid, accessToken);
        }
    }

    function logIncoming(msg) {
        // Limit length of output to 1000 chars
        logger.log('[XMPP-IN]: ' + msg.substring(0, 1000) + ((msg.length > 1000) ? '...' + (msg.length - 1000) + ' chars truncated' : ''));
    }

    function logOutgoing(msg) {
        // Limit length of output to 1000 chars
        logger.log('[XMPP-OUT]: ' + msg.substring(0, 1000) + ((msg.length > 1000) ? '...' + (msg.length - 1000) + ' chars truncated' : ''));
    }


    /*
    function onNucleusLogin() {
        connect(auth.userPid() + '@' + urls.endPoints.xmppConfig.domain, auth.accessToken());
    }
    */
    function onAuthLoggedOut() {
        disconnectSync();
    }

    function onSendActionMessage(msgBody) {
        connection.send($msg({
            to: user.publicObjs.userPid() + '@' + urls.endPoints.xmppConfig.domain + '/' + clientResource, //'/origin',
            type: 'origin-action'
        }).c('body').t(msgBody));
    }

    function onSendResponseMessage(msgBody) {
        connection.send($msg({
            to: user.publicObjs.userPid() + '@' + urls.endPoints.xmppConfig.domain + '/' + clientResource, //'/origin',
            type: 'origin-response'
        }).c('body').t(msgBody));
    }

    function init() {
        connected = false;
        //don't automatically start up, integrator should do this on-demand
        //pubEvents.on('authSuccessRetry', onNucleusLogin);
        events.on(events.AUTH_LOGGEDOUT, onAuthLoggedOut);
        events.on(events.priv.REMOTE_STATUS_SENDACTION, onSendActionMessage);
        events.on(events.priv.REMOTE_SEND_CONFIRMATION_TO_CLIENT, onSendResponseMessage);
    }

    function friendRequestAction(jid, action) {
        connection.send($pres({
            to: jid,
            type: action
        }));
    }

    function canConnect() {
        return ((connectionStatus !== Strophe.Status.CONNECTING) && (connectionStatus !== Strophe.Status.CONNECTED));
    }
    
    function setBlockList() {
        var list = $iq({
                type: 'set',
                id: 'Origin',
                xmlns: 'jabber:iq:privacy'
            })
            .c('query', {
            })
            .c('list', {
                name: 'global'
            });
        
        for (var key in blockList) {
            list.c('item', { type: 'jid', value: key + '@' + urls.endPoints.xmppConfig.domain, action: blockList[key], order: 1 });
            list.up();
        }
                                        
        connection.sendIQ(list);     
    }

    function blockUserPriv(nucleusId) {
        if( typeof blockList[nucleusId] === 'undefined') {
            
            blockList[nucleusId] = 'deny';
    
            setBlockList();
    
            events.fire(events.XMPP_BLOCKLISTCHANGED);
        }
        // else already blocked
    }
	
	function getGlobalPrivacyList() {
        function loadBlockListSuccess(response) {                
            var blockListItems = response.getElementsByTagName('item');
            for(var i = 0; i< blockListItems.length; i++) {
                var itemValue = blockListItems[i].getAttribute('value');
                var nucleusId = itemValue.split('@')[0];
                
                var action = blockListItems[i].getAttribute('action');
                blockList[nucleusId] = action;
                
                //console.log('TR: blockList[' + itemValue.split('@')[0] + ']: ' + blockList[itemValue.split('@')[0]]);
            }                                
            blockListLoaded = true;

            events.fire(events.XMPP_BLOCKLISTCHANGED);
        }
        
        function loadBlockListFail(error) {
            blockListLoaded = true;
            events.fire(events.XMPP_BLOCKLISTCHANGED);
        }

		if (!!connection) {
			connection.sendIQ($iq({type: 'get'}).c('query', {xmlns: 'jabber:iq:privacy'}).c('list', {name: 'global'}), 
				loadBlockListSuccess, loadBlockListFail);
		}
		
	}
    
    function loadBlockListPriv() {
		blockList = {};
		blockListLoaded = false;
        
        if (connected) {
			getGlobalPrivacyList();
        } else {
			events.once(events.XMPP_CONNECTED, getGlobalPrivacyList);
		}

    }

    return /** @lends module:Origin.module:xmpp */ {
        /**
         * The init function
         * @method
         * @private
         */
        init: init,

        /**
         * @method
         * @returns {boolean}
         */
        isConnected: function() {
            return connected;
        },

        /**
         * initiate xmpp connection
         * @method
         * @returns {void}
         */
        connect: function() {
            //doesn't seem to care if connect is called multiple times -- whether onnection is already in progress or if it's already connected, so
            //don't need to trap for those cases
            if (auth.isLoggedIn() && canConnect()) {
                connect(user.publicObjs.userPid() + '@' + urls.endPoints.xmppConfig.domain, user.publicObjs.accessToken());
            }
        },

        /**
         * manual disconnect -- will disconnect automatically when jssdk logout is detected
         * @method
         * @returns {void}
         */
        disconnect: function() {
            disconnectSync();
        },

        /**
         * convert a nucleusId to a JabberID
         * @method
         * @param {string} nucleusId The nucleusId you want to convert
         * @returns {string}
         */
        nucleusIdToJid: function (nucleusId) {
            return nucleusId + '@' + urls.endPoints.xmppConfig.domain;
        },

        /**
         * returned from the {@link Origin.xmpp.requestRoster} promise
         * @typedef rosterObject
         * @type {object}
         * @property {string} subState The subscription state of the user.
         * @property {string} jid The jabber id of the user.
         * @property {string} originId originId
         * @property {string} subReqSent true if you sent this user a request
         */
        /**
         * Request the friends roster of the current user
         * @method
         * @returns {promise<rosterObject>} The result of the promise will return the xmpp iq roster stanza
         */
        requestRoster: function(requestSuccess, requestError) {
            return new Promise(function(resolve, reject) {
                function requestSuccess(data) {
                    var userArray = data.getElementsByTagName('item');
                    var i, userObj, subState, subOut = '',
                        returnArray = [];
                    for (i = 0; i < userArray.length; i++) {
                        subState = userArray[i].getAttribute('subscription');
                        if (subState) {
                            subOut = subStateMap[subState];
                        }
                        userObj = {
                            subState: subOut,
                            jid: userArray[i].getAttribute('jid'),
                            originId: userArray[i].getAttribute('origin:eaid'),
                            subReqSent: userArray[i].getAttribute('ask') === 'subscribe'
                        };
                        returnArray.push(userObj);
                    }
                    resolve(returnArray);
                }

                function requestError(status, textStatus) {
                    logger.log('requestRoster error:', status, ',', textStatus);
                    reject(status);
                }

                if (!connected) {
                    requestError(-1, 'social not connected');
                    return;
                }

                // build and send initial roster query
                var rosteriq = $iq({
                    type: 'get'
                }).c('query', {
                    xmlns: Strophe.NS.ROSTER,
                    'origin:list': 'new'
                });
                connection.sendIQ(rosteriq, requestSuccess, requestError);
            });

        },
                
        /**
         * Sends a message to the selected user
         * @method
         * @param {string} userId The jid of the user you want to send the message to.
         * @param {string} msgBody The message you want to send.
         * @param {string} type The type of message you want to send, 'chat' or 'groupchat'
         * @returns {void}
         */
        sendMessage: function(userId, msgBody, type) {
            connection.send($msg({
                    to: userId,
                    type: (typeof type === 'undefined' ? 'chat' : type)
                })
                .c('active', {
                    xmlns: 'http://jabber.org/protocol/chatstates'
                })
                .up()
                .c('body').t(msgBody));
        },


        /**
         * sends the typing state
         * @param  {string} state typing state
         * @param  {string} userId nucleus id
         */
        sendTypingState: function(state, userId) {
            connection.send($msg({
                    to: userId,
                    type: 'chat'
                })
                .c(state, {
                    xmlns: 'http://jabber.org/protocol/chatstates'
                })
                .up()
                .c('body').t(''));
        },


        /**
         * Accept a friend request from a giver user
         * @method
         * @param {string} jid The jid of the user whose friend request you want to accept.
         * @returns {void}
         */
        friendRequestAccept: function(jid) {
            friendRequestAction(jid, 'subscribed');
        },

        /**
         * Reject a friend request from a giver user
         * @method
         * @param {string} jid The jid of the user whose friend request you want to reject.
         * @returns {void}
         */
        friendRequestReject: function(jid) {
            friendRequestAction(jid, 'unsubscribed');
        },
        /**
         * Send a friend request to the user
         * @method
         * @param {string} jid The jid of the user who you want to send a friend request to.
         * @returns {void}
         */
        friendRequestSend: function(jid) {
            friendRequestAction(jid, 'subscribe');
        },
        /**
         * Revoke the friend request you sent
         * @method
         * @param {string} jid The jid of the user who you want to revoke the friend request from.
         * @returns {void}
         */
        friendRequestRevoke: function(jid) {
            friendRequestAction(jid, 'unsubscribe');
        },
        /**
         * Revoke a friend
         * @method
         * @param {string} jid The jid of the friend who you want to remove.
         * @returns {void}
         */
        removeFriend: function(jid) {
            var iq = $iq({
                    type: 'set'
                })
                .c('query', {
                    xmlns: Strophe.NS.ROSTER
                })
                .c('item', {
                    jid: jid,
                    subscription: 'remove'
                });
            connection.sendIQ(iq);
        },

        /**
         * @param {string} jid
         * @param {string} originId
         * @returns {void}
         */
        joinRoom: function(jid, originId) {
            connection.send($pres({
                to: jid + '/' + originId,
                id: 'roomId'
            }));
        },

        /**
         * @param {string} jid
         * @param {string} originId
         * @returns {void}
         */
        leaveRoom: function(jid, originId) {
            connection.send($pres({
                to: jid + '/' + originId,
                type: 'unavailable'
            }));
        },

        /**
         * Loads the XMPP block list
         * @method
         * @returns {void}
         */
        loadBlockList: function() {
            
            loadBlockListPriv();
        },
        
        /**
         * isBlocked
         * @method
         * @param {string} nucleusId The nucleusId of the user to test for blocking
         * @returns {void}
         */
        isBlocked: function(nucleusId) {         
            //console.log('TR: isBlocked: ' + blockListLoaded + ' : ' + nucleusId + ' list: ' + blockList[''+nucleusId]);
            return new Promise(function(resolve, reject) {
                
                function isUserOnBlockList() {
                    var onList = (blockList[''+nucleusId] ? (blockList[''+nucleusId]==='deny'): false);
                    return onList;
                }

                function onBlockListLoaded() {
                    resolve(isUserOnBlockList());
                }
            
                if (blockListLoaded) {
                    resolve(isUserOnBlockList());
                } else {
                    events.once(events.XMPP_BLOCKLISTCHANGED, onBlockListLoaded);        
                }
            });           
        },
        
        /**
         * Remove a friend and block user
         * @method
         * @param {string} jid The jid of the friend who you want to remove.
         * @param {string} nucleusId The nucleusId of the user who you want to block.
         * @returns {void}
         */
        removeFriendAndBlock: function(nucleusId, jid) {

            // First remove from the roster
            if (!!jid) { 
                this.removeFriend(jid); 
            }
            
            // Then block
            this.blockUser(nucleusId);            
        }, 
        
        
        /**
         * Block a user
         * @method
         * @param {string} userId The nucleusId of the user who you want to block.
         * @returns {void}
         */
        blockUser: function(nucleusId) {

            function onBlockListLoaded() {
                blockUserPriv(nucleusId);
            }
            
            if (blockListLoaded) {
                blockUserPriv(nucleusId);
            } else {
                events.once(events.XMPP_BLOCKLISTCHANGED, onBlockListLoaded);        
            }
        },
        
        /**
         * Block a user, and cancel pending friend request
         * @method
         * @param {string} userId The nucleusId of the user who you want to block.
         * @returns {void}
         */
        cancelAndBlockUser: function(nucleusId) {
            friendRequestAction(nucleusId + '@' + urls.endPoints.xmppConfig.domain, 'unsubscribe');
            this.blockUser(nucleusId);
        },

        /**
         * Block a user, and ignore incoming friend request
         * @method
         * @param {string} userId The nucleusId of the user who you want to block.
         * @returns {void}
         */
        ignoreAndBlockUser: function(nucleusId) {
            friendRequestAction(nucleusId + '@' + urls.endPoints.xmppConfig.domain, 'unsubscribed');
            this.blockUser(nucleusId);
        },
        
        /**
         * Unblock a user
         * @method
         * @param {string} userId The nucleusId of the user who you want to unblock.
         * @returns {void}
         */
        unblockUser: function(nucleusId) {
            
            function unblockUserPriv() {
                if (!!blockList[nucleusId]) {
                    
                    delete blockList[nucleusId];
                    
                    setBlockList();
                    
                    events.fire(events.XMPP_BLOCKLISTCHANGED);
                } // else user is not blocked
            }
            
            function onBlockListLoaded() {
                unblockUserPriv();
            }
            
            if (blockListLoaded) {
                unblockUserPriv();
            } else {
                events.once(events.XMPP_BLOCKLISTCHANGED, onBlockListLoaded);        
            }
            
        },                

        /**
         * Updates the current users presence
         * @method
         * @returns {void}
         */
        updatePresence: function() {
			function setInvisiblePrivacyListSuccess() {
				console.log('TR setInvisiblePrivacyListSuccess');
			}
			
			function setInvisiblePrivacyListFailure() {
				console.log('TR setInvisiblePrivacyListFailure');
			}

			// Set active list to invisible privacy list, pre-defined on the server
            connection.sendIQ($iq({type: 'set'}).c('query', {xmlns: 'jabber:iq:privacy'}).c('active', {name: 'invisible'}), 
                setInvisiblePrivacyListSuccess, setInvisiblePrivacyListFailure);
			
			
			// Send initial presence, we will now be Invisible
            connection.send($pres().c('status', 'I am not really here').up().c('priority', -1));			
        },

        /**
         * request a presence change
         * @method
         * @returns {void}
         */
        requestPresence: function(presence) {
            if (presence === 'invisible') {
                connection.send($pres({
                    from: user.publicObjs.userPid() + '@' + urls.endPoints.xmppConfig.domain + '/' + clientResource,
                    type: 'unavailable'
                }).c('show').t(presence));
            } else {
                connection.send($pres({
                    from: user.publicObjs.userPid() + '@' + urls.endPoints.xmppConfig.domain + '/' + clientResource
                }).c('show').t(presence));
            }
        }
    };
});

/*jshint strict: false */
/*jshint unused: false */

define('modules/xmpp/xmpp',[
    'modules/xmpp/xmppBridge',
    'modules/xmpp/xmppStrophe',
    'core/logger',
    'modules/client/client'
], function(xmppBridge, xmppStrophe, logger, client) {
    
    var xmpp = xmppStrophe;

    //check and see if bridge exists
    if (client.isEmbeddedBrowser()) {
        logger.log('using bridge xmpp');
        xmpp = xmppBridge;
    } else {
        logger.log('using strophe xmpp');
    }

    xmpp.init();
    return xmpp;
});
/*jshint strict: false */
define('modules/search/search',[
    'core/user',
    'core/auth',
    'core/dataManager',
    'core/urls',
    'core/errorhandler',
    'core/locale'
], function(user, auth, dataManager, urls, errorhandler, localeModule) {

    /**
     * @module module:search
     * @memberof module:Origin
     */

    /**
     * retrieve results from store search service
     * @param  {string} searchString string
     * @param  {Object} options
     * @param  {string} localeOverride the locale passed in e.g. 'en-US'
     * @param  {string} threeLetterCountryCodeOverride the three letter country passed in e.g.'USA'
     *
    */
    function searchStore(searchString , options, localeOverride, threeLetterCountryCodeOverride) {
        //Options Object required by store team for getting carousels data
        var params = '';
        if(Object.keys(options).length){
            params = Object.keys(options).map(function(key) {
                return key + '=' + encodeURIComponent(options[key]);
            }).join('&');
        }

        var endPoint = urls.endPoints.searchStore + '&' + params,
            locale = localeOverride? localeOverride: localeModule.locale(),
            threeLetterCountryCode = threeLetterCountryCodeOverride? threeLetterCountryCodeOverride:localeModule.threeLetterCountryCode(),
            config = {
                atype: 'GET',
                headers: [{
                    'label': 'Accept',
                    'val': 'application/json'
                }],
                parameters: [{
                    'label': 'locale',
                    'val': locale.toLowerCase()
                }, {
                    'label': 'threeLetterCountry',
                    'val': threeLetterCountryCode.toLowerCase()
                }, {
                    'label': 'q',
                    'val': searchString
                }],
                appendparams: [],
                reqauth: false,
                requser: false
            };

            return dataManager.dataREST(endPoint, config)
              .catch(errorhandler.logAndCleanup('STORE SEARCH FAILED'));

    }

    /**
     * retrieve results from people search service
     * @param  {searchString} search string
     * @param  {page} search result start row number.  Starts at 0. Maximum 20 rows per call
     * @param  {options} options includes param required by the service
     */
    function searchPeople(searchString, start) {
        var endPoint = urls.endPoints.searchPeople,
            config = {
                atype: 'GET',
                headers: [{
                    'label': 'Accept',
                    'val': 'application/json'
                }],
                parameters: [{
                    'label': 'userId',
                    'val': user.publicObjs.userPid()
                }, {
                    'label': 'searchkeyword',
                    'val': searchString
                },{
                    'label': 'start',
                    'val': start
                }],
                appendparams: [],
                reqauth: true,
                requser: true
            },
            token = user.publicObjs.accessToken();

        if (token.length > 0) {
            dataManager.addHeader(config, 'AuthToken', token);
        }

        return dataManager.dataRESTauth(endPoint, config)
          .catch(errorhandler.logAndCleanup('PEOPLE SEARCH FAILED'));

    }

    return /** @lends module:Origin.module:search */ {

        /**
         * This will return a promise for the requested searchString from store search service
         *
         * @param  {string} searchString    searchString
         * @param  {object} options         object of params {fq: 'gameType:basegame',sort: 'title asc',start: 0,rows: 20}
         * @return {promise} return a promise with results based on the search string
         * @method
         */
        searchStore: searchStore,

        /**
         * This will return a promise for the requested searchString from people search service
         *
         * @param  {string} searchString    searchString
         * @param  {number} page            page from which we want the result - for initial call its 1
         * @return {promise} return a promise with results based on the search string
         * @method
        */
        searchPeople: searchPeople

    };
});

/*jshint strict: false */
/*jshint unused: false */
/*jshint undef: false */
define('modules/voice/voiceBridge',[
    'core/events',
    'modules/client/client',
    'modules/client/communication'
], function(events, client, communication) {

    function handleVoiceCallEvent(voiceCallEventObj) {
        if (client.voice.supported()) {
            events.fire(events.VOICE_CALL, voiceCallEventObj);
        }
    }

    function handleVoiceLevel(level) {
        if (client.voice.supported()) {
            events.fire(events.VOICE_LEVEL, level);
        }
    }

    function handleDeviceAdded(deviceName) {
        if (client.voice.supported()) {
            events.fire(events.VOICE_DEVICE_ADDED, deviceName);
        }
    }

    function handleDeviceRemoved() {
        if (client.voice.supported()) {
            events.fire(events.VOICE_DEVICE_REMOVED);
        }
    }

    function handleDefaultDeviceChanged() {
        if (client.voice.supported()) {
            events.fire(events.VOICE_DEFAULT_DEVICE_CHANGED);
        }
    }

    // WinXP
    function handleDeviceChanged() {
        if (client.voice.supported()) {
            events.fire(events.VOICE_DEVICE_CHANGED);
        }
    }

    function handleUnderThreshold() {
        if (client.voice.supported()) {
            events.fire(events.VOICE_UNDER_THRESHOLD);
        }
    }

    function handleOverThreshold() {
        if (client.voice.supported()) {
            events.fire(events.VOICE_OVER_THRESHOLD);
        }
    }

    function handleVoiceConnected() {
        if (client.voice.supported()) {
            events.fire(events.VOICE_CONNECTED);
        }
    }

    function handleVoiceDisconnected() {
        if (client.voice.supported()) {
            events.fire(events.VOICE_DISCONNECTED);
        }
    }

    function handleEnableTestMicrophone(resetLink) {
        if (client.voice.supported()) {
            events.fire(events.VOICE_ENABLE_TEST_MICROPHONE, resetLink);
        }
    }

    function handleDisableTestMicrophone(resetLink) {
        if (client.voice.supported()) {
            events.fire(events.VOICE_DISABLE_TEST_MICROPHONE, resetLink);
        }
    }

    function handleClearLevelIndicator() {
        if (client.voice.supported()) {
            events.fire(events.VOICE_CLEAR_LEVEL_INDICATOR);
        }
    }

    function init() {
        //listen for voice events
        events.on(events.CLIENT_VOICE_VOICECALLEVENT, handleVoiceCallEvent);
        events.on(events.CLIENT_VOICE_VOICELEVEL, handleVoiceLevel);
        events.on(events.CLIENT_VOICE_DEVICEADDED, handleDeviceAdded);
        events.on(events.CLIENT_VOICE_DEVICEREMOVED, handleDeviceRemoved);
        events.on(events.CLIENT_VOICE_DEFAULTDEVICECHANGED, handleDefaultDeviceChanged);
        events.on(events.CLIENT_VOICE_DEVICECHANGED, handleDeviceChanged);
        events.on(events.CLIENT_VOICE_UNDERTHRESHOLD, handleUnderThreshold);
        events.on(events.CLIENT_VOICE_OVERTHRESHOLD, handleOverThreshold);
        events.on(events.CLIENT_VOICE_VOICECONNECTED, handleVoiceConnected);
        events.on(events.CLIENT_VOICE_VOICEDISCONNECTED, handleVoiceDisconnected);
        events.on(events.CLIENT_VOICE_ENABLETESTMICROPHONE, handleEnableTestMicrophone);
        events.on(events.CLIENT_VOICE_DISABLETESTMICROPHONE, handleDisableTestMicrophone);
        events.on(events.CLIENT_VOICE_CLEARLEVELINDICATOR, handleClearLevelIndicator);
    }

    /**
     * Voice module
     * @module module:voice
     * @memberof module:Origin
     */
    return /** @lends module:Origin.module:voice*/ {
        init: init,

        /**
         * is voice supported
         * @method
         * @returns {boolean}
         */
        supported: function() {
            return client.voice.supported();
        },

        /**
         * is voice supported by the friend identified by their nucleus id
         * @module module:voice
         * @memberof module:Origin
         * @returns boolean
         */
        isSupportedBy: function(friendNucleusId) {
            return client.voice.isSupportedBy(friendNucleusId);
        },

        /**
         * set wheterh user is on the voice settings page
         * @method
         * @param {bool} indicates whether user is on the voice settings page
         * @returns {void} 
         */
        setInVoiceSettings: function(inVoiceSettings) {
            if (client.voice.supported()) {
                client.voice.setInVoiceSettings(inVoiceSettings);
            }
        },

        /**
         * join a voice call
         * @method
         * @param {array} list of participants
         * @returns {void}
         */
        joinVoice: function(id, participants) {
            if (client.voice.supported()) {
                client.voice.joinVoice(id, participants);
            }
        },

        /**
         * leave the voice call
         * @method
         * @returns {void}
         */
        leaveVoice: function(id) {
            if (client.voice.supported()) {
                client.voice.leaveVoice(id);
            }
        },

        /**
         * answer a voice call
         * @method
         * @returns {void}
         */
        answerCall: function(id) {
            if (client.voice.supported()) {
                client.voice.joinVoice(id, []);
            }
        },

        /**
         * ignore a voice call
         * @method
         * @returns {void}
         */
        ignoreCall: function(id) {
            if (client.voice.supported()) {
                client.voice.leaveVoice(id);
            }
        },

        /**
         * start testing microphone
         * @method
         * @returns {void}
         */
        testMicrophoneStart: function() {
            if (client.voice.supported()) {
                client.voice.testMicrophoneStart();
            }
        },

        /**
         * stop testing microphone
         * @method
         * @returns {void}
         */
        testMicrophoneStop: function() {
            if (client.voice.supported()) {
                client.voice.testMicrophoneStop();
            }
        },

        /**
         * change input device
         * @method
         * @param {string} name of device
         * @returns {void}
         */
        changeInputDevice: function(device) {
            if (client.voice.supported()) {
                client.voice.changeInputDevice(device);
            }
        },

        /**
         * change output device
         * @method
         * @param {string} name of device
         * @returns {void}
         */
        changeOutputDevice: function(device) {
            if (client.voice.supported()) {
                client.voice.changeOutputDevice(device);
            }
        },

        /**
         * play incoming ring
         * @method
         * @returns {void}
         */
        playIncomingRing: function() {
            if (client.voice.supported()) {
                client.voice.playIncomingRing();
            }
        },

        /**
         * stop incoming ring
         * @method
         * @returns {void}
         */
        stopIncomingRing: function() {
            if (client.voice.supported()) {
                client.voice.stopIncomingRing();
            }
        },

        /**
         * play outgoing ring
         * @method
         * @returns {void}
         */
        playOutgoingRing: function() {
            if (client.voice.supported()) {
                client.voice.playOutgoingRing();
            }
        },

        /**
         * stop outgoing ring
         * @method
         * @returns {void}
         */
        stopOutgoingRing: function() {
            if (client.voice.supported()) {
                client.voice.stopOutgoingRing();
            }
        },

        /**
         * mute self
         * @method
         * @returns {void}
         */
        muteSelf: function() {
            if (client.voice.supported()) {
                client.voice.muteSelf();
            }
        },

        /**
         * unmute self
         * @method
         * @returns {void}
         */
        unmuteSelf: function() {
            if (client.voice.supported()) {
                client.voice.unmuteSelf();
            }
        },

        /**
         * show toasty for voice call
         * @method
         * @returns {void}
         */
        showToast: function(event, originId, conversationId) {
            if (client.voice.supported()) {
                client.voice.showToast(event, originId, conversationId);
            }
        },

        /**
         * get list of audio input devices
         * @method
         * @returns {Array}
         */
        audioInputDevices: function() {
            if (client.voice.supported()) {
                return client.voice.audioInputDevices();
            }
        },

        /**
         * get list of audio output devices
         * @method
         * @returns {Array}
         */
        audioOutputDevices: function() {
            if (client.voice.supported()) {
                return client.voice.audioOutputDevices();
            }
        },

        /**
         * get selected audio input device
         * @method
         * @returns {string}
         */
        selectedAudioInputDevice: function() {
            if (client.voice.supported()) {
                return client.voice.selectedAudioInputDevice();
            }
        },

        /**
         * get selected audio output device
         * @method
         * @returns {string}
         */
        selectedAudioOutputDevice: function() {
            if (client.voice.supported()) {
                return client.voice.selectedAudioOutputDevice();
            }
        },

        /**
         * get network quality (0-3)
         * @method
         * @returns {int}
         */
        networkQuality: function () {
            if (client.voice.supported) {
                return client.voice.networkQuality();
            }
        },

        /**
         * get channel id of current voice chat
         * @method
         * @returns {string}
         */
        channelId: function () {
            if (client.voice.supported) {
                return client.voice.channelId();
            }
        },
        /**
         * show voice survey
         * @method
         * @returns {void}
         */
        showSurvey: function (channelId) {
            if (client.voice.supported) {
                return client.voice.showSurvey(channelId);
            }
        }
    };
});
/*jshint strict: false */
/*jshint unused: false */
define('modules/voice/voiceWeb',[
], function () {

    function init() {}

    return {
        init: init,

        supported: function () {
            /* voice not yet supported on web */
            return false;
        },

        isSupportedBy: function() {
            return Promise.resolve(false);
        }
    };
});

/*jshint strict: false */
/*jshint unused: false */

define('modules/voice/voice',[
    'modules/voice/voiceBridge',
    'modules/voice/voiceWeb',
    'modules/client/client'
], function (voiceBridge, voiceWeb, client) {

    var voice = voiceWeb;
    //check and see if bridge exists
    if (client.isEmbeddedBrowser()) {
        console.log('using bridge voice');
        voice = voiceBridge;
    } else {
        console.log('using web voice');
    }

    voice.init();

    return voice;
});

/*jshint unused: false */
/*jshint strict: false */
define('modules/commerce/commerce',[
    'promise',
    'core/dataManager',
    'core/user',
    'core/urls',
    'core/errorhandler',
], function(Promise, dataManager, user, urls, errorhandler) {

    /**
     * @module module:commerce
     * @memberof module:Origin
     */

    function handleWalletBalanceResponse(response) {
        var i, length;
        if (response.billingaccounts) {
            length = response.billingaccounts.length;
            for (i = 0; i < length; i++) {
                if (response.billingaccounts[i].status === 'ACTIVE') {
                    return Number(response.billingaccounts[i].balance);
                }
            }
        }
        return 0;
    }

    function getWalletBalance(currency) {
        var endPoint = urls.endPoints.walletBalance;
        var config = {
            atype: 'GET',
            headers: [{
                'label': 'Accept',
                'val': 'application/vnd.origin.v2+json; x-cache/force-write'
            }],
            parameters: [{
                'label': 'userId',
                'val': user.publicObjs.userPid()
            }, {
                'label': 'currency',
                'val': currency
            }],
            appendparams: [],
            reqauth: true,
            requser: true,
            responseHeader: false
        };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'AuthToken', token);
        }

        return dataManager.enQueue(endPoint, config, 0)
            .then(handleWalletBalanceResponse, errorhandler.logAndCleanup('COMMERCE:getWalletBalance FAILED'));
    }

    function handleVcCheckoutResponse(response) {
        if (response.invoiceNumbers && response.invoiceNumbers.length > 0) {
            return response.invoiceNumbers[0];
        } else {
            return errorhandler.promiseReject('VC Checkout failed to grant entitlement(s)');
        }
    }

    function postVcCheckout(offerIds, currency, odcProfile) {
        var endPoint = urls.endPoints.vcCheckout;
        var config = {
            atype: 'POST',
            headers: [{
                'label': 'Accept',
                'val': 'application/vnd.origin.v3+json; x-cache/force-write'
            }, {
                'label': 'Content-Type',
                'val': 'application/json'
            }],
            parameters: [{
                'label': 'userId',
                'val': user.publicObjs.userPid()
            }, {
                'label': 'currency',
                'val': currency
            }, {
                'label': 'profile',
                'val': odcProfile
            }],
            appendparams: [],
            reqauth: true,
            requser: true,
            responseHeader: false
        };

        var body = {
            checkout: {
                lineItems: []
            }
        };

        var numOffers = offerIds.length;
        for (var i = 0; i < numOffers; i++) {
            body.checkout.lineItems.push({
                productId: offerIds[i],
                quantity: 1
            });
        }
        config.body = JSON.stringify(body);

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'AuthToken', token);
        }

        return dataManager.enQueue(endPoint, config, 0)
            .then(handleVcCheckoutResponse, errorhandler.logAndCleanup('COMMERCE:postVcCheckout FAILED'));
    }

    return/** @lends module:Origin.module:commerce */ {

        /**
         * Retrieves the current balance for the given currency.
         * @param  {string} currency The currency code, i.e. '_BW', '_FF'
         * @return {promise<number>} response A promise that resolves into the current balance for the given currency
         * @method getWalletBalance
         */
        getWalletBalance: getWalletBalance,

        /**
         * Entitles the user to the given offers if the user wallet has sufficient currency.
         * @param  {string[]} offerIds The list of offer IDs to purchase
         * @param  {string} currency The currency code, i.e. '_BW', '_FF'
         * @param  {string} odcProfile The ODC profile ID associated with the given offers
         * @return {promise<string>} response A promise that resolves into the order number
         * @method postVcCheckout
         */
        postVcCheckout: postVcCheckout
    };
});
/*jshint strict: false */
/*jshint unused: false*/
define('modules/pin/pin',[
    'core/user',
    'core/dataManager',
    'core/utils',
    'core/urls'
], function(user, dataManager, utils, urls) {

    /**
     * @module module:pin
     * @memberof module:Origin
     */

    /**
     * user info for a single user
     * @typedef trackingRecommendationObject
     * @type {object}
     * @property {string} recoid the id used to identify the recommendation, ctids for news, project id for games
     * @property {string} recoindex the position of the tile in the recommendation (0 = first rec)
     */

    var PIN_EM_CONFIG_DEFAULTS = {
            atype: 'POST',
            headers: [{
                'label': 'Accept',
                'val': 'application/json'
            }, {
                'label': 'Content-Type',
                'val': 'application/json'
            }]
        },
        PIN_EM_BODY_DEFAULTS = {
            clientId: 'origin',
            tId: '196775',
            tIdT: 'projectid'
        },
        GAMEID = '901002',
        DEFAULTS_RECS = 4,
        ORIGIN_NEWS = 'origin news',
        ORIGIN_GAMES = 'origin games',
        NEWS = 'news',
        GAMES = 'games',
        CLICKS = 'clicks',
        IMPRESSIONS = 'impressions';


    /**
     * get recommendations from the pin service
     * @param  {string} recommendationType is this a ORIGIN_NEWS or ORIGIN_GAME recommendation
     * @param  {string[]} inputIds ids used in tracking recommendation, project ids for games ,ctids for news
     * @param  {number} numItems maximum number of recommendations to be returned by api
     * @return {promise} promise that will execute the recommendation api with the parameters
     */
    function getRecommendation(recommendationType, inputIds, numItems) {
        //for recommendations we always want to use pc platform, reco engine currently has no
        //concept of mac
        var endPoint = (recommendationType === ORIGIN_GAMES ? urls.endPoints.pinemPCRecoGames : urls.endPoints.pinemPCRecoNews),
            config = {},
            body = {
                gameId: GAMEID,
                state: {
                    'item_list': inputIds,
                    'num_items': numItems || DEFAULTS_RECS
                },
                pidMap: {
                    nucleus: user.publicObjs.userPid()
                },
                recommendations: [recommendationType]
            };

        utils.mix(config, PIN_EM_CONFIG_DEFAULTS);
        utils.mix(body, PIN_EM_BODY_DEFAULTS);

        config.body = JSON.stringify(body);

        return dataManager.enQueue(endPoint, config);
    }

    /**
     * send information back to the pin recommendation service
     * @param  {string} impressionType          is this a click or impression
     * @param  {string} trackingTagArray        the tracking tags from the recommendation responses
     * @param  {trackingRecommendationObject[]} trackingIdsAndIndices ids/index object used in tracking recommendation, (id = project ids for games ,ctids for news)
     * @return {promise}                        promise that will execute the tracking api with the parameters
     */
    function trackRecommendations(impressionType, trackingTagArray, trackingIdsAndIndices) {
        var endPoint = (impressionType === 'clicks' ? urls.endPoints.pinemTrackClicks : urls.endPoints.pinemTrackImpressions);
        var config = {},
            body = {
                pidMap: {
                    nucleus: user.publicObjs.userPid().toString()
                },
                'tracking-tag-list': trackingTagArray,
                dataList: trackingIdsAndIndices
            };

        utils.mix(config, PIN_EM_CONFIG_DEFAULTS);
        utils.mix(body, PIN_EM_BODY_DEFAULTS);
        config.body = JSON.stringify(body);

        return dataManager.enQueue(endPoint, config);
    }



    return /** @lends module:Origin.module:pin */ {
        /**
         * pass in a set of ctids and return a filterd and ordered set back from the pin recommendation service for news
         *
         * @param  {string[]} ctids used in getting recommendation
         * @param  {number} numItems maximum number of recommendations to be returned by api
         * @return {promise} retval promise that will execute the recommendation api with the parameters and resolve with a recommendation object
         * @method
         */
        getNewsRecommendation: getRecommendation.bind(this, ORIGIN_NEWS),
        /**
         * called to track news impression
         * @param  {string} trackingTag             the tracking tag from the recommendation response
         * @param  {trackingRecommendationObject[]} trackingIdsAndIndices ids/index object used in tracking recommendation, (id = project ids for games ,ctids for news)
         * @return {promise}                        retval promise that will execute the tracking api with the parameters with no return object
         * @method
         */
        trackRecommendations: trackRecommendations,
 
        /**
         * pass in a set of project ids and return a filterd and ordered set back from the pin recommendation service for games
         *
         * @param  {string[]} project ids used in getting recommendation
         * @param  {number} numItems maximum number of recommendations to be returned by api
         * @return {promise} retval promise that will execute the recommendation api with the parameters and resolve with a recommendation object
         * @method
         */
        getGamesRecommendation: getRecommendation.bind(this, ORIGIN_GAMES),
        /**
         * constants used when calling tracking API
         * @type {Object}
         */
        constants: {
            /**
             * equivalent to 'news' 
             * @type {string}
             */
            NEWS: NEWS,
            /**
             * equivalent to 'games' 
             * @type {string}
             */            
            GAMES: GAMES

        }
    };
});
/*jshint unused: false */
/*jshint strict: false */

define('modules/wishlist/wishlist',[
    'promise',
    'core/logger',
    'core/user',
    'core/dataManager',
    'core/urls',
    'core/errorhandler',
    'core/utils'
], function(Promise, logger, user, dataManager, urls, errorhandler, utils) {
    /**
     * @module module:wishlist
     * @memberof module:Origin
     */

    /**
     * Wishlist Item - defines a wishlist row
     * @typedef {Object} WishlistItem
     * @property {string} offerId the offer id
     * @property {Number} displayOrder the order rank for the item
     * @property {Number} addedAt the timestamp the item was added to the wishlist
     */

    /**
     * Wishlist Sequence - defines a reordering sequence
     * @typedef {Object} WishlistSequence
     * @property {string} targetOfferId the offer id to move
     * @property {string} nextOfferId the next target position in the linked list
     * @property {string} prevOfferId the prev target position in the linked list
     */

    /**
     * Given a nucleus User ID, fetch an array of {@link Origin.module:wishlist~WishlistItem} objects
     * @param {String} userId the nucleus user to inspect
     * @return {Promise.<module:Origin.module:wishlist~WishlistItem[], Error>}
     */
    function getOfferList(userId) {
        if (!userId) {
            return Promise.reject('userId is required');
        }
        var endPoint = urls.endPoints.wishlistGetOfferList;

        var config = {
            atype: 'GET',
            headers: [{
                'label': 'X-Origin-Platform',
                'val': utils.os()
            }],
            parameters: [{
                'label': 'userId',
                'val': userId
            }],
            appendparams: [],
            reqauth: true,
            requser: true
        };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'AuthToken', token);
        }

        return dataManager.enQueue(endPoint, config, 0);
    }

    /**
     * Given a nucleus User ID and an offer id, add an offer to the wishlist
     * @param {String} userId  the nucleus userid
     * @param {String} offerId the offerid to add
     * @return {Promise.<void, Error>}
     */
    function addOffer(userId, offerId) {
        if (!userId || !offerId) {
            return Promise.reject('userId && offerId are required');
        }

        var endPoint = urls.endPoints.wishlistAddOffer;

        var config = {
            atype: 'PUT',
            headers: [{
                'label': 'X-Origin-Platform',
                'val': utils.os()
            }],
            parameters: [{
                'label': 'userId',
                'val': userId
            }, {
                'label': 'offerId',
                'val': offerId
            }],
            appendparams: [],
            reqauth: true,
            requser: true
        };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'AuthToken', token);
        }

        return dataManager.enQueue(endPoint, config, 0);
    }

    /**
     * Given a nucleus User ID and an offer ID, remove the offer id from the user's wishlist
     * @param {String} userId  the nucleus userid
     * @param {String} offerId the offerid to add
     * @return {Promise.<void, Error>}
     */
    function removeOffer(userId, offerId) {
        if (!userId || !offerId) {
            return Promise.reject('userId && offerId are required');
        }
        var endPoint = urls.endPoints.wishlistRemoveOffer;

        var config = {
            atype: 'DELETE',
            headers: [{
                'label': 'X-Origin-Platform',
                'val': utils.os()
            }],
            parameters: [{
                'label': 'userId',
                'val': userId
            }, {
                'label': 'offerId',
                'val': offerId
            }],
            appendparams: [],
            reqauth: true,
            requser: true
        };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'AuthToken', token);
        }

        return dataManager.enQueue(endPoint, config, 0);
    }

    return {
        getOfferList: getOfferList,
        addOffer: addOffer,
        removeOffer: removeOffer
    };
});

/*jshint unused: false */
/*jshint strict: false */
define('modules/translations/translations',[
    'core/dataManager',
    'core/urls',
    'core/errorhandler',
    'core/locale'
], function(dataManager, urls, errorhandler, localeModule) {

    /**
     * @module module:translations
     * @memberof module:Origin
     */

    function translate(key) {
        var endPoint = urls.endPoints.translation,
            config = {
                atype: 'GET',
                headers: [{
                    'label': 'Accept',
                    'val': 'application/json; charset=utf-8'
                }],
                parameters: [{
                    'label': 'key',
                    'val': encodeURIComponent(key)
                }, {
                   'label': 'locale',
                    'val' : localeModule.locale().replace('_','-').toLowerCase()
                }, {
                    'label': 'country',
                    'val' : localeModule.threeLetterCountryCode().toLowerCase()
                }],
                reqauth: false,
                requser: false
            };

        return dataManager.dataREST(endPoint, config)
            .catch(errorhandler.logAndCleanup('GET TRANSLATION FAILED FROM CMS'));
    }

    return /** @lends module:Origin.module:translations */ {

        /**
         * @param key {string} the key to translate
         * @return  {object} a promise resolve to http response to origin translation service
         * {key:'the key', value: 'translate string for give key'}
         */
        translate: translate
    };
});

/*jshint unused: false */
/*jshint strict: false */

define('modules/idobfuscate/idobfuscate',[
    'promise',
    'core/logger',
    'core/user',
    'core/dataManager',
    'core/urls',
    'core/errorhandler',
    'core/utils'
], function(Promise, logger, user, dataManager, urls, errorhandler, utils) {
    /**
     * @module module:idObfuscate
     * @memberof module:Origin
     */

    /**
     * Id Response Container - defines a response object from the obfuscation system
     * @typedef {Object} IdObject
     * @property {string} id the user id
     */

    /**
     * Encode a user's nucleus id into an obfuscated id for use in the URL
     * @param {String} userId  the nucleus userid to encode
     * @return {Promise.<IdObject, Error>}
     */
    function encodeUserId(userId) {
        var endPoint = urls.endPoints.userIdEncode;

        var config = {
            atype: 'GET',
            headers: [{
                'label': 'X-Origin-Platform',
                'val': utils.os()
            }],
            parameters: [{
                'label': 'userId',
                'val': userId
            }],
            appendparams: [],
            reqauth: true,
            requser: true
        };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'AuthToken', token);
        }

        return dataManager.enQueue(endPoint, config, 0);
    }

    /**
     * Decode an obfuscated user id into a nucleus user Id for use with backend services
     * @param {String} obfuscatedId the obfuscated user id to decode
     * @return {Promise.<IdObject, Error>}
     */
    function decodeUserId(obfuscatedId) {
        var endPoint = urls.endPoints.userIdDecode;

        var config = {
            atype: 'GET',
            headers: [{
                'label': 'X-Origin-Platform',
                'val': utils.os()
            }],
            parameters: [{
                'label': 'userId',
                'val': obfuscatedId
            }],
            appendparams: [],
            reqauth: true,
            requser: true
        };

        var token = user.publicObjs.accessToken();
        if (token.length > 0) {
            dataManager.addHeader(config, 'AuthToken', token);
        }

        return dataManager.enQueue(endPoint, config, 0);
    }

    return {
        encodeUserId: encodeUserId,
        decodeUserId: decodeUserId
    };
});

/*jshint strict: false */
/*jshint unused: false */

define('social/groups',[
    'promise',
    'core/logger',
	'core/user',
    'core/dataManager',
    'core/urls'
], function (Promise, logger, user, dataManager, urls) {
    /**
     * Social groups module
     * @module module:groups
     * @memberof module:Origin
     */
	 return /** @lends module:Origin.module:groups */{

        /**
         * This will return a promise for the group list for the userId specified
         *
         * @param {number} userId
         * @return {promise<groupList[]>} name array of groupInfoObjects
         */
        groupListByUserId: function(userId) {
            logger.log('getGroups: in groupListByUserId(): ' + userId);
            return new Promise(function(resolve, reject) {
                            
                logger.log('getGroups: in groupListByUserId(): in new Promise');
                var endPoint = urls.endPoints.groupList;
                endPoint = endPoint.replace('{userId}', userId);
                endPoint = endPoint.replace('{pagesize}', '100');

                var config = {
                    atype: 'GET',
                    headers: [],
                    parameters: [],
                    appendparams: [],
                    reqauth: true,
                    requser: false
                };

                var token = user.publicObjs.accessToken();
                if (token.length > 0) {
                    dataManager.addHeader(config, 'X-AuthToken', token);
                }

                dataManager.addHeader(config, 'X-Api-Version', '2');
                dataManager.addHeader(config, 'X-Application-Key', 'Origin');

                logger.log('getGroups: in groupListByUserId(): dataManager.enQueue:' + endPoint);
                
                var promise = dataManager.enQueue(endPoint, config, 0);
                promise.then(function(response) {
                    logger.log('getGroups: in groupListByUserId(): response:' + response);
                    resolve(response);
                }, function(error) {
                    logger.log('getGroups: in groupListByUserId(): error:' + error);
                    reject(error);
                }).catch(function(error) {
                    logger.log('getGroups: in groupListByUserId(): error:' + error);
                });
            });
        },

	 
        /**
         * This will return a promise to join the group for the groupId and userId specified
         *
         * @param {number} userId
         * @param {guid} groupId
         * @return {promise}  
         */
        acceptGroupInvite: function(groupId, userId) {
            logger.log('JSSDK groups: in acceptGroupInvite(): ' + userId);
            return new Promise(function(resolve, reject) {
                            
                logger.log('JSSDK groups: in acceptGroupInvite(): in new Promise');
                var endPoint = urls.endPoints.groupJoin;
                endPoint = endPoint.replace('{targetUserId}', userId);
                endPoint = endPoint.replace('{groupGuid}', groupId);

                var config = {
                    atype: 'POST',
                    headers: [],
                    parameters: [],
                    appendparams: [],
                    reqauth: true,
                    requser: false
                };

                var token = user.publicObjs.accessToken();
                if (token.length > 0) {
                    dataManager.addHeader(config, 'X-AuthToken', token);
                }

                dataManager.addHeader(config, 'X-Api-Version', '2');
                dataManager.addHeader(config, 'X-Application-Key', 'Origin');

                logger.log('JSSDK groups: in acceptGroupInvite(): dataManager.enQueue:' + endPoint);
                
                var promise = dataManager.enQueue(endPoint, config, 0);
                promise.then(function(response) {
                    logger.log('JSSDK groups: in acceptGroupInvite(): response:' + JSON.stringify(response));
                    resolve(response);
                }, function(error) {
                    logger.log('JSSDK groups: in acceptGroupInvite(): error:' + error);
                    reject(error);
                }).catch(function(error) {
                    logger.log('JSSDK groups: in acceptGroupInvite(): error:' + error);
                });
            });
        },
		

        /**
         * This will return a promise to decline the group invite for the groupId and userId specified
         *
         * @param {number} userId
         * @param {guid} groupId
         * @return {promise}  
         */
        cancelGroupInvite: function(groupId, userId) {
            logger.log('JSSDK groups: in cancelGroupInvite(): ' + userId);
            return new Promise(function(resolve, reject) {
                            
                logger.log('JSSDK groups: in cancelGroupInvite(): in new Promise');
                var endPoint = urls.endPoints.groupInvited;
                endPoint = endPoint.replace('{targetUserId}', userId);
                endPoint = endPoint.replace('{groupGuid}', groupId);

                var config = {
                    atype: 'DELETE',
                    headers: [],
                    parameters: [],
                    appendparams: [],
                    reqauth: true,
                    requser: false
                };

                var token = user.publicObjs.accessToken();
                if (token.length > 0) {
                    dataManager.addHeader(config, 'X-AuthToken', token);
                }

                dataManager.addHeader(config, 'X-Api-Version', '2');
                dataManager.addHeader(config, 'X-Application-Key', 'Origin');

                logger.log('JSSDK groups: in cancelGroupInvite(): dataManager.enQueue:' + endPoint);
                
                var promise = dataManager.enQueue(endPoint, config, 0);
                promise.then(function(response) {
                    logger.log('JSSDK groups: in cancelGroupInvite(): response:' + JSON.stringify(response));
                    resolve(response);
                }, function(error) {
                    logger.log('JSSDK groups: in cancelGroupInvite(): error:' + error);
                    reject(error);
                }).catch(function(error) {
                    logger.log('JSSDK groups: in cancelGroupInvite(): error:' + error);
                });
            });
        },
		
        /**
         * This will return a promise for the group list for the userId specified
         *
         * @param {number} userId
         * @return {promise<groupInviteList[]>}  name array of groupInfoObjects, invited groups
         */
        groupInviteListByUserId: function(userId) {
            logger.log('getGroups: in groupInviteListByUserId(): ' + userId);
            return new Promise(function(resolve, reject) {
                            
                logger.log('getGroups: in groupInviteListByUserId(): in new Promise');
                var endPoint = urls.endPoints.groupInvitedList;
                endPoint = endPoint.replace('{userId}', userId);
                endPoint = endPoint.replace('{pagesize}', '100');

                var config = {
                    atype: 'GET',
                    headers: [],
                    parameters: [],
                    appendparams: [],
                    reqauth: true,
                    requser: false
                };

                var token = user.publicObjs.accessToken();
                if (token.length > 0) {
                    dataManager.addHeader(config, 'X-AuthToken', token);
                }

                dataManager.addHeader(config, 'X-Api-Version', '2');
                dataManager.addHeader(config, 'X-Application-Key', 'Origin');

                logger.log('getGroups: in groupInviteListByUserId(): dataManager.enQueue:' + endPoint);
                
                var promise = dataManager.enQueue(endPoint, config, 0);
                promise.then(function(response) {
                    logger.log('getGroups: in groupInviteListByUserId(): response:' + response);
                    resolve(response);
                }, function(error) {
                    logger.log('getGroups: in groupInviteListByUserId(): error:' + error);
                    reject(error);
                }).catch(function(error) {
                    logger.log('getGroups: in groupInviteListByUserId(): error:' + error);
                });
            });
        },	

        /**
         * This will return a promise for the room list for the groupGuid specified
         *
         * @param {number} groupGuid
         * @return {promise<roomList[]>}  name array of roomInfoObjects
         */
        roomListByGroup: function(groupGuid) {
            return new Promise(function(resolve, reject) {
                            
                var endPoint = urls.endPoints.roomList;
                endPoint = endPoint.replace('{groupGuid}', groupGuid);

                var config = {
                    atype: 'GET',
                    headers: [],
                    parameters: [],
                    appendparams: [],
                    reqauth: true,
                    requser: false
                };

                var token = user.publicObjs.accessToken();
                if (token.length > 0) {
                    dataManager.addHeader(config, 'X-AuthToken', token);
                }

                dataManager.addHeader(config, 'X-Api-Version', '2');
                dataManager.addHeader(config, 'X-Application-Key', 'Origin');

                var promise = dataManager.enQueue(endPoint, config, 0);
                promise.then(function(response) {
                    resolve(response);
                }, function(error) {
                    reject(error);
                }).catch(function(error) {
                });
            });
        },

        /**
         * This will return a promise for the group members list for the groupGuid specified
         *
         * @param {number} groupGuid
         * @return {promise<userList[]>} name array of groupMemberObjects
         */
        memberListByGroup: function(groupGuid, pageStart, pageSize) {
            return new Promise(function(resolve, reject) {
                            
                var endPoint = urls.endPoints.membersList;
                endPoint = endPoint.replace('{groupGuid}', groupGuid);
                endPoint = endPoint.replace('{pagesize}', pageSize);
                endPoint = endPoint.replace('{pagestart}', pageStart);

                var config = {
                    atype: 'GET',
                    headers: [],
                    parameters: [],
                    appendparams: [],
                    reqauth: true,
                    requser: false
                };

                var token = user.publicObjs.accessToken();
                if (token.length > 0) {
                    dataManager.addHeader(config, 'X-AuthToken', token);
                }

                dataManager.addHeader(config, 'X-Api-Version', '2');
                dataManager.addHeader(config, 'X-Application-Key', 'Origin');

                var promise = dataManager.enQueue(endPoint, config, 0);
                promise.then(function(response) {
                    resolve(response);
                }, function(error) {
                    reject(error);
                }).catch(function(error) {
                    logger.log(error, 'groups - memberListByGroup');
                });
            });
        }
			 
	};
	
});
(function(root) {
define("patches/strophe-patch.js", ["strophe"], function() {
  return (function() {
/* jshint ignore:start */
Strophe.Connection.prototype.authenticate = function(matched) {
    // if none of the mechanism worked
    if (Strophe.getNodeFromJid(this.jid) === null) {
        // we don't have a node, which is required for non-anonymous
        // client connections
        this._changeConnectStatus(Strophe.Status.CONNFAIL, 'x-strophe-bad-non-anon-jid');
        this.disconnect('x-strophe-bad-non-anon-jid');
    } else {
        // fall back to legacy authentication
        this._changeConnectStatus(Strophe.Status.AUTHENTICATING, null);
        this._addSysHandler(this._auth1_cb.bind(this), null, null, null, "_auth_1");
        this.send($iq({
            type: "get",
            to: this.domain,
            id: "_auth_1"
        }).c("query", {
            xmlns: Strophe.NS.AUTH
        }).c("username", {}).t(Strophe.getNodeFromJid(this.jid)).tree());
    }
}

Strophe.Connection.prototype._auth1_cb = function(elem) {
    // build plaintext auth iq
    var iq = $iq({
            type: "set",
            id: "_auth_2"
        })
        .c('query', {
            xmlns: Strophe.NS.AUTH
        })
        .c('username', {}).t(Strophe.getNodeFromJid(this.jid))
        .up()
        .c('token').t(this.pass);

    if (!Strophe.getResourceFromJid(this.jid)) {
        // since the user has not supplied a resource, we pick
        // a default one here.  unlike other auth methods, the server
        // cannot do this for us.
        this.jid = Strophe.getBareJidFromJid(this.jid) + '/strophe';
    }
    iq.up().c('resource', {}).t(Strophe.getResourceFromJid(this.jid));
    this._addSysHandler(this._auth2_cb.bind(this), null, null, null, "_auth_2");
    this.send(iq.tree());
    return false;
}
/* jshint ignore:end */;

  }).apply(root, arguments);
});
}(this));

/*jshint unused: false */
/*jshint strict: false */

define('jssdk',[
    'promise',
    'core/utils',
    'core/logger',
    'core/user',
    'core/locale',
    'core/auth',
    'core/events',
    'core/defines',
    'core/urls',
    'core/windows',
    'core/datetime',
    'core/telemetry',
    'core/performance',
    'core/beacon',
    'core/anonymoustoken',
    'core/dataManager',
    'modules/achievements/achievement',
    'modules/feeds/feeds',
    'modules/client/client',
    'modules/games/games',
    'modules/games/cart',
    'modules/games/lmd',
    'modules/games/subscription',
    'modules/games/trial',
    'modules/games/gifts',
    'modules/settings/settings',
    'modules/social/atom',
    'modules/social/avatar',
    'modules/social/friends',
    'modules/social/obfuscate',
    'modules/xmpp/xmpp',
    'modules/search/search',
    'modules/voice/voice',
    'modules/commerce/commerce',
    'modules/pin/pin',
    'modules/wishlist/wishlist',
    'modules/translations/translations',
    'modules/idobfuscate/idobfuscate',
    'social/groups',
    'patches/strophe-patch.js',
    'generated/jssdkconfig.js',
    'modules/client/clientobjectregistry'
], function(Promise, utils, logger, user, configService, auth, events, defines, urls, windows, datetime, telemetry, performance, beacon, anonymousToken, dataManager, achievements, feeds, client, games, cart, lmd, subscription, trial, gifts, settings, atom, avatar, friends, obfuscate, xmpp, search, voice, commerce, pin, wishlist, translations, idObfuscate,  groups, strophePatch, jssdkconfig, clientObjectRegistry) {

    /**
     * @exports Origin
     */

    var jssdk = {
        /**
         * the version number of the Origin JSSDK
         * @method
         * @return {string} name the version number (X.X.X)
         */
        version: function() {
            return '0.0.1';
        },

        /**
         * initialization function for the Origin JSSDK
         * @method
         * @param {object=} overrides an object to be mixed in with the jssdk config object in order to override service endpoints
         * @return {promise} name resolved indicates the initialization succeed, reject means the intialization failed
         */
        init: function(locale) {

            /*jshint undef:false */
            var self = this;

            //init the core
            function initCore() {
                configService.setLocale(locale);

                jssdk.beacon = beacon;
                jssdk.auth = auth;
                jssdk.user = user.publicObjs;
                jssdk.events = events;
                jssdk.defines = defines;
                jssdk.locale = configService;
                jssdk.windows = windows;
                jssdk.datetime = datetime;
                jssdk.anonymousToken = anonymousToken;

                urls.init();
            }

            function initModules() {
                jssdk.achievements = achievements;
                jssdk.feeds = feeds;
                jssdk.client = client;
                jssdk.games = games;
                jssdk.cart = cart;
                jssdk.subscription = subscription;
                jssdk.trial = trial;
                jssdk.gifts = gifts;
                jssdk.settings = settings;
                jssdk.atom = atom;
                jssdk.avatar = avatar;
                jssdk.xmpp = xmpp;
                jssdk.search = search;
                jssdk.voice = voice;
                jssdk.commerce = commerce;
                jssdk.wishlist = wishlist;
                jssdk.idObfuscate = idObfuscate;
                jssdk.groups = groups;
                jssdk.friends = friends;
                jssdk.obfuscate = obfuscate;
                jssdk.pin = pin;
                jssdk.dataManager = dataManager;
                jssdk.translations = translations;
            }


            initCore();

            //waits for the promise to resolve then calls init modules before return a promise for the Origin.init call
            return clientObjectRegistry.init()
                .then(lmd.markAllLMDdirty)
                .then(initModules);
        }
    };

    //we want these available even before Origin.init happens
    jssdk.log = logger.publicObjs;
    jssdk.utils = utils;
    jssdk.config = jssdkconfig;
    jssdk.telemetry = telemetry;    //does have a dependency on utils (for Communicator)
    jssdk.performance = performance;
    return jssdk;
});

    //The modules for your project will be inlined above
    //this snippet. Ask almond to synchronously require the
    //module value for 'main' here and return it as the
    //value to use for the public API for the built file.
    return require('jssdk');
}));