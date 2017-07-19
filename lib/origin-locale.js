(function() {

    'use strict';

    /**
     * Matches standard lowercase, 2 character, hyphen delimited langugage-country combinations
     * as well as the storefront that prefaces him.
     * @type {RegExp}
     * @see https://regex101.com/r/mP7jN9/6
     */
    var matchStandardUrlPattern = /\/([a-z]{3})\/([a-z]{2}-[a-z]{2})\//i;

    /**
    * Explodes a URL into a pattern where we extract the base url from a url
    * @type {RegExp}
    * @see https://regex101.com/r/eI2tX6/1
    */
     var genericUrlPattern = /^(https?:\/\/\/?[\w]*(?::[\w]*)?@?[\d\w\.-]+(?::(\d+))?)/;

     var twoLetterToThreeLetterCountryMap = {
         'us': 'usa',
         'ca': 'can',
         'gb': 'gbr',
         'au': 'aus',
         'be': 'bel',
         'br': 'bra',
         'de': 'deu',
         'dk': 'dnk',
         'es': 'esp',
         'fi': 'fin',
         'fr': 'fra',
         'hk': 'hkg',
         'ie': 'irl',
         'in': 'ind',
         'it': 'ita',
         'jp': 'jpn',
         'kr': 'kor',
         'mx': 'mex',
         'nl': 'nld',
         'no': 'nor',
         'nz': 'nzl',
         'pl': 'pol',
         'pt': 'prt',
         'ru': 'rus',
         'se': 'swe',
         'sg': 'sgp',
         'th': 'tha',
         'tw': 'twn',
         'za': 'zaf',
         'ch': 'deu',
         'ww': 'usa',
         'cn': 'chn',
         'default': 'irl'
     };

    /**
     * Extract the two letter country code from the three letter country code
     * @param  {string} country e.g. usa
     * @return {string} the country code eg. us
     */
    function parseCountryCode(country) {
        for (var key in twoLetterToThreeLetterCountryMap) {
            if (twoLetterToThreeLetterCountryMap.hasOwnProperty(key) && twoLetterToThreeLetterCountryMap[key] === country) {
                return key;
            }
        }
        return '';
    }

    /**
     * Extract the langueage code from the locale string
     * @param  {string} locale the locale string eg. en-us
     * @return {string} the language code eg. en
     */
    function parseLanguageCode(locale) {
        return locale.substr(0, 2);
    }

    /**
     * Get a property from a map or use the map's default if defined
     * @param {object} map the map to search
     * @param {string} the keyname to match
     * @return {string} the value of the key or default
     */
    function getProperty(map, key) {
        var defaultValue = map['default'];

        if (!key) {
            return defaultValue;
        }

        return map[key] || defaultValue;
    }

    /**
     * Regional language alternates
     * @type {Object}
     */
    var languageAlternates = {
        'default': [
            'en',
            'nl',
            'es',
            'fr',
            'it',
            'da',
            'de',
            'se',
            'pt',
            'pl',
            'nb',
            'no',
            'kr',
            'ru',
            'fi',
            'zh',
            'th',
            'ja'
        ]
    };

    /**
     * Generate a list of alternate languages available for the locale
     * @param {string} locale the locale string to analyze
     * @return {array} a list of alternate languages for the region
     * @see https://support.google.com/webmasters/answer/2620865?hl=en
     */
    function parseLocaleAlternates(locale) {
        return getProperty(languageAlternates, locale);
    }
    /**
     * Get the cased country code by locale string
     * @param  {string} locale the locale string eg. en-us
     * @return {string} the cased locale sting eg. en_US
     */
    function parseCasedLocale(locale) {
        var boom = locale.split('-');
        return [boom[0], boom[1].toUpperCase()].join('_');
    }

    /**
     * The default country to currency mapping for all uses of the storefront
     * @type {Object}
     */
    var countryCodeToCurrencyCode = {
        'ca': 'cad',
        'us': 'usd',
        'as': 'usd',
        'gu': 'usd',
        'pr': 'usd',
        'vi': 'usd',
        'de': 'eur',
        'at': 'eur',
        'li': 'eur',
        'ch': 'eur',
        'pl': 'pln',
        'ru': 'rub',
        'am': 'rub',
        'az': 'rub',
        'by': 'rub',
        'kz': 'rub',
        'kg': 'rub',
        'tj': 'rub',
        'tm': 'rub',
        'ua': 'rub',
        'uz': 'rub',
        'dk': 'dkk',
        'fi': 'eur',
        'no': 'nok',
        'se': 'sek',
        'gb': 'gbp',
        'ie': 'eur',
        'br': 'brl',
        'mx': 'usd',
        'es': 'eur',
        'pt': 'eur',
        'it': 'eur',
        'be': 'eur',
        'lu': 'eur',
        'fr': 'eur',
        'gf': 'eur',
        'tf': 'eur',
        'yt': 'eur',
        'mc': 'eur',
        'nc': 'eur',
        'pf': 'eur',
        'nl': 'eur',
        'an': 'eur',
        'au': 'aud',
        'aq': 'aud',
        'cx': 'aud',
        'ck': 'aud',
        'fj': 'aud',
        'hm': 'aud',
        'ki': 'aud',
        'mh': 'aud',
        'fm': 'aud',
        'nr': 'aud',
        'nu': 'aud',
        'nf': 'aud',
        'pw': 'aud',
        'pg': 'aud',
        'sb': 'aud',
        'tk': 'aud',
        'tv': 'aud',
        'vu': 'aud',
        'nz': 'nzd',
        'pn': 'nzd',
        'ws': 'nzd',
        'to': 'nzd',
        'wf': 'nzd',
        'jp': 'jpy',
        'kr': 'krw',
        'hk': 'hkd',
        'mo': 'hkd',
        'sg': 'sgd',
        'bn': 'sgd',
        'kh': 'sgd',
        'cc': 'sgd',
        'tl': 'sgd',
        'id': 'sgd',
        'la': 'sgd',
        'my': 'sgd',
        'mm': 'sgd',
        'mp': 'sgd',
        'ph': 'sgd',
        'vn': 'sgd',
        'th': 'thb',
        'tw': 'twd',
        'in': 'inr',
        'bd': 'inr',
        'bt': 'inr',
        'np': 'inr',
        'pk': 'inr',
        'lk': 'inr',
        'za': 'zar',
        'dz': 'zar',
        'ao': 'zar',
        'bj': 'zar',
        'bw': 'zar',
        'bf': 'zar',
        'bi': 'zar',
        'cm': 'zar',
        'cv': 'zar',
        'cf': 'zar',
        'td': 'zar',
        'km': 'zar',
        'cd': 'zar',
        'cg': 'zar',
        'dj': 'zar',
        'gq': 'zar',
        'et': 'zar',
        'ga': 'zar',
        'gm': 'zar',
        'gh': 'zar',
        'gn': 'zar',
        'gw': 'zar',
        'ci': 'zar',
        'ke': 'zar',
        'ls': 'zar',
        'lr': 'zar',
        'mg': 'zar',
        'mw': 'zar',
        'mv': 'zar',
        'ml': 'zar',
        'mr': 'zar',
        'mu': 'zar',
        'mz': 'zar',
        'na': 'zar',
        'ne': 'zar',
        'ng': 'zar',
        'rw': 'zar',
        'sh': 'zar',
        'sn': 'zar',
        'sc': 'zar',
        'sl': 'zar',
        'sz': 'zar',
        'tz': 'zar',
        'tg': 'zar',
        'tn': 'zar',
        'ug': 'zar',
        'eh': 'zar',
        'zm': 'zar',
        'zw': 'zar',
        'default': 'eur'
    };

    /**
     * Given a locale get the currency code from the map above
     * @param  {string} locale the locale string eg. en-us
     * @return {string} the currency code eg. usd
     */
    function parseCurrencyCode(country) {
        return getProperty(countryCodeToCurrencyCode, parseCountryCode(country));
    }

    /**
     * Remap locale to the three letter language code (used by EA Madrid translation services)
     * locales assigned by marketing
     * @type {Object}
     */
    var localeToThreeLetterLanguageCode = {
        'en': 'eng',
        'nl': 'dut',
        'es': 'spa',
        'fr': 'fre',
        'it': 'ita',
        'da': 'dan',
        'de': 'ger',
        'se': 'swe',
        'pt': 'por',
        'pl': 'pol',
        'nb': 'nor',
        'no': 'nor',
        'kr': 'kor',
        'ru': 'rus',
        'fi': 'fin',
        'zh': 'cht',
        'th': 'tha',
        'ja': 'jpn',
        'default': 'eng'
    };

    /**
     * Given a locale, select the appropriate 3 letter language code
     * @param  {string} locale the locale string eg. en-us
     * @return {string} the three letter language code eg. eng
     */
    function parseThreeLetterLanguageCode(locale) {
        return getProperty(localeToThreeLetterLanguageCode, parseLanguageCode(locale));
    }

    /**
     * An api for accessing locale attributes
     * @param  {object} collection a collection cache of static locale information
     * @return {object} public api methods
     */
    function api(collection) {
        /**
         * Remap a US locale to a standard locale http://www.foo.com/home -> http://www.foo.com/usa/es-us/home
         * @param  {string} languageCode the new language code
         * @return {function} a function or replace to execute
         */
        function convertToStandardUrlLocale(languageCode) {
            /**
             * This function takes the replacement group and maps the new language code into it
             * @param  {string} replacementGroup the replacement group from the regex  eg
             * @return {string} the string replacement eg. /de-gb
             */
            return function(replacementGroup) {
                return [replacementGroup, '/', getThreeLetterCountryCode(), '/', languageCode, '-us'].join('');
            };
        }

        /**
         * Remap a standard URL scheme /gbr/en-gb/home -> /gbr/de-gb/home
         * @param  {string} languageCode the new language code
         * @return {function} a function or replace to execute
         */
        function replaceStandardUrlLocale(languageCode) {
            /**
             * This function takes the replacement group and maps the new language code into it
             * @param  {string} replacementGroup the replacement group from the regex delimited with () eg. /gbr/en-gb/
             * @return {string} the string replacement eg. /gbr/de-gb
             */
            return function(replacementGroup) {
                var matchChars = replacementGroup.split('');
                var languageChars = languageCode.split('');
                matchChars[5] = languageChars[0];
                matchChars[6] = languageChars[1];
                return matchChars.join('');
            };
        }

        /**
         * Get a value from the collection by key
         * @param  {string} key the keyname
         * @return {Mixed}  the corresponding collection value
         */
        function get(key) {
            return collection[key];
        }

        /**
         * Get the url friendly locale string
         * @return {string} the url-friendly locale string eg. en-us
         */
        function getLocale() {
            return get('locale');
        }

        /**
         * Get a cased locale string representation
         * @return {string} the legacy locale string eg. en_US
         */
        function getCasedLocale() {
            return get('casedLocale');
        }

        /**
         * Get the language code
         * @return {string} the ISO-639-1 language code eg. en
         */
        function getLanguageCode() {
            return get('languageCode');
        }

        /**
         * Get the country code
         * @return {string} the ISO_3166-1_alpha-2 country code eg. us
         */
        function getCountryCode() {
            return get('countryCode');
        }

        /**
         * Get the three letter language code
         * @return {string} the ISO-639-2 country code eg. eng
         */
        function getThreeLetterLanguageCode() {
            return get('threeLetterLanguageCode');
        }

        /**
         * Get the three letter country code
         * @return {string} the ISO_3166-1_alpha-3 country code eg. usa
         */
        function getThreeLetterCountryCode() {
            return get('threeLetterCountryCode');
        }

        /**
         * Get an aray of alternaate language codes for this locale
         * @return {Array} a list of ISO-639-1 language codes eg. ['en', 'es', ...]
         */
        function getLocaleAlternates() {
            return get('localeAlternates');
        }

        /**
         * Get the currency code for this region
         * @return {string} the applicable curency code eg. usd
         */
        function getCurrencyCode() {
            return get('currencyCode');
        }

        /**
         * Remap the URL for the desired language
         * @param {string} The current URL
         * @param {string} ISO-639-1 two character lower case language code
         * @return {string} the input URL with the new language code
         * @see https://regex101.com/r/iA0kI3/1
         *      https://regex101.com/r/mP7jN9/6
         */
        function createUrl(url, languageCode) {
            if (getCountryCode() === 'us' && getLanguageCode() === 'en') {
                if (!url.match(matchStandardUrlPattern)) {
                     return url.replace(genericUrlPattern, convertToStandardUrlLocale(languageCode));
                 } else {
                     return url;
                 }
            } else {
                if (getCountryCode() === 'us' && languageCode === 'en') {
                    return url.replace(matchStandardUrlPattern, '/');
                } else {
                    return url.replace(matchStandardUrlPattern, replaceStandardUrlLocale(languageCode));
                }
            }
        }

        return {
            getLocale: getLocale,
            getCasedLocale: getCasedLocale,
            getLanguageCode: getLanguageCode,
            getCountryCode: getCountryCode,
            getThreeLetterCountryCode: getThreeLetterCountryCode,
            getThreeLetterLanguageCode: getThreeLetterLanguageCode,
            getLocaleAlternates:  getLocaleAlternates,
            getCurrencyCode: getCurrencyCode,
            createUrl: createUrl
        };
    }

    /**
     * The parser functionality for origin locale
     * @return {object} public api methods
     */
    function localeParser() {
        /**
         * Get the first occurence of /xx-xx(/ or #) in the URL
         * @param {string} url the url to analyze
         * @return {string} the locale string eg. fr-fr
         */
        function parseLocale(url, defaultLocale) {
            var localeMatches = matchStandardUrlPattern.exec(url);

            if (localeMatches && localeMatches[2]) {
                return localeMatches[2].toLowerCase();
            }

            return defaultLocale;
        }

        function parseThreeLetterCountryCode(url, defaultCountry) {
            var localeMatches = matchStandardUrlPattern.exec(url);

            if (localeMatches && localeMatches[1]) {
                return localeMatches[1].toLowerCase();
            }

            return defaultCountry;
        }

        /**
         * Parse the URL into a collection and return an API object with the cached object
         * @param {string} url the input url to parse eg https://www.example.com/fr-fr/store/buy/2982992
         * @param {string} defaultLocale if a locale string is not found, default to the given string eg en-us
         * @return {Object} instance of API
         */
        function parse(url, defaultLocale, defaultCountry) {
            var locale = parseLocale(url, defaultLocale),
                country = parseThreeLetterCountryCode(url, defaultCountry),
                collection = {
                    locale: locale,
                    casedLocale: parseCasedLocale(locale),
                    languageCode: parseLanguageCode(locale),
                    countryCode: parseCountryCode(country),
                    threeLetterCountryCode: country,
                    threeLetterLanguageCode: parseThreeLetterLanguageCode(locale),
                    localeAlternates: parseLocaleAlternates(locale),
                    currencyCode: parseCurrencyCode(country)
                };

            return api(collection);
        }

        return {
            parse: parse
        };
    }

    /**
     * Locale global intitializer
     */
    if (typeof window.OriginLocale === 'undefined') {
        window.OriginLocale = localeParser();
    }
}());
