"use strict";

var stream = require("stream");

var _ = require("highland"),
    async = require("async"),
    mercator = new (require("sphericalmercator"))(),
    tiletype = require("tiletype"),
    ts = require("..");

var DEFAULT_BATCH_SIZE = 50,
    // coordinates are stored in TMS coordinates
    QUERY = "SELECT zoom_level z, tile_column x, (1 << zoom_level) - 1 - tile_row y, tile_data data FROM tiles LIMIT ? OFFSET ?";

module.exports = function(mbtiles) {
  mbtiles.createReadStream = function(options) {
    var source = this,
        readable = new stream.Transform({
          objectMode: true
        }),
        offset = 0,
        tileSource = _();

    options.batchSize = options.batchSize || DEFAULT_BATCH_SIZE;

    source.getInfo(function(err, info) {
      if (err) {
        return tileSource.emit("error", err);
      }

      options = ts.restrict(ts.applyDefaults(options), info);
      info = ts.clone(info);

      // filter out MBTiles-specific keys that will be replaced
      delete info.scheme;
      delete info.basename;
      delete info.id;
      delete info.filesize;

      // restrict info according to options and emit it
      readable.emit("info", ts.restrict(info, options));

      _(function(push, next) {
        return source._db.each(QUERY, options.batchSize, offset, function(err, tile) {
          push(err, tile);
        }, function(err, count) {
          if (count === 0) {
            return push(null, _.nil);
          }

          offset += options.batchSize;
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
        "Content-Type": tiletype.headers(tiletype.type(tile.data)),
        "Last-Modified": new Date(source._stat.mtime).toUTCString(),
        "ETag": source._stat.size + "-" + Number(source._stat.mtime)
      };

      out.setHeaders(headers);

      out.end(tile.data);

      return callback();
    };

    return tileSource.pipe(readable);
  };

  mbtiles.createWriteStream = function(options) {
    var sink = this,
        writeStream = new ts.Collector(),
        writable = new ts.Writable(sink),
        infoReceived = false;

    options = options || {};
    options.info = options.info || {};

    var putInfo = function(info, callback) {
      callback = callback || function() {};

      return sink.putInfo(ts.restrict(options.info, info), function(err) {
        if (err) {
          throw err;
        }

        return callback();
      });
    };

    writeStream.once("info", function(info) {
      infoReceived = true;
      options.info = _.extend(options.info, info);

      if (!sink._isWritable) {
        return sink.startWriting(function(err) {
          if (err) {
            throw err;
          }

          return putInfo(info);
        });
      }

      return putInfo(info);
    });

    writable.on("finish", function() {
      if (!infoReceived) {
        infoReceived = true;

        if (!sink._isWritable) {
          return sink.startWriting(function(err) {
            if (err) {
              throw err;
            }

            return putInfo(options.info, async.apply(writable.emit.bind(writable), "finish"));
          });
        }

        return putInfo(options.info, async.apply(writable.emit.bind(writable), "finish"));
      }

      return sink.stopWriting(function(err) {
        if (err) {
          console.warn(err);
        }

        return sink.close(function() {});
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
