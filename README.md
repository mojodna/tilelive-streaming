# tilelive-streaming

A [tilelive](https://github.com/mapbox/tilelive.js) wrapper that transparently
adds streaming functionality to providers.

## About

This module adds `createReadStream` and `createWriteStream` methods to
providers that support `getTile` and `putTile` respectively. Default
functionality uses a `tilelive.Scheme` to generate a set of `getTile` requests,
outputting a stream of streams containing tile data.

## Usage

```javascript
var tilelive = require("tilelive-streaming")(require("tilelive"), {
  concurrency: 8
});
require("mbtiles").registerProtocols(tilelive);

tilelive.load("mbtiles://./in.mbtiles", function(err, source) {
  return tilelive.load("mbtiles://./out.mbtiles", function(err, sink) {
    source.createReadStream().pipe(sink.createWriteStream());
  });
});
```

## Options

`createReadStream` passes its options into a `tilelive.Scheme` subclass
(specified by `sourceConfig.scheme`, defaulting to `scanline`), so the documentation
for that takes precedence.  In practice, `minzoom`, `maxzoom`, and `bounds` are
likely candidates, as they can be used for filtering.

`createWriteStream` accepts an `info` option containing TileJSON.  Its values
will overwrite any info provided by the source (when appropriate).

## Events

Writable streams will emit `tile` events (containing `z`, `x`, `y`, `headers`,
and `data` properties) when data for a given tile has been fully received.

Readable streams will emit `info` events once it has been loaded (usually
before tile data begins being sent).

## Overriding Default Implementations

`lib/` contains specific implementations for providers that do not (yet)
support streaming natively and where the default behavior can be improved upon.
[`mbtiles`](https://github.com/mapbox/node-mbtiles) is a good example of this,
as the actual list of tiles present can be determined directly from the source
(rather than scanning a bounding box and zoom range for possible candidates).

### MBTiles

`mbtiles`' `createReadStream` accepts a `batchSize` argument that allows the
number of tiles read from the underlying SQLite3 database at a time to be
specified.
