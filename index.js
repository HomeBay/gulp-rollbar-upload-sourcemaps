'use strict';

var through = require('through2');
var path = require('path');
var gutil = require('gulp-util');
var PluginError = gutil.PluginError;
var requestRetry = require('requestretry');

var PLUGIN_NAME = 'gulp-rollbar-upload-sourcemaps';
var API_URL = 'https://api.rollbar.com/api/1/sourcemap';

/**
 *  Gulp plugin for uploading the JS sourcemap files to Rollbar.
 *
 *  @param {object} config - Rollbar settings such as `accessToken`, `version`, etc.
 *  @see https://rollbar.com/docs/source-maps/
 */
function rollbar(config) {
  config = config || {};

  if (!config.accessToken) {
    throw new PluginError(PLUGIN_NAME, 'missing `accessToken` in config');
  }
  if (!config.version) {
    throw new PluginError(PLUGIN_NAME, 'missing `version` in config');
  }
  if (typeof config.getPublicAssetUrl !== "function") {
    throw new PluginError(PLUGIN_NAME, 'missing `getPublicAssetUrl` in config');
  }

  function postSourcemap(file, encoding, callback) {

    if (file.isNull() || !file.sourceMap) {
      return callback(null, file);
    }

    if (file.isStream()) {
      return callback(new Error(PLUGIN_NAME + 'streams are not supported'));
    }

    var sourceMap = file.sourceMap;

    var formData = {
      access_token: config.accessToken,
      version: config.version,
      minified_url: config.getPublicAssetUrl(file),
      source_map: {
        value: new Buffer(JSON.stringify(sourceMap)),
        options: {
          filename: [sourceMap.file, 'map'].join('.'),
          contentType: 'application/octet-stream'
        }
      }
    };

    function retryStrategyWithLog(err, response) {

      // Uses default strategy but use custom strategy to trigger logs.
      if (err || response.statusCode !== 200) {
        gutil.log("RETRYING:", file.relative);
      }
      return requestRetry.RetryStrategies.HTTPOrNetworkError(err, response);

    }

    requestRetry({
      url: API_URL,
      method: 'POST',
      formData: formData,
      maxAttempts: 10,
      retryStrategy: retryStrategyWithLog

    }, function (err, httpResponse, body) {
      if (err) {
        throw new PluginError(PLUGIN_NAME, err, {showStack: true});
      }

      if (httpResponse.statusCode === 200) {
        gutil.log("SUCCESS:", formData.source_map.options.filename);

      } else {
        var message = JSON.parse(body).message;
        gutil.log("FAILURE:", "(http code: ", httpResponse.statusCode, ", error: \"" + message + "\"");
      }

      callback(null, file);
    });

  }

  return through.obj(postSourcemap);

}

module.exports = rollbar;
