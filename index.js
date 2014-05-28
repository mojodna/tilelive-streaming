"use strict";

var stream = require("stream"),
    util = require("util");

var async = require("async"),
    tilelive = require("tilelive");

/**
* Generate a stream of stream objects containing tile data and coordinates.
*/
var Readable = function(options, source) {
  stream.Readable.call(this, {
    objectMode: true
  });

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
        return source.getTile(tile.z, tile.x, tile.y, function(err, data) {
          if (err) {
            if (!err.message.match(/Tile|Grid does not exist/)) {
              console.warn(err.stack);
              return callback();
            }
          }

          if (data) {
            // downstream consumers expect stream objects w/ coordinates attached
            var out = new stream.PassThrough();
            out.z = tile.z;
            out.x = tile.x;
            out.y = tile.y;

            tileWritten = true;
            self.push(out);

            // since we already have all of the data here, flush it all at once
            out.end(data);
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
    var self = this;
    var chunks = [];

    var collector = new stream.PassThrough();

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
        length: data.length
      });

      self.push({
        z: obj.z,
        x: obj.x,
        y: obj.y,
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
    return sink.putTile(obj.z, obj.x, obj.y, obj.data, callback);
  };
};

util.inherits(Writable, stream.Writable);

module.exports = function(tilelive) {
  // list of enhanced sources
  var enhanced = [];

  var enableStreaming = function(uri, source) {
    if (enhanced.indexOf(source) >= 0) {
      // already enhanced

      return source;
    }

    if (source.getTile) {
      // only add readable streams if the underlying source is readable

      source.createReadStream = source.createReadStream || function(options) {
        // set some defaults
        options = options || {};
        options.scheme = options.scheme || "scanline";
        options.minzoom = 'minzoom' in options ? options.minzoom : 0;
        options.maxzoom = 'maxzoom' in options ? options.maxzoom : Infinity;
        options.bbox = options.bbox || [-180, -85.0511, 180, 85.0511];

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

    enhanced.push(source);

    return source;
  };

  var _load = tilelive.load;

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
module.exports.Writable = Writable;
