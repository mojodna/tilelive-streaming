"use strict";

var tiletype = require("tiletype"),
    ts = require("..");

module.exports = function(mbtiles) {
  mbtiles.createReadStream = function(options) {
    var source = this,
        readable = new ts.Readable(options, this);

    var rows = [];

    // TODO fetch in batches to reduce memory use
    var sql = "SELECT zoom_level z, tile_column x, tile_row y, tile_data data FROM tiles ORDER BY zoom_level ASC, tile_column ASC, tile_row ASC";
    this._db.each(sql, function(err, row) {
      if (err) {
        console.warn(err.stack);
        return;
      }

      rows.push(row);
    }, function(err) {
      if (err) {
        console.warn(err.stack);
      }

      rows.push(null);
    });

    readable._read = function() {
      if (rows.length === 0) {
        return setImmediate(this._read.bind(this));
      }

      var row = rows.shift();

      if (row === null) {
        // no more data
        return readable.push(null);
      }

      // TODO filter according to zoom and bbox

      var out = new ts.TileStream(row.z, row.x, row.y);

      readable.push(out);

      var headers = {
        'Content-Type': tiletype.headers(tiletype.type(row.data)),
        'Last-Modified': new Date(source._stat.mtime).toUTCString(),
        'ETag': source._stat.size + '-' + Number(source._stat.mtime)
      };

      out.setHeaders(headers);

      out.end(row.data);
    };

    return readable;
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
