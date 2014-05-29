"use strict";

var stream = require("stream"),
    url = require("url"),
    util = require("util");

var async = require("async"),
    tilelive = require("tilelive");

/**
 * Mildly enhanced PassThrough stream with header-setting capabilities.
 */
var TileStream = function(zoom, x, y) {
  stream.PassThrough.call(this);

  this.z = zoom;
  this.x = x;
  this.y = y;

  var dests = [],
      _pipe = this.pipe,
      _unpipe = this.unpipe;

  this.pipe = function(dest) {
    dests.push(dest);

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
      dests.forEach(function(dest) {
        if (dest.setHeader) {
          Object.keys(headers).forEach(function(x) {
            dest.setHeader(x, headers[x]);
          });
        }
      });
    }
  };
};

util.inherits(TileStream, stream.PassThrough);

/**
* Generate a stream of stream objects containing tile data and coordinates.
*/
var Readable = function(options, source) {
  stream.Readable.call(this, {
    objectMode: true
  });

  // set some defaults
  options = options || {};
  options.scheme = options.scheme || "scanline";
  options.minzoom = 'minzoom' in options ? options.minzoom : 0;
  options.maxzoom = 'maxzoom' in options ? options.maxzoom : Infinity;
  options.bbox = options.bbox || [-180, -85.0511, 180, 85.0511];

  var scheme;

  source.getInfo(function(err, info) {
    if (err) {
      console.warn(err);
    }

    if (info) {
      // set some sensible defaults
      info.bounds = info.bounds || [-180, -85.0511, 180, 85.0511];
      info.minzoom = 'minzoom' in info ? info.minzoom : 0;
      info.maxzoom = 'maxzoom' in info ? info.maxzoom : Infinity;

      // restrict the options according to known restrictions
      options.minzoom = Math.max(options.minzoom, info.minzoom);
      options.maxzoom = Math.min(options.maxzoom, info.maxzoom);
      options.bbox[0] = Math.max(options.bbox[0], info.bounds[0]);
      options.bbox[1] = Math.max(options.bbox[1], info.bounds[1]);
      options.bbox[2] = Math.min(options.bbox[2], info.bounds[2]);
      options.bbox[3] = Math.min(options.bbox[3], info.bounds[3]);
    }

    scheme = tilelive.Scheme.create(options.scheme, options);
    scheme.formats = ["tile"];
  });

  this._read = function() {
    if (!scheme) {
      // scheme isn't ready yet
      return setImmediate(this._read.bind(this));
    }

    var self = this,
        tileWritten = false;

    return async.until(function() {
      return tileWritten;
    }, function(callback) {
      var tile = scheme.nextTile();

      if (tile) {
        return source.getTile(tile.z, tile.x, tile.y, function(err, data, headers) {
          if (err) {
            if (!err.message.match(/Tile|Grid does not exist/)) {
              console.warn(err.stack);
              return callback();
            }
          }

          if (data || headers) {
            // downstream consumers expect stream objects w/ coordinates attached
            var out = new TileStream(tile.z, tile.x, tile.y);

            tileWritten = true;
            self.push(out);

            out.setHeaders(headers);

            // since we already have all of the data here, flush it all at once
            out.end(data || null);
          }

          return callback();
        });
      }

      tileWritten = true;
      self.push(null);

      return callback();
    }, function() {});
  };
};

util.inherits(Readable, stream.Readable);

/**
* Consume a stream of stream objects containing tile data and coordinates.
*/
var Collector = function() {
  stream.Transform.call(this, {
    objectMode: true
  });

  this._transform = function(obj, _, done) {
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
var Writable = function(sink) {
  stream.Writable.call(this, {
    objectMode: true
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
  if (typeof(uri) === "string") {
    uri = url.parse(uri);
  }

  var proto = uri.protocol.slice(0, -1);

  try {
    source = require("./lib/" + proto)(source);
  } catch (err) {}

  return source;
};

module.exports = function(tilelive) {
  var enableStreaming = function(uri, source) {
    if (source._streamable) {
      // already enhanced

      return source;
    }

    // attempt to enhance the source with custom streams
    source = enhance(uri, source);

    // fall back to default enhancement

    if (source.getTile) {
      // only add readable streams if the underlying source is readable

      source.createReadStream = source.createReadStream || function(options) {
        return new Readable(options, this);
      };
    }

    if (source.putTile) {
      // only add writable streams if the underlying source is writable

      source.createWriteStream = source.createWriteStream || function() {
        // we want to return a reference to the head-end of the pipeline
        var writeStream = new Collector();

        writeStream
          .pipe(new Writable(this));

        return writeStream;
      };
    }

    source._streamable = true;

    return source;
  };

  var _load = tilelive.load.bind(tilelive);

  tilelive.load = function(uri, callback) {
    return _load(uri, function(err, source) {
      if (!err) {
        source = enableStreaming(uri, source);
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
