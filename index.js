"use strict";

var stream = require("stream"),
    url = require("url"),
    util = require("util");

var _ = require("highland"),
    async = require("async"),
    _debug = require("debug");

var meta = require("./package.json"),
    Scheme = require("./lib/scheme");

var debug = _debug(meta.name);

var DEFAULT_CONCURRENCY = 8,
    PING = {},
    PING_DELAY = 50;

/**
 * Mildly enhanced PassThrough stream with header-setting capabilities.
 */
var TileStream = function(zoom, x, y, context) {
  stream.PassThrough.call(this);

  this.z = zoom;
  this.x = x;
  this.y = y;
  this.context = context;

  var dests = [],
      _pipe = this.pipe,
      _unpipe = this.unpipe,
      _headers;

  this.pipe = function(dest) {
    dests.push(dest);

    if (_headers) {
      if (dest.setHeader) {
        Object.keys(_headers).forEach(function(k) {
          dest.setHeader(k, _headers[k]);
        });
      }
    }

    return _pipe.apply(this, arguments);
  };

  this.unpipe = function(dest) {
    if (dest && dests.indexOf(dest) >= 0) {
      // remove the destination
      dests.splice(dests.indexOf(dest), 1);
    } else if (!dest) {
      // reset destinations
      dests = [];
    }

    return _unpipe.apply(this, arguments);
  };

  this.setHeaders = function(headers) {
    if (headers) {
      _headers = headers;
      dests.forEach(function(dest) {
        if (dest.setHeader) {
          Object.keys(headers).forEach(function(k) {
            dest.setHeader(k, headers[k]);
          });
        }
      });
    }
  };

  // attach an error handler to make errors on this stream non-fatal
  this.on("error", function(err) {
    // NOOP
  });
};

util.inherits(TileStream, stream.PassThrough);

var clone = function(obj) {
  return Object.keys(obj || {}).reduce(function(v, k) {
    v[k] = obj[k];

    return v;
  }, {});
};

var applyDefaults = function(options) {
  var data = clone(options);

  data.concurrency = data.concurrency || DEFAULT_CONCURRENCY;

  return data;
};

var applyConfigDefaults = function(info, isOptions) {
  var data = clone(info);

  if (isOptions) {
    data.scheme = data.scheme || "scanline";
  }

  data.minzoom = "minzoom" in data ? data.minzoom : 0;
  data.maxzoom = "maxzoom" in data ? data.maxzoom : Infinity;
  data.bounds = data.bounds || [-180, -85.0511, 180, 85.0511];

  return data;
};

var restrict = function(info, by) {
  info = applyConfigDefaults(info);
  by = applyConfigDefaults(by);

  // restrict the options according to known restrictions
  info.minzoom = Math.max(info.minzoom, by.minzoom);
  info.maxzoom = Math.min(info.maxzoom, by.maxzoom);
  info.bounds[0] = Math.max(info.bounds[0], by.bounds[0]);
  info.bounds[1] = Math.max(info.bounds[1], by.bounds[1]);
  info.bounds[2] = Math.min(info.bounds[2], by.bounds[2]);
  info.bounds[3] = Math.min(info.bounds[3], by.bounds[3]);

  return info;
};

/**
* Generate a stream of stream objects containing tile data and coordinates.
*/
var Readable = function(sourceConfig, source, options) {
  // set some defaults
  sourceConfig = applyConfigDefaults(sourceConfig, true);
  options = applyDefaults(options);

  stream.Readable.call(this, {
    objectMode: true,
    highWaterMark: options.concurrency
  });

  var readable = this,
      scheme;

  // TODO emit basic stats about the read stream (number of records if known,
  // etc.)

  source.getInfo(function(err, info) {
    if (err) {
      console.warn(err);
    }

    if (info) {
      sourceConfig = restrict(sourceConfig, info);
      readable.emit("info", restrict(info, sourceConfig));
    }

    readable.sourceConfig = sourceConfig;

    // tilelive uses a different key from TileJSON
    sourceConfig.bbox = sourceConfig.bounds;
    scheme = Scheme.create(sourceConfig.scheme, sourceConfig);
    scheme.formats = ["tile"];
  });

  var pending = 0;
  var pendingTiles = {};

  var statusInterval = setInterval(function() {
    debug("status: %d pending requests", pending);
    debug("status:", Object.keys(pendingTiles));
  }, 5000);

  this._read = function() {
    // limit the number of concurrent reads pending
    if (pending + 1 >= options.concurrency) {
      // bail early if already reading
      return;
    }

    if (!scheme) {
      // scheme isn't ready yet
      return setImmediate(this._read.bind(this));
    }

    var self = this,
        done = false,
        keepGoing = true;

    // support concurrent buffering
    var ping = setTimeout(function() {
      self.push(PING);
    }, PING_DELAY);

    return async.whilst(function() {
      return keepGoing && !done;
    }, function(callback) {
      var tile = scheme.nextTile();

      if (tile) {
        // track pending requests so we don't end the stream before they finish
        pending++;
        pendingTiles[[tile.z, tile.x, tile.y].join("/")] = true;
        return source.getTile(tile.z, tile.x, tile.y, function(err, data, headers) {
          delete pendingTiles[[tile.z, tile.x, tile.y].join("/")];
          pending--;

          if (err) {
            if (!err.message.match(/Tile|Grid does not exist/)) {
              console.warn(err.stack);
              return callback();
            }
          }

          if (data || headers) {
            // downstream consumers expect stream objects w/ coordinates attached
            var out = new TileStream(tile.z, tile.x, tile.y);

            // push this tile and see if we should keep buffering
            keepGoing = self.push(out);

            out.setHeaders(headers);

            // since we already have all of the data here, flush it all at once
            out.end(data || null);
          }

          return callback();
        });
      }

      debug("No more tiles to fetch.");

      // no more tiles
      done = true;

      return callback();
    }, function() {
      // all pending getTile() calls are complete
      clearTimeout(ping);

      if (done && pending === 0) {
        debug("Ending the stream");

        clearInterval(statusInterval);

        // end the stream
        self.push(null);
      } else {
        debug("%d pending requests, waiting...", pending);
      }
    });
  };
};

util.inherits(Readable, stream.Readable);

/**
* Consume a stream of stream objects containing tile data and coordinates.
*/
var Collector = function(options) {
  options = applyDefaults(options);

  stream.Transform.call(this, {
    objectMode: true,
    highWaterMark: options.concurrency
  });

  this.on("pipe", function(src) {
    // forward "info" events
    src.on("info", this.emit.bind(this, "info"));
  });

  this._transform = function(obj, _, done) {
    // sentinel object (empty)
    if (obj === PING) {
      return done();
    }

    var self = this,
        chunks = [],
        headers = {};

    var collector = new stream.PassThrough();

    collector.setHeader = function(k, val) {
      headers[k] = val;
    };

    collector._transform = function(chunk, _, callback) {
      chunks.push(chunk);

      return callback();
    };

    collector._flush = function(callback) {
      var data = Buffer.concat(chunks);

      // emit a "tile" event once a tile's data has been successfully received
      self.emit("tile", {
        z: obj.z,
        x: obj.x,
        y: obj.y,
        headers: headers,
        length: data.length
      });

      self.push({
        z: obj.z,
        x: obj.x,
        y: obj.y,
        headers: headers,
        data: data
      });

      callback();

      return done();
    };

    return obj.pipe(collector);
  };
};

util.inherits(Collector, stream.Transform);

/**
* Wrap a tilelive sink
*/
var Writable = function(sink, options) {
  options = applyDefaults(options);

  stream.Writable.call(this, {
    objectMode: true,
    highWaterMark: options.concurrency
  });

  this._write = function(obj, _, callback) {
    if (sink.putTile.length === 5) {
      // sink doesn't include a headers parameter
      return sink.putTile(obj.z, obj.x, obj.y, obj.data, callback);
    }

    return sink.putTile(obj.z, obj.x, obj.y, obj.data, obj.headers, callback);
  };
};

util.inherits(Writable, stream.Writable);

var enhance = function(uri, source) {
  if (typeof uri === "string") {
    uri = url.parse(uri);
  }

  var proto = uri.protocol.slice(0, -1);

  try {
    source = require("./lib/enhancers/" + proto)(source);
  } catch (err) {
    // noop
  }

  return source;
};

var streamTile = function(source, getTile, passThrough, z, x, y, context, callback) {
  callback = callback || function() {};

  var tileStream = new TileStream(z, x, y, context);

  getTile(z, x, y, function(err, data, headers) {
    if (err && !err.message.match(/(Tile|Grid) does not exist/)) {
      debug(err);
      // pass the stream through so that the error can be caught
      passThrough.write(tileStream);

      tileStream.emit("error", err);
      tileStream.end();
    }

    if (data) {
      passThrough.write(tileStream);

      tileStream.setHeaders(headers);
      tileStream.end(data);
    }

    return callback.apply(null, arguments);
  });

  return tileStream;
};

module.exports = function(tilelive, options) {
  options = applyDefaults(options);

  var enableStreaming = function(uri, source) {
    // TODO use ES6 Symbols
    if (source._streamable) {
      // already enhanced

      return source;
    }

    // attempt to enhance the source with custom streams
    source = enhance(uri, source);

    // apply default enhancement

    if (source.getTile) {
      // only add readable streams if the underlying source is readable

      source.createReadStream = source.createReadStream || function(opts) {
        return new Readable(opts, this);
      };

      if (!source.pipe) {
        // only implement pipe if didn't already exist
        // NOTE: if pipe exists, getTile is assumed to also be enhanced

        var passThrough = new stream.PassThrough({
          objectMode: true
        });

        // attach a pipe method to the source that all rendered tiles pass
        // through
        source.pipe = passThrough.pipe.bind(passThrough);

        var getTile = source.getTile.bind(source);

        // wrap getTile so that it both returns and pipes tile streams
        source.getTile = function(z, x, y, callback) {
          var context = {};

          Object
            .keys(callback)
            .forEach(function(k) {
              context[k] = callback[k];
            });

          return streamTile(source, getTile, passThrough, z, x, y, context, function(err, data) {
            if (err) {
              // handled by streamTile
            }

            // get neighboring tiles within the same metatile
            //
            // NOTE: assumes that sources internally cache metatiles for rapid
            // subsequent access (tilelive-mapnik does, for example)
            if (data && source.metatile && source.metatile > 1) {
              // TODO extract this (also used in tilelive-cache)
              var dx = x % source.metatile,
                  dy = y % source.metatile,
                  metaX = x - dx,
                  metaY = y - dy;

              for (var ix = metaX; ix < metaX + source.metatile; ix++) {
                for (var iy = metaY; iy < metaY + source.metatile; iy++) {
                  // ignore the current tile
                  if (!(ix === x && iy === y)) {
                    streamTile(source, getTile, passThrough, z, ix, iy, context);
                  }
                }
              }
            }

            // return control to the original callback
            return callback.apply(null, arguments);
          });
        };
      }
    }

    if (source.putTile) {
      // only add writable streams if the underlying source is writable

      source.createWriteStream = source.createWriteStream || function(opts) {
        var sink = this,
            writeStream = new Collector(options);

        opts = opts || {};
        opts.info = opts.info || {};

        if (sink.putInfo) {
          var infoReceived = false;

          writeStream.once("info", function(info) {
            infoReceived = true;
            options.info = _.extend(opts.info, info);

            return sink.putInfo(restrict(opts.info, info), function(err) {
              if (err) {
                throw err;
              }
            });
          });

          writeStream.on("finish", function() {
            if (!infoReceived) {
              infoReceived = true;
              return sink.putInfo(opts.info, function(err) {
                if (err) {
                  throw err;
                }
              });
            }
          });
        }

        writeStream
          .pipe(new Writable(this, options));

        // return a reference to the head-end of the pipeline
        return writeStream;
      };
    }

    source._streamable = true;

    return source;
  };

  // attach a 'pipe' method to tilelive (objectMode stream containing sources)
  var streamableSources = new stream.PassThrough({
    objectMode: true
  });

  tilelive.pipe = streamableSources.pipe.bind(streamableSources);

  var _load = tilelive.load.bind(tilelive);

  tilelive.load = function(uri, callback) {
    return _load(uri, function(err, source) {
      if (!err) {
        source = enableStreaming(uri, source);

        // TODO ES6 Symbols
        source.sourceURI = uri;

        streamableSources.write(source);
      }

      return callback(err, source);
    });
  };

  return tilelive;
};

module.exports.Collector = Collector;
module.exports.Readable = Readable;
module.exports.TileStream = TileStream;
module.exports.Writable = Writable;
module.exports.applyDefaults = applyDefaults;
module.exports.clone = clone;
module.exports.restrict = restrict;
