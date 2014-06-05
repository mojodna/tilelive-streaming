"use strict";

var stream = require("stream");

var _ = require("highland"),
    mercator = new (require("sphericalmercator"))(),
    tiletype = require("tiletype"),
    ts = require("..");

// TODO configurable
var BATCH_SIZE = 10,
    // coordinates are stored in TMS coordinates
    QUERY = "SELECT zoom_level z, tile_column x, (1 << zoom_level) - 1 - tile_row y, tile_data data FROM tiles LIMIT ? OFFSET ?";

module.exports = function(mbtiles) {
  mbtiles.createReadStream = function(options) {
    var source = this,
        readable = new stream.Transform({
          objectMode: true
        }),
        offset = 0;

    var tileSource = _();

    source.getInfo(function(err, info) {
      if (err) {
        return tileSource.emit("error", err);
      }

      options = ts.restrictOptions(ts.defaultOptions(options), info);

      // TODO restrict info according to options and emit it

      _(function(push, next) {
        return source._db.each(QUERY, BATCH_SIZE, offset, function(err, tile) {
          push(err, tile);
        }, function(err, count) {
          if (count === 0) {
            push(null, _.nil);
          }

          offset += BATCH_SIZE;
          return next();
        });
      }).filter(function(tile) {
        // validate zoom
        return tile.z >= options.minzoom && tile.z <= options.maxzoom;
      }).filter(function(tile) {
        // validate coords against bounds
        var xyz = mercator.xyz(options.bounds, tile.z);

        return tile.x >= xyz.minX &&
              tile.x <= xyz.maxX &&
              tile.y >= xyz.minY &&
              tile.y <= xyz.maxY;
      }).pipe(tileSource);
    });

    readable._transform = function(tile, _, callback) {
      var out = new ts.TileStream(tile.z, tile.x, tile.y);

      this.push(out);

      var headers = {
        'Content-Type': tiletype.headers(tiletype.type(tile.data)),
        'Last-Modified': new Date(source._stat.mtime).toUTCString(),
        'ETag': source._stat.size + '-' + Number(source._stat.mtime)
      };

      out.setHeaders(headers);

      out.end(tile.data);

      return callback();
    };

    return tileSource.pipe(readable);
  };

  mbtiles.createWriteStream = function() {
    var sink = this,
        writeStream = new ts.Collector(),
        writable = new ts.Writable(sink);

    writable.on("finish", function() {
      return sink.stopWriting(function(err) {
        if (err) {
          console.warn(err);
        }
      });
    });

    var _write = writable._write;

    writable._write = function(obj, encoding, callback) {
      var args = arguments;

      if (!sink._isWritable) {
        return sink.startWriting(function(err) {
          if (err) {
            return callback(err);
          }

          return _write.apply(writable, args);
        });
      }

      return _write.apply(writable, args);
    };

    writeStream.pipe(writable);

    // return the head-end of the pipeline
    return writeStream;
  };

  return mbtiles;
};
